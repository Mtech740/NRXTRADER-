require('dotenv').config();
const initDatabase = require('./dbInit');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const tradesRoutes = require('./routes/trades');
const premiumRoutes = require('./routes/premium');

const app = express();

// Allow your GitHub Pages origin explicitly
app.use(cors({
    origin: ['https://mtech740.github.io'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Handle preflight for all routes
app.options('*', cors());

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);

// Initialize database tables
initDatabase();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`NRXTRADER backend running on port ${PORT}`));
