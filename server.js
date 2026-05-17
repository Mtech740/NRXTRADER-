require('dotenv').config();
const initDatabase = require('./dbInit');

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const tradesRoutes = require('./routes/trades');
const premiumRoutes = require('./routes/premium');
const priceRoutes = require('./routes/price');
const statsRoutes = require('./routes/stats');
const mt5Routes = require('./routes/mt5');
const userRoutes = require('./routes/user');
const wsHandler = require('./websocket');

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

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/mt5', mt5Routes);
app.use('/api/user', userRoutes);

// ===================== ADMIN PANEL =====================
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        return res.status(401).send('Unauthorized. Provide ?secret=YOUR_SECRET');
    }
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYNA Admin Signal Panel</title>
        <style>body { font-family: system-ui; background: #0a0e17; color: #e2e8f0; padding: 20px; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .signal { border-left: 4px solid #10b981; }
        .numbers { background: #0a0e17; padding: 12px; border-radius: 8px; font-family: monospace; white-space: pre-wrap; }
        button { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-top: 10px; }
        .copy-btn { background: #10b981; }</style>
        </head>
        <body>
        <h1>📡 SYNA Signal Dispatch Panel</h1>
        <div id="signalCard" class="card signal">
            <h2>🟢 Latest SYNA Signal</h2>
            <div id="signalDetails">Loading...</div>
            <div id="numbersList"></div>
            <button id="copyBtn" class="copy-btn" style="display:none;">📋 Copy Message + Numbers</button>
            <button id="markSentBtn">✅ Mark as Sent</button>
        </div>
        <script>
            const ADMIN_SECRET = "${secret}";
            let currentSignalId = null;
            async function fetchLatest() {
                const res = await fetch('/api/admin/latest-signal?secret=' + ADMIN_SECRET);
                const data = await res.json();
                if (data.error) { document.getElementById('signalDetails').innerHTML = \`<p style="color:#ef4444">\${data.error}</p>\`; return; }
                currentSignalId = data.signal.id;
                document.getElementById('signalDetails').innerHTML = \`
                    <p><strong>Asset:</strong> \${data.signal.asset_symbol}</p>
                    <p><strong>Action:</strong> \${data.signal.signal_type}</p>
                    <p><strong>Entry:</strong> \${data.signal.entry_price}</p>
                    <p><strong>Take Profit:</strong> \${data.signal.take_profit}</p>
                    <p><strong>Stop Loss:</strong> \${data.signal.stop_loss}</p>
                    <p><strong>Confidence:</strong> \${data.signal.confidence}</p>
                    <p><strong>Generated:</strong> \${new Date(data.signal.generated_at).toLocaleString()}</p>\`;
                if (data.whatsapp_numbers && data.whatsapp_numbers.length) {
                    document.getElementById('numbersList').innerHTML = \`<hr><h3>📱 WhatsApp Numbers (\${data.whatsapp_numbers.length} subscribers)</h3><div class="numbers">\${data.whatsapp_numbers.join('<br>')}</div>\`;
                    document.getElementById('copyBtn').style.display = 'inline-block';
                } else { document.getElementById('numbersList').innerHTML = '<p>No active subscribers for this asset.</p>'; document.getElementById('copyBtn').style.display = 'none'; }
            }
            document.getElementById('copyBtn').onclick = () => {
                const signalDiv = document.getElementById('signalDetails').innerText;
                const numbersDiv = document.getElementById('numbersList').querySelector('.numbers')?.innerText || '';
                navigator.clipboard.writeText(\`📢 SYNA SIGNAL\\n\\n\${signalDiv}\\n\\n📱 Send to:\\n\${numbersDiv}\`).then(() => alert('Copied!'));
            };
            document.getElementById('markSentBtn').onclick = async () => {
                if (!currentSignalId) return alert('No signal');
                const res = await fetch('/api/admin/mark-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: ADMIN_SECRET, signal_id: currentSignalId }) });
                const data = await res.json();
                if (data.success) { alert('Signal marked as sent!'); fetchLatest(); } else { alert('Error: ' + data.error); }
            };
            fetchLatest();
            setInterval(fetchLatest, 30000);
        </script>
        </body>
        </html>
    `);
});

app.get('/api/admin/latest-signal', async (req, res) => {
    const { secret } = req.query;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const pool = require('./config/db');
        const signalResult = await pool.query(`SELECT * FROM auto_signals WHERE sent_to_admin = FALSE ORDER BY generated_at DESC LIMIT 1`);
        if (signalResult.rows.length === 0) return res.json({ error: 'No pending signals' });
        const signal = signalResult.rows[0];
        const usersResult = await pool.query(`
            SELECT u.phone FROM users u
            JOIN user_assets ua ON u.id = ua.user_id
            WHERE ua.asset_symbol = $1 AND (u.signal_subscription_end > NOW() OR u.trial_signals_used < 3)
        `, [signal.asset_symbol]);
        res.json({ signal: { id: signal.id, asset_symbol: signal.asset_symbol, signal_type: signal.signal_type, entry_price: parseFloat(signal.entry_price), take_profit: parseFloat(signal.take_profit), stop_loss: parseFloat(signal.stop_loss), confidence: signal.confidence, generated_at: signal.generated_at }, whatsapp_numbers: usersResult.rows.map(r => r.phone).filter(p => p) });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/mark-sent', async (req, res) => {
    const { secret, signal_id } = req.body;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const pool = require('./config/db');
        await pool.query('UPDATE auto_signals SET sent_to_admin = TRUE WHERE id = $1', [signal_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/activate-subscription', async (req, res) => {
    const { secret, userId, plan, durationDays = 30 } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!userId || !plan) return res.status(400).json({ error: 'userId and plan required' });
    try {
        const pool = require('./config/db');
        const expiresAt = new Date(Date.now() + durationDays * 86400000);
        await pool.query(`UPDATE users SET subscription_plan = $1, signal_subscription_end = $2, trial_signals_used = 3 WHERE id = $3`, [plan, expiresAt, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

wss.on('connection', (ws, req) => { wsHandler(ws, req, wss); });
initDatabase();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => { console.log(`NRXTRADER backend running on port ${PORT}`); });
