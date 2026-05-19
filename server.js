require('dotenv').config();
const initDatabase = require('./dbInit');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const tradesRoutes = require('./routes/trades');
const priceRoutes = require('./routes/price');

const app = express();

const corsOptions = {
    origin: ['https://mtech740.github.io', 'https://trader.nrxproject.com', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000', 'http://localhost:8080'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'NRXTRADER API ONLINE' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/price', priceRoutes);

// User asset and trial endpoints (inline)
const pool = require('./config/db');
const auth = require('./middleware/auth');

app.get('/api/user/assets', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT asset_symbol FROM user_assets WHERE user_id = $1', [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
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
    try {
        const user = await pool.query('SELECT trial_signals_used FROM users WHERE id = $1', [req.userId]);
        const used = parseInt(user.rows[0].trial_signals_used) || 0;
        res.json({ remaining: Math.max(0, 3 - used) });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Admin panel (same as before, but without WebSocket)
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`<html>... (keep same admin HTML as before) ...</html>`); // you can copy the full admin panel HTML from previous message
});

app.get('/api/admin/latest-signal', async (req, res) => { /* same as before */ });
app.post('/api/admin/mark-sent', async (req, res) => { /* same as before */ });
app.post('/api/admin/activate-subscription', async (req, res) => { /* same as before */ });

initDatabase();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
