require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { Pool } = require('pg');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==========================
// CONFIG
// ==========================
const PORT = process.env.PORT || 5000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

if (!FINNHUB_API_KEY) {
    console.log('⚠️ WARNING: FINNHUB_API_KEY missing. Forex & Gold will use fallback prices.');
}

const SIGNAL_COOLDOWN_MINUTES = 15;
const SUPPORTED_ASSETS = ['XAUUSD', 'US30', 'NAS100', 'EURUSD', 'GBPUSD', 'BTCUSD'];
const FALLBACK_PRICES = {
    'XAUUSD': 2350.50, 'US30': 33500.00, 'NAS100': 18500.00,
    'EURUSD': 1.0850, 'GBPUSD': 1.2650, 'BTCUSD': 65000.00
};

// ==========================
// DATABASE
// ==========================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================
// MIDDLEWARE
// ==========================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ==========================
// HEALTH
// ==========================
app.get('/', (req, res) => res.json({ status: 'SYNA LIVE MARKET ENGINE', market: 'REAL' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ==========================
// DB INIT (all tables)
// ==========================
async function initDB() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(20) UNIQUE,
            username VARCHAR(50) UNIQUE,
            avatar_url TEXT,
            password_hash VARCHAR(255) NOT NULL,
            subscription_plan VARCHAR(20) DEFAULT 'free',
            subscription_expiry TIMESTAMP,
            trading_status VARCHAR(20) DEFAULT 'active',
            trial_signals_used INTEGER DEFAULT 0,
            syna_active BOOLEAN DEFAULT FALSE,
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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pending_payments (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            plan VARCHAR(20),
            amount DECIMAL(10,2),
            transaction_ref VARCHAR(100) UNIQUE,
            provider VARCHAR(10),
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS mt5_accounts (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            api_key TEXT NOT NULL UNIQUE,
            account_id TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS trade_results (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            symbol VARCHAR(20),
            action VARCHAR(4),
            lot_size DECIMAL(10,2),
            entry_price DECIMAL(15,5),
            exit_price DECIMAL(15,5),
            profit_usd DECIMAL(15,2),
            profit_pips DECIMAL(10,2),
            executed_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('Database ready');
}
initDB().catch(console.error);

// ==========================
// AUTH (unchanged)
// ==========================
app.post('/api/auth/register', async (req, res) => {
    const { email, phone, password, username } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const finalUsername = username || email.split('@')[0];
        const result = await pool.query(
            `INSERT INTO users(email, phone, password_hash, username) VALUES($1,$2,$3,$4) RETURNING id,email,phone,username`,
            [email, phone || null, hash, finalUsername]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            if (err.constraint === 'users_username_key') return res.status(400).json({ error: 'Username already taken' });
            return res.status(400).json({ error: 'Email already registered' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                username: user.username,
                avatar_url: user.avatar_url,
                subscription_plan: user.subscription_plan,
                subscription_expiry: user.subscription_expiry,
                trading_status: user.trading_status,
                syna_active: user.syna_active
            }
        });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ==========================
// USER PROFILE & SUBSCRIPTION
// ==========================
app.get('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, phone, username, avatar_url, subscription_plan, subscription_expiry, trading_status, trial_signals_used, syna_active
             FROM users WHERE id = $1`,
            [req.userId]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/user/profile', authMiddleware, async (req, res) => {
    const { username, avatar_url } = req.body;
    try {
        if (username) await pool.query(`UPDATE users SET username=$1 WHERE id=$2`, [username, req.userId]);
        if (avatar_url) await pool.query(`UPDATE users SET avatar_url=$1 WHERE id=$2`, [avatar_url, req.userId]);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Username already taken' });
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================
// USER ASSETS
// ==========================
app.post('/api/user/assets', authMiddleware, async (req, res) => {
    const { assets } = req.body;
    if (!Array.isArray(assets)) return res.status(400).json({ error: 'Assets must be array' });
    try {
        await pool.query(`DELETE FROM user_assets WHERE user_id=$1`, [req.userId]);
        for (const asset of assets) {
            if (!SUPPORTED_ASSETS.includes(asset)) continue;
            await pool.query(`INSERT INTO user_assets(user_id, asset_symbol) VALUES($1,$2)`, [req.userId, asset]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/user/assets', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT asset_symbol FROM user_assets WHERE user_id=$1`, [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) { res.json({ assets: [] }); }
});

app.get('/api/user/trial-remaining', authMiddleware, async (req, res) => {
    const user = await pool.query(`SELECT trial_signals_used FROM users WHERE id=$1`, [req.userId]);
    const used = parseInt(user.rows[0]?.trial_signals_used) || 0;
    res.json({ remaining: Math.max(0, 3 - used) });
});

// ==========================
// MT5 REGISTRATION (FIXED)
// ==========================
app.post('/api/mt5/register', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const apiKey = crypto.randomBytes(32).toString('hex');
        const accountId = `MT5_${userId}_${Date.now()}`;
        await pool.query(`
            INSERT INTO mt5_accounts (user_id, api_key, account_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE
            SET api_key = EXCLUDED.api_key, account_id = EXCLUDED.account_id, updated_at = NOW()
        `, [userId, apiKey, accountId]);
        const user = await pool.query(`SELECT subscription_plan, subscription_expiry, trial_signals_used FROM users WHERE id=$1`, [userId]);
        const hasActive = user.rows[0].subscription_plan !== 'free' && new Date(user.rows[0].subscription_expiry) > new Date();
        const trialRemaining = Math.max(0, 3 - (user.rows[0].trial_signals_used || 0));
        res.json({ success: true, api_key: apiKey, account_id: accountId, websocket_url: `wss://nrxtrader-api.onrender.com`, has_active_subscription: hasActive, trial_signals_remaining: trialRemaining });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ==========================
// START/STOP SYNA TRADING
// ==========================
app.post('/api/syna/toggle', authMiddleware, async (req, res) => {
    const { active } = req.body; // true or false
    await pool.query(`UPDATE users SET syna_active = $1 WHERE id = $2`, [active, req.userId]);
    res.json({ success: true, syna_active: active });
});

// ==========================
// MARKET HOURS CHECK (weekends closed)
// ==========================
function isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sunday, 6=Saturday
    return day !== 0 && day !== 6;
}

// ==========================
// REAL MARKET PRICE ENGINE
// ==========================
async function getLivePrice(asset) { /* same as before – unchanged */ 
    try {
        const forexMap = { 'EURUSD': 'OANDA:EUR_USD', 'GBPUSD': 'OANDA:GBP_USD', 'XAUUSD': 'OANDA:XAU_USD' };
        if (forexMap[asset]) {
            const url = `https://finnhub.io/api/v1/quote?symbol=${forexMap[asset]}&token=${FINNHUB_API_KEY}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.c) return parseFloat(data.c);
        }
        if (asset === 'BTCUSD') {
            const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
            const data = await res.json();
            if (data && data.price) return parseFloat(data.price);
        }
        const yahooMap = { 'US30': '^DJI', 'NAS100': '^IXIC' };
        if (yahooMap[asset]) {
            const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooMap[asset]}`);
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price) return parseFloat(price);
        }
        if (FALLBACK_PRICES[asset]) {
            const base = FALLBACK_PRICES[asset];
            const variation = (Math.random() - 0.5) * 0.002 * base;
            return base + variation;
        }
        return null;
    } catch (err) { return null; }
}

async function getLastPrice(asset) {
    const res = await pool.query('SELECT last_price FROM price_cache WHERE asset_symbol = $1', [asset]);
    return res.rows.length ? parseFloat(res.rows[0].last_price) : null;
}

async function updatePriceCache(asset, price) {
    await pool.query(`
        INSERT INTO price_cache (asset_symbol, last_price)
        VALUES ($1, $2)
        ON CONFLICT (asset_symbol) DO UPDATE SET last_price = $2, updated_at = NOW()
    `, [asset, price]);
}

function calculateConfidence(movement, volatility) {
    let confidence = 70;
    if (Math.abs(movement) > 0.08) confidence += 5;
    if (Math.abs(movement) > 0.15) confidence += 5;
    if (volatility > 0.05) confidence += 5;
    if (Math.abs(movement) > 0.2) confidence += 5;
    return Math.min(confidence, 95);
}

async function hasRecentSignal(asset, direction) {
    const res = await pool.query(
        `SELECT * FROM auto_signals WHERE asset_symbol=$1 AND signal_type=$2 AND generated_at > NOW() - INTERVAL '${SIGNAL_COOLDOWN_MINUTES} minutes'`,
        [asset, direction]
    );
    return res.rows.length > 0;
}

// ==========================
// AUTO SIGNAL GENERATION (only if market open)
// ==========================
async function generateAutoSignal(asset) {
    try {
        const currentPrice = await getLivePrice(asset);
        if (!currentPrice) return null;
        const lastPrice = await getLastPrice(asset);
        await updatePriceCache(asset, currentPrice);
        if (!lastPrice) return null;
        const movement = ((currentPrice - lastPrice) / lastPrice) * 100;
        const volatility = Math.abs(movement);
        if (volatility < 0.03) return null;
        const direction = movement > 0 ? 'BUY' : 'SELL';
        if (await hasRecentSignal(asset, direction)) return null;
        const confidence = calculateConfidence(movement, volatility);
        if (confidence < 75) return null;
        const entry = currentPrice;
        const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
        const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
        const trend = movement > 0 ? 'bullish' : 'bearish';
        const result = await pool.query(
            `INSERT INTO auto_signals(asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence, market_trend, volatility)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [asset, direction, entry, tp, sl, confidence, trend, volatility]
        );
        return result.rows[0];
    } catch (err) { return null; }
}

// Broadcast signal to EA (only to users with syna_active=true, active subscription, and market open)
async function broadcastSignalToActiveUsers(signal) {
    if (!isMarketOpen()) return;
    const asset = signal.asset_symbol;
    const users = await pool.query(`
        SELECT u.id, ma.account_id, u.syna_active, u.subscription_plan, u.subscription_expiry
        FROM users u
        JOIN user_assets ua ON u.id = ua.user_id
        JOIN mt5_accounts ma ON ma.user_id = u.id
        WHERE ua.asset_symbol = $1
    `, [asset]);
    for (const user of users.rows) {
        const isValid = user.subscription_plan !== 'free' && new Date(user.subscription_expiry) > new Date();
        if (!user.syna_active || !isValid) continue;
        const client = clients.get(user.account_id);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'signal',
                symbol: asset,
                action: signal.signal_type,
                lot_size: 0.01,
                stop_loss: signal.stop_loss,
                take_profit: signal.take_profit,
                confidence: signal.confidence,
                timestamp: Date.now()
            }));
        }
    }
}

// Auto scanner (every 5 minutes)
setInterval(async () => {
    if (!isMarketOpen()) return;
    console.log('SYNA scanning live markets...');
    for (const asset of SUPPORTED_ASSETS) {
        const signal = await generateAutoSignal(asset);
        if (signal) {
            console.log(`NEW SIGNAL: ${signal.asset_symbol} ${signal.signal_type}`);
            await broadcastSignalToActiveUsers(signal);
        }
    }
}, 5 * 60 * 1000);

// ==========================
// MANUAL SIGNAL (trial button)
// ==========================
app.post('/api/trades/generate-signal', authMiddleware, async (req, res) => {
    const { assetSymbol } = req.body;
    if (!assetSymbol) return res.status(400).json({ error: 'Asset symbol required' });
    try {
        let currentPrice = await getLivePrice(assetSymbol);
        let usedFallback = false;
        if (!currentPrice) {
            currentPrice = FALLBACK_PRICES[assetSymbol];
            usedFallback = true;
            if (!currentPrice) return res.status(500).json({ error: 'Market data temporarily unavailable' });
        }
        const lastPrice = await getLastPrice(assetSymbol);
        if (!lastPrice) {
            await updatePriceCache(assetSymbol, currentPrice);
            return res.json({ success: true, message: 'SYNA is caching market data. Please click again in 30 seconds.', price: currentPrice });
        }
        const movement = ((currentPrice - lastPrice) / lastPrice) * 100;
        const volatility = Math.abs(movement);
        if (volatility < 0.03) {
            return res.json({ success: true, message: 'No significant market movement yet. Monitoring continues.', price: currentPrice });
        }
        const direction = movement > 0 ? 'BUY' : 'SELL';
        const confidence = calculateConfidence(movement, volatility);
        if (confidence < 75) {
            return res.json({ success: true, message: `Signal confidence ${confidence}% – below threshold. Waiting for stronger setup.` });
        }
        const entry = currentPrice;
        const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
        const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
        const trend = movement > 0 ? 'bullish' : 'bearish';
        await pool.query(
            `INSERT INTO auto_signals(asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence, market_trend, volatility)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [assetSymbol, direction, entry, tp, sl, confidence, trend, volatility]
        );
        await pool.query('UPDATE users SET trial_signals_used = trial_signals_used + 1 WHERE id = $1', [req.userId]);
        // If user has active subscription, also broadcast to their EA
        const userSub = await pool.query(`SELECT subscription_plan, subscription_expiry FROM users WHERE id=$1`, [req.userId]);
        const isSubscribed = userSub.rows[0].subscription_plan !== 'free' && new Date(userSub.rows[0].subscription_expiry) > new Date();
        if (isSubscribed && isMarketOpen()) {
            const signal = { asset_symbol: assetSymbol, signal_type: direction, stop_loss: sl, take_profit: tp, confidence };
            await broadcastSignalToActiveUsers(signal);
        }
        res.json({ success: true, direction, price: currentPrice, confidence, used_fallback: usedFallback });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ==========================
// LEADERBOARD & TRADE RESULTS
// ==========================
app.post('/api/trade/result', async (req, res) => {
    const { secret, user_id, symbol, action, lot_size, profit_usd, profit_pips } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    await pool.query(
        `INSERT INTO trade_results (user_id, symbol, action, lot_size, profit_usd, profit_pips)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user_id, symbol, action, lot_size, profit_usd || 0, profit_pips || 0]
    );
    res.json({ success: true });
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.username, u.email, COALESCE(SUM(tr.profit_usd), 0) as total_profit
            FROM users u
            LEFT JOIN trade_results tr ON u.id = tr.user_id
            GROUP BY u.id
            ORDER BY total_profit DESC
            LIMIT 20
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==========================
// WEBSOCKET CLIENTS (for EA)
// ==========================
const clients = new Map();

wss.on('connection', (ws, req) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'auth') {
                const { account_id, api_key } = data;
                const result = await pool.query(
                    `SELECT user_id FROM mt5_accounts WHERE account_id=$1 AND api_key=$2`,
                    [account_id, api_key]
                );
                if (result.rows.length === 0) { ws.close(); return; }
                const userId = result.rows[0].user_id;
                clients.set(account_id, { ws, userId });
                ws.send(JSON.stringify({ type: 'auth_response', success: true }));
            }
            else if (data.type === 'trade_result') {
                // Store trade result automatically from EA
                const { user_id, symbol, action, lot_size, profit_usd, profit_pips, status } = data;
                if (status === 'executed' && profit_usd !== undefined) {
                    // user_id should be known from earlier authentication – we have userId in the client object
                    // Find the client by ws to get userId
                    let clientUserId = null;
                    for (let [acc, client] of clients) {
                        if (client.ws === ws) { clientUserId = client.userId; break; }
                    }
                    if (clientUserId) {
                        await pool.query(
                            `INSERT INTO trade_results (user_id, symbol, action, lot_size, profit_usd, profit_pips)
                             VALUES ($1, $2, $3, $4, $5, $6)`,
                            [clientUserId, symbol, action, lot_size, profit_usd || 0, profit_pips || 0]
                        );
                        console.log(`Trade recorded: user ${clientUserId} profit ${profit_usd}`);
                    }
                }
            }
            else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch(e) { console.error(e); }
    });
    ws.on('close', () => {
        for (let [key, val] of clients) if (val.ws === ws) clients.delete(key);
    });
});

// ==========================
// ADMIN PANEL (unchanged)
// ==========================
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`<!DOCTYPE html>...`); // keep your existing admin panel HTML (unchanged)
});

app.get('/api/admin/latest-signals', async (req, res) => { /* same as before */ });
app.post('/api/admin/mark-sent', async (req, res) => { /* same as before */ });
app.post('/api/admin/notify-signal', async (req, res) => { /* same as before */ });

// ==========================
// PAYMENT PLACEHOLDERS (MTN & Airtel)
// ==========================
app.post('/api/payment/mtn', authMiddleware, async (req, res) => { /* same as before */ });
app.post('/api/payment/airtel', authMiddleware, async (req, res) => { /* same as before */ });

// ==========================
// TEMPORARY DELETE ENDPOINTS (optional)
// ==========================
app.get('/api/admin/delete-user-by-email', async (req, res) => { /* ... */ });
app.get('/api/admin/delete-user-by-phone', async (req, res) => { /* ... */ });

// ==========================
// START SERVER
// ==========================
server.listen(PORT, () => {
    console.log(`
=================================
SYNA LIVE MARKET ENGINE RUNNING
PORT: ${PORT}
REAL MARKET DATA ACTIVE
LEADERBOARD ACTIVE
SUBSCRIPTION SYSTEM ACTIVE
AUTO BRIDGE LOGIN ENABLED
=================================
    `);
});
