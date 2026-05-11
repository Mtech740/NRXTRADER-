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

const corsOptions = {
    origin: [
        'https://mtech740.github.io',
        'https://trader.nrxproject.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// CORS headers
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && corsOptions.origin.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

app.use(cors(corsOptions));

// Preflight
app.options(/.*/, cors(corsOptions));

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'NRXTRADER API ONLINE' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'NRXTRADER API ONLINE' });
});

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/stats', statsRoutes);

initDatabase();

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`NRXTRADER backend running on port ${PORT}`);
});
