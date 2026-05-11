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

// ✅ WILDCARD CORS – allows requests from any origin
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests for all routes
app.options('*', cors());

app.use(express.json());

/* ROOT ROUTE */
app.get('/', (req, res) => {
    res.json({ status: 'NRXTRADER API ONLINE' });
});

/* ROUTES */
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/stats', statsRoutes);

/* DATABASE */
initDatabase();

/* ERROR HANDLER */
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`NRXTRADER backend running on port ${PORT}`);
});
