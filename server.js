require('dotenv').config();
const initDatabase = require('./dbInit');

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const tradesRoutes = require('./routes/trades');
const premiumRoutes = require('./routes/premium');
const priceRoutes = require('./routes/price');
const statsRoutes = require('./routes/stats');
const mt5Routes = require('./routes/mt5');        // EA registration, API keys
const wsHandler = require('./websocket');         // WebSocket signal handler

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS configuration
const corsOptions = {
    origin: [
        'https://mtech740.github.io',
        'https://trader.nrxproject.com',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:3000',
        'http://localhost:8080'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

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
app.options(/.*/, cors(corsOptions));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'NRXTRADER API ONLINE' });
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'NRXTRADER API ONLINE' });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/mt5', mt5Routes);   // MT5 registration & status

// 🔧 TEMPORARY: Create MT5 tables (remove after running once)
app.get('/api/setup-mt5-tables', async (req, res) => {
    try {
        const pool = require('./config/db');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mt5_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                api_key TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS mt5_trial_usage (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                remaining_signals INTEGER DEFAULT 3
            );
            CREATE TABLE IF NOT EXISTS mt5_signal_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                account_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                lot_size DECIMAL(10,2),
                stop_loss DECIMAL(10,5),
                take_profit DECIMAL(10,5),
                sent_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS mt5_trade_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                account_id TEXT NOT NULL,
                request_id TEXT,
                symbol TEXT,
                action TEXT,
                lot_size DECIMAL(10,2),
                status TEXT,
                order_id INTEGER,
                error TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        res.send('MT5 tables created successfully!');
    } catch (err) {
        console.error('Setup error:', err);
        res.status(500).send('Error: ' + err.message);
    }
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    wsHandler(ws, req, wss);
});

initDatabase();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`NRXTRADER backend running on port ${PORT}`);
    console.log(`WebSocket server ready at ws://localhost:${PORT}`);
});
