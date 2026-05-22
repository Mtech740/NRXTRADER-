require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const app = express();

// ==================== MIDDLEWARE ====================

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());

// ==================== DATABASE ====================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ==================== CONFIG ====================

const PORT = process.env.PORT || 5000;

const SIGNAL_COOLDOWN_MINUTES = 15;

const SUPPORTED_ASSETS = [
    'XAUUSD',
    'US30',
    'NAS100',
    'EURUSD',
    'GBPUSD',
    'BTCUSD'
];

// ==================== ROOT ====================

app.get('/', (req, res) => {
    res.json({
        status: 'SYNA INVESTOR API ONLINE',
        version: '2.0'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime()
    });
});

// ==================== DATABASE INIT ====================

async function initDB() {

    await pool.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(20) UNIQUE,
            telegram_id VARCHAR(50) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            subscription_plan VARCHAR(20) DEFAULT 'free',
            trial_signals_used INTEGER DEFAULT 0,
            signal_subscription_end TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_assets (
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            asset_symbol VARCHAR(20) NOT NULL,
            PRIMARY KEY(user_id, asset_symbol)
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_signals (
            id SERIAL PRIMARY KEY,
            asset_symbol VARCHAR(20),
            signal_type VARCHAR(10),
            entry_price DECIMAL(15,5),
            take_profit DECIMAL(15,5),
            stop_loss DECIMAL(15,5),
            confidence INTEGER,
            market_trend VARCHAR(20),
            volatility DECIMAL(10,5),
            generated_at TIMESTAMP DEFAULT NOW(),
            sent_to_admin BOOLEAN DEFAULT FALSE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS signal_results (
            id SERIAL PRIMARY KEY,
            signal_id INTEGER,
            outcome VARCHAR(10),
            pips DECIMAL(10,2),
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS price_cache (
            asset_symbol VARCHAR(20) PRIMARY KEY,
            last_price DECIMAL(15,5),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);

    console.log('Database initialized successfully');
}

initDB().catch(console.error);

// ==================== AUTH ====================

app.post('/api/auth/register', async (req, res) => {

    const { email, phone, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            error: 'Email and password required'
        });
    }

    try {

        const hash = await bcrypt.hash(password, 10);

        const result = await pool.query(`
            INSERT INTO users(email, phone, password_hash)
            VALUES($1,$2,$3)
            RETURNING id,email,phone
        `, [
            email,
            phone || null,
            hash
        ]);

        res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (err) {

        console.error(err);

        if (err.code === '23505') {
            return res.status(400).json({
                error: 'Email already exists'
            });
        }

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== LOGIN ====================

app.post('/api/auth/login', async (req, res) => {

    const { email, password } = req.body;

    try {

        const result = await pool.query(`
            SELECT * FROM users
            WHERE email = $1
        `, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        const user = result.rows[0];

        const valid = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!valid) {
            return res.status(401).json({
                error: 'Invalid credentials'
            });
        }

        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                subscription_plan: user.subscription_plan
            }
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== AUTH MIDDLEWARE ====================

async function authMiddleware(req, res, next) {

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            error: 'No token'
        });
    }

    const token = authHeader.split(' ')[1];

    try {

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.userId = decoded.userId;

        next();

    } catch (err) {

        res.status(401).json({
            error: 'Invalid token'
        });
    }
}

// ==================== USER ASSETS ====================

app.post('/api/user/assets', authMiddleware, async (req, res) => {

    const { assets } = req.body;

    if (!Array.isArray(assets)) {
        return res.status(400).json({
            error: 'Assets must be array'
        });
    }

    try {

        await pool.query(`
            DELETE FROM user_assets
            WHERE user_id = $1
        `, [req.userId]);

        for (const asset of assets) {

            if (!SUPPORTED_ASSETS.includes(asset)) continue;

            await pool.query(`
                INSERT INTO user_assets(user_id, asset_symbol)
                VALUES($1,$2)
            `, [req.userId, asset]);
        }

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== GET USER ASSETS ====================

app.get('/api/user/assets', authMiddleware, async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT asset_symbol
            FROM user_assets
            WHERE user_id = $1
        `, [req.userId]);

        res.json({
            assets: result.rows.map(r => r.asset_symbol)
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== PRICE ENGINE ====================

function getSimulatedPrice(asset) {

    const basePrices = {
        XAUUSD: 2350,
        US30: 39000,
        NAS100: 18000,
        EURUSD: 1.08,
        GBPUSD: 1.26,
        BTCUSD: 65000
    };

    const start = basePrices[asset] || 100;

    const volatility = Math.random() * 0.008;

    const movement =
        (Math.random() - 0.5)
        * volatility
        * start;

    return start + movement;
}

// ==================== CONFIDENCE ENGINE ====================

function calculateConfidence(volatility, trendStrength) {

    let confidence = 70;

    if (trendStrength > 0.3) {
        confidence += 10;
    }

    if (volatility > 0.002) {
        confidence += 5;
    }

    if (volatility < 0.0005) {
        confidence -= 10;
    }

    if (confidence > 95) confidence = 95;

    if (confidence < 60) confidence = 60;

    return Math.round(confidence);
}

// ==================== DUPLICATE SIGNAL PROTECTION ====================

async function hasRecentSignal(asset, direction) {

    const result = await pool.query(`
        SELECT *
        FROM auto_signals
        WHERE asset_symbol = $1
        AND signal_type = $2
        AND generated_at > NOW() - INTERVAL '${SIGNAL_COOLDOWN_MINUTES} minutes'
    `, [asset, direction]);

    return result.rows.length > 0;
}

// ==================== SIGNAL GENERATION ====================

async function generateSignal(asset) {

    const currentPrice = getSimulatedPrice(asset);

    const cache = await pool.query(`
        SELECT *
        FROM price_cache
        WHERE asset_symbol = $1
    `, [asset]);

    let lastPrice = null;

    if (cache.rows.length > 0) {
        lastPrice = parseFloat(cache.rows[0].last_price);
    }

    await pool.query(`
        INSERT INTO price_cache(asset_symbol,last_price)
        VALUES($1,$2)
        ON CONFLICT(asset_symbol)
        DO UPDATE SET
        last_price = EXCLUDED.last_price,
        updated_at = NOW()
    `, [asset, currentPrice]);

    if (!lastPrice) {
        return null;
    }

    const movement =
        ((currentPrice - lastPrice) / lastPrice) * 100;

    if (Math.abs(movement) < 0.03) {
        return null;
    }

    const direction =
        movement > 0 ? 'BUY' : 'SELL';

    const duplicate =
        await hasRecentSignal(asset, direction);

    if (duplicate) {
        return null;
    }

    const volatility = Math.abs(movement);

    const confidence =
        calculateConfidence(
            volatility,
            Math.abs(movement)
        );

    if (confidence < 75) {
        return null;
    }

    const entry = currentPrice;

    const tp =
        direction === 'BUY'
            ? entry * 1.005
            : entry * 0.995;

    const sl =
        direction === 'BUY'
            ? entry * 0.997
            : entry * 1.003;

    const result = await pool.query(`
        INSERT INTO auto_signals(
            asset_symbol,
            signal_type,
            entry_price,
            take_profit,
            stop_loss,
            confidence,
            market_trend,
            volatility
        )
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
    `, [
        asset,
        direction,
        entry,
        tp,
        sl,
        confidence,
        movement > 0 ? 'bullish' : 'bearish',
        volatility
    ]);

    return result.rows[0];
}

// ==================== AUTO SIGNAL ENGINE ====================

setInterval(async () => {

    console.log('SYNA scanning markets...');

    for (const asset of SUPPORTED_ASSETS) {

        try {

            const signal = await generateSignal(asset);

            if (signal) {

                console.log(`
Signal Generated:
${signal.asset_symbol}
${signal.signal_type}
Confidence: ${signal.confidence}%
                `);
            }

        } catch (err) {

            console.error(
                `Signal error for ${asset}`,
                err
            );
        }
    }

}, 5 * 60 * 1000);

// ==================== ADMIN SIGNALS ====================

app.get('/api/admin/latest-signals', async (req, res) => {

    const secret = req.query.secret;

    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    try {

        const signals = await pool.query(`
            SELECT *
            FROM auto_signals
            WHERE sent_to_admin = FALSE
            ORDER BY generated_at DESC
            LIMIT 10
        `);

        const output = [];

        for (const sig of signals.rows) {

            const users = await pool.query(`
                SELECT phone
                FROM users u
                JOIN user_assets ua
                ON u.id = ua.user_id
                WHERE ua.asset_symbol = $1
                AND u.phone IS NOT NULL
            `, [sig.asset_symbol]);

            output.push({
                signal: sig,
                whatsapp_numbers:
                    users.rows.map(r => r.phone)
            });
        }

        res.json({
            signals: output
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== MARK SENT ====================

app.post('/api/admin/mark-sent', async (req, res) => {

    const {
        secret,
        signal_id
    } = req.body;

    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    try {

        await pool.query(`
            UPDATE auto_signals
            SET sent_to_admin = TRUE
            WHERE id = $1
        `, [signal_id]);

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== SIGNAL RESULTS ====================

app.post('/api/admin/signal-result', async (req, res) => {

    const {
        secret,
        signal_id,
        outcome,
        pips
    } = req.body;

    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({
            error: 'Unauthorized'
        });
    }

    try {

        await pool.query(`
            INSERT INTO signal_results(
                signal_id,
                outcome,
                pips
            )
            VALUES($1,$2,$3)
        `, [
            signal_id,
            outcome,
            pips
        ]);

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== INVESTOR STATS ====================

app.get('/api/stats', async (req, res) => {

    try {

        const totalSignals = await pool.query(`
            SELECT COUNT(*) FROM auto_signals
        `);

        const wins = await pool.query(`
            SELECT COUNT(*)
            FROM signal_results
            WHERE outcome = 'WIN'
        `);

        const losses = await pool.query(`
            SELECT COUNT(*)
            FROM signal_results
            WHERE outcome = 'LOSS'
        `);

        const users = await pool.query(`
            SELECT COUNT(*) FROM users
        `);

        res.json({
            users: users.rows[0].count,
            totalSignals: totalSignals.rows[0].count,
            wins: wins.rows[0].count,
            losses: losses.rows[0].count
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: 'Server error'
        });
    }
});

// ==================== SERVER START ====================

app.listen(PORT, () => {

    console.log(`
SYNA INVESTOR BACKEND RUNNING
PORT: ${PORT}
    `);
});
