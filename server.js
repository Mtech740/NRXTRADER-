require('dotenv').config();
const initDatabase = require('./dbInit');

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const tradesRoutes = require('./routes/trades');
const premiumRoutes = require('./routes/premium');
const priceRoutes = require('./routes/price');
const statsRoutes = require('./routes/stats');

const app = express();

app.use(express.json());

/* CORS FIX */
const corsOptions = {
    origin: 'https://mtech740.github.io',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));

/* HANDLE PREFLIGHT */
app.options(/.*/, cors(corsOptions));

/* ROOT ROUTE */
app.get('/', (req, res) => {
    res.json({
        status: 'NRXTRADER API ONLINE'
    });
});

/* ROUTES */
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/stats', statsRoutes);

// ========== TEMPORARY SETUP ROUTE (delete after first use) ==========
app.get('/api/setup', async (req, res) => {
    const pool = require('./config/db');
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS platform_stats (
                key VARCHAR PRIMARY KEY,
                value INTEGER DEFAULT 0
            );
            INSERT INTO platform_stats (key, value) VALUES ('total_trades', 0) ON CONFLICT (key) DO NOTHING;
        `);
        res.send('Database setup complete! You may now delete this route.');
    } catch (err) {
        res.status(500).send('Setup failed: ' + err.message);
    }
});
// ===============================================================

/* DATABASE */
initDatabase();

/* ERROR HANDLER */
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({
        error: 'Internal server error'
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`NRXTRADER backend running on port ${PORT}`);
});
