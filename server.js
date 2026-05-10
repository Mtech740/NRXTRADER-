require('dotenv').config();
const initDatabase = require('./dbInit');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const tradesRoutes = require('./routes/trades');
const premiumRoutes = require('./routes/premium');
const adminRoutes = require('./routes/admin');
const priceRoutes = require('./routes/price');
const { startSynaEngine } = require('./services/synaEngine');

const app = express();

const corsOptions = {
    origin: 'https://mtech740.github.io',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'NRXTRADER API ONLINE' }));

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/price', priceRoutes);

initDatabase();

// Start the SYNA engine (server‑side)
startSynaEngine();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`NRXTRADER backend running on port ${PORT}`));
