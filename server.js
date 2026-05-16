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
const mt5Routes = require('./routes/mt5');
const wsHandler = require('./websocket');
const { bot, sendSignalToTelegram } = require('./telegramBot'); // ✅ Telegram bot

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
app.use('/api/mt5', mt5Routes);

// ✅ New route: Link Telegram ID to logged-in user
app.post('/api/link-telegram', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;
        const { telegram_id } = req.body;
        if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
        const pool = require('./config/db');
        await pool.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegram_id, userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Link telegram error:', err);
        res.status(500).json({ error: 'Server error' });
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

// Make sendSignalToTelegram available globally if needed (optional)
module.exports = { sendSignalToTelegram };
