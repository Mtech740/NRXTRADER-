require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'NRXTRADER API ONLINE' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// AUTH
app.post('/api/auth/register', async (req, res) => {
    const { email, phone, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, email, phone',
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
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email, phone: user.phone } });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Assets (simplified)
const auth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

app.get('/api/user/assets', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT asset_symbol FROM user_assets WHERE user_id = $1', [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) { res.json({ assets: [] }); }
});

app.post('/api/user/assets', auth, async (req, res) => {
    const { assets } = req.body;
    if (!Array.isArray(assets)) return res.status(400).json({ error: 'Assets must be an array' });
    try {
        await pool.query('DELETE FROM user_assets WHERE user_id = $1', [req.userId]);
        for (const asset of assets) {
            await pool.query('INSERT INTO user_assets (user_id, asset_symbol) VALUES ($1, $2)', [req.userId, asset]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/user/trial-remaining', auth, async (req, res) => {
    res.json({ remaining: 3 });
});

// Generate signal
app.post('/api/trades/generate-signal', auth, async (req, res) => {
    const { assetSymbol } = req.body;
    if (!assetSymbol) return res.status(400).json({ error: 'Asset symbol required' });
    try {
        const direction = Date.now() % 2 === 0 ? 'BUY' : 'SELL';
        const entry = 100.0;
        const tp = entry * (direction === 'BUY' ? 1.005 : 0.995);
        const sl = entry * (direction === 'BUY' ? 0.997 : 1.003);
        await pool.query(
            `INSERT INTO auto_signals (asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence)
             VALUES ($1, $2, $3, $4, $5, 'High')`,
            [assetSymbol, direction, entry, tp, sl]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Price endpoint
app.get('/api/price', (req, res) => {
    const fallbacks = { XAUUSD: 2350, US30: 33500, NAS100: 18500 };
    res.json({ price: fallbacks[req.query.symbol] || 1.0 });
});

// Admin panel
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`
        <!DOCTYPE html>
        <html><head><title>SYNA Admin</title></head><body>
        <h1>SYNA Signal Panel</h1>
        <pre id="info">Loading...</pre>
        <script>
            fetch('/api/admin/latest-signal?secret=${secret}')
                .then(r => r.json())
                .then(d => document.getElementById('info').innerText = JSON.stringify(d, null, 2));
        </script>
        </body></html>
    `);
});

app.get('/api/admin/latest-signal', async (req, res) => {
    const { secret } = req.query;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const signalResult = await pool.query(`SELECT * FROM auto_signals WHERE sent_to_admin = FALSE ORDER BY generated_at DESC LIMIT 1`);
        if (signalResult.rows.length === 0) return res.json({ error: 'No pending signals' });
        const signal = signalResult.rows[0];
        const usersResult = await pool.query(`
            SELECT u.phone FROM users u
            JOIN user_assets ua ON u.id = ua.user_id
            WHERE ua.asset_symbol = $1
        `, [signal.asset_symbol]);
        res.json({
            signal,
            whatsapp_numbers: usersResult.rows.map(r => r.phone).filter(p => p)
        });
    } catch (err) { res.json({ error: 'No pending signals' }); }
});

app.post('/api/admin/mark-sent', async (req, res) => {
    const { secret, signal_id } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    await pool.query('UPDATE auto_signals SET sent_to_admin = TRUE WHERE id = $1', [signal_id]);
    res.json({ success: true });
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { secret, email } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!email) return res.status(400).json({ error: 'Email required' });
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    res.json({ success: true });
});

// Initialize DB
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(20) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS user_assets (
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            asset_symbol VARCHAR(20) NOT NULL,
            PRIMARY KEY (user_id, asset_symbol)
        );
        CREATE TABLE IF NOT EXISTS auto_signals (
            id SERIAL PRIMARY KEY,
            asset_symbol VARCHAR(20) NOT NULL,
            signal_type VARCHAR(4) CHECK (signal_type IN ('BUY','SELL')),
            entry_price DECIMAL(10,5),
            take_profit DECIMAL(10,5),
            stop_loss DECIMAL(10,5),
            confidence VARCHAR(20),
            generated_at TIMESTAMP DEFAULT NOW(),
            sent_to_admin BOOLEAN DEFAULT FALSE
        );
    `);
    console.log('Database ready');
}
initDB().catch(console.error);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
