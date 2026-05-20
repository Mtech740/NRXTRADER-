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

// ==================== TEMPORARY FIX ====================
app.get('/api/fix-table', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    try {
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20) DEFAULT 'free';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_signals_used INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS signal_subscription_end TIMESTAMP;
        `);
        res.send('Table fixed! Now register a new user.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error: ' + err.message);
    }
});

// ==================== AUTH ====================
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
        console.error(err);
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
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== USER ASSETS ====================
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
};

app.get('/api/user/assets', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT asset_symbol FROM user_assets WHERE user_id = $1', [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) { res.json({ assets: [] }); }
});

app.post('/api/user/assets', authMiddleware, async (req, res) => {
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

app.get('/api/user/trial-remaining', authMiddleware, async (req, res) => {
    const user = await pool.query('SELECT COALESCE(trial_signals_used, 0) as used FROM users WHERE id = $1', [req.userId]);
    const used = parseInt(user.rows[0]?.used) || 0;
    res.json({ remaining: Math.max(0, 3 - used) });
});

// ==================== PRICE & SIGNAL ====================
app.get('/api/price', async (req, res) => {
    const { symbol } = req.query;
    const fallbacks = { 'XAUUSD': 2350, 'US30': 33500, 'NAS100': 18500, 'EURUSD': 1.08, 'GBPUSD': 1.26, 'BTCUSD': 65000 };
    res.json({ price: fallbacks[symbol] || 1.0 });
});

app.post('/api/trades/generate-signal', authMiddleware, async (req, res) => {
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

// ==================== ADMIN PANEL (with WhatsApp send buttons) ====================
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>SYNA Admin Console</title>
            <style>
                body { font-family: monospace; background: #0a0e17; color: #e2e8f0; padding: 20px; }
                .signal-card { background: #111827; border-left: 4px solid #10b981; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
                .numbers-list { background: #0a0e17; border-radius: 8px; padding: 12px; margin-top: 12px; }
                .number-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #1f2937; }
                .send-btn { background: #25D366; color: black; border: none; padding: 6px 16px; border-radius: 20px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; }
                button { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; margin-top: 10px; }
            </style>
        </head>
        <body>
            <h1>SYNA Signal Dispatch</h1>
            <div id="signalCard" class="signal-card">
                <h2>Latest Signal</h2>
                <div id="signalDetails">Loading...</div>
                <div id="numbersContainer"></div>
                <button id="markSentBtn">Mark as Sent</button>
            </div>
            <script>
                const ADMIN_SECRET = "${secret}";
                let currentSignalId = null;

                async function fetchLatest() {
                    const res = await fetch('/api/admin/latest-signal?secret=' + ADMIN_SECRET);
                    const data = await res.json();
                    if (data.error) {
                        document.getElementById('signalDetails').innerHTML = '<p style="color:#ef4444">' + data.error + '</p>';
                        document.getElementById('numbersContainer').innerHTML = '';
                        return;
                    }
                    currentSignalId = data.signal.id;
                    const sig = data.signal;
                    document.getElementById('signalDetails').innerHTML = \`
                        <p><strong>Asset:</strong> \${sig.asset_symbol}</p>
                        <p><strong>Action:</strong> \${sig.signal_type}</p>
                        <p><strong>Entry:</strong> \${sig.entry_price}</p>
                        <p><strong>Take Profit:</strong> \${sig.take_profit}</p>
                        <p><strong>Stop Loss:</strong> \${sig.stop_loss}</p>
                        <p><strong>Confidence:</strong> \${sig.confidence}</p>
                        <p><strong>Generated:</strong> \${new Date(sig.generated_at).toLocaleString()}</p>
                    \`;
                    if (data.whatsapp_numbers && data.whatsapp_numbers.length) {
                        let numbersHtml = '<h3>WhatsApp Recipients</h3><div class="numbers-list">';
                        for (let phone of data.whatsapp_numbers) {
                            let cleanPhone = phone.replace(/\\D/g, '');
                            if (!cleanPhone.startsWith('260') && phone.includes('+260')) cleanPhone = phone.replace('+', '');
                            const message = \`📢 SYNA SIGNAL\\nAsset: \${sig.asset_symbol}\\nAction: \${sig.signal_type}\\nEntry: \${sig.entry_price}\\nTP: \${sig.take_profit}\\nSL: \${sig.stop_loss}\\nConfidence: \${sig.confidence}\`;
                            const waLink = \`https://wa.me/\${cleanPhone}?text=\${encodeURIComponent(message)}\`;
                            numbersHtml += \`
                                <div class="number-item">
                                    <span>\${phone}</span>
                                    <a href="\${waLink}" target="_blank" class="send-btn">Send via WhatsApp</a>
                                </div>
                            \`;
                        }
                        numbersHtml += '</div>';
                        document.getElementById('numbersContainer').innerHTML = numbersHtml;
                    } else {
                        document.getElementById('numbersContainer').innerHTML = '<p>No active subscribers for this asset.</p>';
                    }
                }

                document.getElementById('markSentBtn').onclick = async () => {
                    if (!currentSignalId) return alert('No signal to mark');
                    const res = await fetch('/api/admin/mark-sent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ secret: ADMIN_SECRET, signal_id: currentSignalId })
                    });
                    const data = await res.json();
                    if (data.success) { alert('Signal marked as sent'); fetchLatest(); }
                    else alert('Error: ' + data.error);
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

// ==================== INITIALIZE DATABASE ====================
async function initDB() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(20) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            subscription_plan VARCHAR(20) DEFAULT 'free',
            trial_signals_used INTEGER DEFAULT 0,
            signal_subscription_end TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_assets (
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            asset_symbol VARCHAR(20) NOT NULL,
            PRIMARY KEY (user_id, asset_symbol)
        );
    `);
    await pool.query(`
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
    console.log('Database tables ready');
}
initDB().catch(console.error);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
