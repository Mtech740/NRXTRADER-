require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();

// ==========================
// CONFIG
// ==========================

const PORT = process.env.PORT || 5000;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

const SIGNAL_COOLDOWN_MINUTES = 15;

const SUPPORTED_ASSETS = [
    'XAUUSD',
    'US30',
    'NAS100',
    'EURUSD',
    'GBPUSD',
    'BTCUSD'
];

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

app.get('/', (req, res) => {
    res.json({ status: 'SYNA LIVE MARKET ENGINE', market: 'REAL' });
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ==========================
// DB INIT
// ==========================

async function initDB() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

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

    console.log('Database ready');
}
initDB().catch(console.error);

// ==========================
// AUTH
// ==========================

app.post('/api/auth/register', async (req, res) => {
    const { email, phone, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users(email, phone, password_hash) VALUES($1,$2,$3) RETURNING id,email,phone`,
            [email, phone || null, hash]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Email already registered' });
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
        res.json({ token, user: { id: user.id, email: user.email, phone: user.phone, subscription_plan: user.subscription_plan } });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ==========================
// AUTH MIDDLEWARE
// ==========================

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
// REAL MARKET PRICE (NO SIMULATION)
// ==========================

async function getLivePrice(asset) {
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
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooMap[asset]}`;
            const res = await fetch(url);
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price) return parseFloat(price);
        }
        return null;
    } catch (err) {
        console.error(`Price fetch error for ${asset}:`, err);
        return null;
    }
}

// ==========================
// CONFIDENCE ENGINE
// ==========================

function calculateConfidence(movement, volatility) {
    let confidence = 70;
    if (Math.abs(movement) > 0.08) confidence += 5;
    if (Math.abs(movement) > 0.15) confidence += 5;
    if (volatility > 0.05) confidence += 5;
    if (Math.abs(movement) > 0.2) confidence += 5;
    return Math.min(confidence, 95);
}

// ==========================
// DUPLICATE PROTECTION
// ==========================

async function hasRecentSignal(asset, direction) {
    const res = await pool.query(
        `SELECT * FROM auto_signals WHERE asset_symbol=$1 AND signal_type=$2 AND generated_at > NOW() - INTERVAL '${SIGNAL_COOLDOWN_MINUTES} minutes'`,
        [asset, direction]
    );
    return res.rows.length > 0;
}

// ==========================
// SIGNAL GENERATION
// ==========================

async function generateSignal(asset) {
    try {
        const currentPrice = await getLivePrice(asset);
        if (!currentPrice) return null;

        const cache = await pool.query(`SELECT last_price FROM price_cache WHERE asset_symbol=$1`, [asset]);
        const lastPrice = cache.rows[0]?.last_price || null;

        await pool.query(
            `INSERT INTO price_cache(asset_symbol, last_price) VALUES($1,$2) ON CONFLICT(asset_symbol) DO UPDATE SET last_price=$2, updated_at=NOW()`,
            [asset, currentPrice]
        );

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
    } catch (err) {
        console.error(`Signal generation error for ${asset}:`, err);
        return null;
    }
}

// ==========================
// AUTO SCANNER
// ==========================

setInterval(async () => {
    console.log('SYNA scanning live markets...');
    for (const asset of SUPPORTED_ASSETS) {
        try {
            const signal = await generateSignal(asset);
            if (signal) {
                console.log(`NEW SIGNAL: ${signal.asset_symbol} ${signal.signal_type} (${signal.confidence}%)`);
            }
        } catch (err) {
            console.error(`Scan error for ${asset}:`, err);
        }
    }
}, 5 * 60 * 1000);

// ==========================
// ADMIN PANEL & SIGNAL FETCHING
// ==========================

app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>SYNA Admin Console</title>
        <style>body{font-family:monospace;background:#0a0e17;color:#e2e8f0;padding:20px}.signal-card{background:#111827;border-left:4px solid #10b981;border-radius:12px;padding:20px;margin-bottom:20px}.numbers-list{background:#0a0e17;border-radius:8px;padding:12px}.number-item{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #1f2937}.send-btn{background:#25D366;color:black;padding:6px 16px;border-radius:20px;text-decoration:none}button{background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.delete-btn{background:#ef4444}</style></head>
        <body><h1>SYNA Signal Dispatch</h1><div id="signalList"></div><script>
            const ADMIN_SECRET = "${secret}";
            async function fetchSignals() {
                const res = await fetch('/api/admin/latest-signals?secret='+ADMIN_SECRET);
                const data = await res.json();
                const container = document.getElementById('signalList');
                if (!data.signals || data.signals.length===0) { container.innerHTML='<p>No pending signals</p>'; return; }
                let html = '';
                for (let s of data.signals) {
                    html += \`<div class="signal-card"><h3>\${s.signal.asset_symbol} – \${s.signal.signal_type}</h3>
                    <p>Entry: \${s.signal.entry_price} | TP: \${s.signal.take_profit} | SL: \${s.signal.stop_loss}</p>
                    <p>Confidence: \${s.signal.confidence}% | Trend: \${s.signal.market_trend}</p>
                    <div class="numbers-list"><h4>WhatsApp Recipients</h4>\`;
                    for (let phone of s.whatsapp_numbers) {
                        let clean = phone.replace(/\\D/g,'');
                        if (!clean.startsWith('260') && phone.includes('+260')) clean = phone.replace('+','');
                        const msg = encodeURIComponent(\`📢 SYNA SIGNAL\\nAsset: \${s.signal.asset_symbol}\\nAction: \${s.signal.signal_type}\\nEntry: \${s.signal.entry_price}\\nTP: \${s.signal.take_profit}\\nSL: \${s.signal.stop_loss}\\nConfidence: \${s.signal.confidence}%\`);
                        html += \`<div class="number-item"><span>\${phone}</span><a href="https://wa.me/\${clean}?text=\${msg}" target="_blank" class="send-btn">Send via WhatsApp</a></div>\`;
                    }
                    html += \`</div><button onclick="markSent(\${s.signal.id})">Mark as Sent</button></div>\`;
                }
                container.innerHTML = html;
            }
            async function markSent(id) {
                await fetch('/api/admin/mark-sent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:ADMIN_SECRET,signal_id:id})});
                fetchSignals();
            }
            fetchSignals();
            setInterval(fetchSignals,30000);
        </script></body></html>
    `);
});

// ========== FIX: Only show signals that have at least one WhatsApp recipient ==========
app.get('/api/admin/latest-signals', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const signals = await pool.query(`SELECT * FROM auto_signals WHERE sent_to_admin=FALSE ORDER BY generated_at DESC LIMIT 50`);
        const output = [];
        for (const sig of signals.rows) {
            const users = await pool.query(`
                SELECT u.phone FROM users u
                JOIN user_assets ua ON u.id=ua.user_id
                WHERE ua.asset_symbol=$1 AND u.phone IS NOT NULL AND u.phone!=''
            `, [sig.asset_symbol]);
            if (users.rows.length > 0) {
                output.push({ signal: sig, whatsapp_numbers: users.rows.map(r => r.phone) });
            }
        }
        res.json({ signals: output });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/mark-sent', async (req, res) => {
    const { secret, signal_id } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    await pool.query('UPDATE auto_signals SET sent_to_admin=TRUE WHERE id=$1', [signal_id]);
    res.json({ success: true });
});

// ==========================
// NOTIFICATION (optional)
// ==========================

app.post('/api/admin/notify-signal', async (req, res) => {
    const { secret, userId, assetSymbol } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    await pool.query('UPDATE users SET trial_signals_used = trial_signals_used + 1 WHERE id=$1', [userId]);
    const ntfyTopic = process.env.NTFY_TOPIC || 'syna_alerts';
    fetch(`https://ntfy.sh/${ntfyTopic}`, { method: 'POST', body: `SYNA signal: ${assetSymbol}`, headers: { 'Title': 'SYNA Alert' } }).catch(e=>console.error);
    res.json({ success: true });
});

// ==========================
// TEMPORARY: DELETE USER BY EMAIL VIA GET (remove after use)
// ==========================
app.get('/api/admin/delete-user-by-email', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    const email = req.query.email;
    if (!email) return res.status(400).send('Email missing');
    try {
        await pool.query('DELETE FROM users WHERE email = $1', [email]);
        res.send(`✅ User with email ${email} deleted successfully. Now they can register again.`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// ==========================
// START SERVER
// ==========================

app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`SYNA LIVE MARKET ENGINE`);
    console.log(`PORT: ${PORT}`);
    console.log(`REAL MARKET DATA ACTIVE`);
    console.log(`CONFIDENCE ENGINE ACTIVE`);
    console.log(`=================================\n`);
});
