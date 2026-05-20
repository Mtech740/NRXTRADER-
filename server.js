require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'NRXTRADER API ONLINE' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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

// ==================== PRICE CACHE & REALISTIC PRICE ====================
async function ensurePriceCacheTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS price_cache (
            asset_symbol VARCHAR(20) PRIMARY KEY,
            last_price DECIMAL(15,5),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);
}

async function getLastPrice(asset) {
    const res = await pool.query('SELECT last_price FROM price_cache WHERE asset_symbol = $1', [asset]);
    return res.rows.length ? parseFloat(res.rows[0].last_price) : null;
}

async function updatePriceCache(asset, price) {
    await pool.query(`
        INSERT INTO price_cache (asset_symbol, last_price, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (asset_symbol) DO UPDATE SET last_price = $2, updated_at = NOW()
    `, [asset, price]);
}

function getRealisticPrice(asset) {
    const basePrices = {
        'XAUUSD': 2350.50,
        'US30': 33500.00,
        'NAS100': 18500.00,
        'EURUSD': 1.0850,
        'GBPUSD': 1.2650,
        'BTCUSD': 65000.00
    };
    let price = basePrices[asset] || 100.00;
    const variation = (Math.random() - 0.5) * 0.01 * price;
    return price + variation;
}

// ==================== SIGNAL GENERATION ====================
app.post('/api/trades/generate-signal', authMiddleware, async (req, res) => {
    const { assetSymbol } = req.body;
    if (!assetSymbol) return res.status(400).json({ error: 'Asset symbol required' });
    try {
        await ensurePriceCacheTable();
        const currentPrice = getRealisticPrice(assetSymbol);
        const lastPrice = await getLastPrice(assetSymbol);
        let direction = null;
        let confidence = 'Medium';
        if (lastPrice !== null) {
            const percentChange = ((currentPrice - lastPrice) / lastPrice) * 100;
            if (percentChange > 0.05) {
                direction = 'BUY';
                confidence = percentChange > 0.2 ? 'High' : 'Medium';
            } else if (percentChange < -0.05) {
                direction = 'SELL';
                confidence = percentChange < -0.2 ? 'High' : 'Medium';
            }
        }
        await updatePriceCache(assetSymbol, currentPrice);
        if (direction) {
            const entry = currentPrice;
            const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
            const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
            await pool.query(
                `INSERT INTO auto_signals (asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [assetSymbol, direction, entry, tp, sl, confidence]
            );
            res.json({ success: true, direction, price: currentPrice });
        } else {
            res.json({ success: true, message: 'No significant price movement', price: currentPrice });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== NOTIFICATION ENDPOINT ====================
app.post('/api/admin/notify-signal', async (req, res) => {
    const { secret, userId, assetSymbol } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    try {
        await pool.query('UPDATE users SET trial_signals_used = trial_signals_used + 1 WHERE id = $1', [userId]);
        const ntfyTopic = process.env.NTFY_TOPIC || 'syna_alerts';
        fetch(`https://ntfy.sh/${ntfyTopic}`, {
            method: 'POST',
            body: `SYNA signal generated for ${assetSymbol} by user ${userId}`,
            headers: { 'Title': 'SYNA Alert', 'Priority': 'high' }
        }).catch(e => console.error('Notification error:', e));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== ADMIN PANEL ====================
app.get('/admin', (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(401).send('Unauthorized');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYNA Admin Console</title>
        <style>body{font-family:monospace;background:#0a0e17;color:#e2e8f0;padding:20px}.signal-card{background:#111827;border-left:4px solid #10b981;border-radius:12px;padding:20px;margin-bottom:20px}.numbers-list{background:#0a0e17;border-radius:8px;padding:12px;margin-top:12px}.number-item{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #1f2937}.send-btn{background:#25D366;color:black;border:none;padding:6px 16px;border-radius:20px;cursor:pointer;text-decoration:none;display:inline-block}button{background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;margin-top:10px}.delete-btn{background:#ef4444}</style></head>
        <body><h1>SYNA Signal Dispatch</h1><div id="signalCard" class="signal-card"><h2>Latest Signal</h2><div id="signalDetails">Loading...</div><div id="numbersContainer"></div><button id="markSentBtn">Mark as Sent</button><button id="deleteAllBtn" class="delete-btn">Delete All Pending Signals</button></div>
        <script>
            const ADMIN_SECRET = "${secret}";
            let currentSignalId = null;
            async function fetchLatest() {
                const res = await fetch('/api/admin/latest-signal?secret=' + ADMIN_SECRET);
                const data = await res.json();
                if (data.error) { document.getElementById('signalDetails').innerHTML = '<p style="color:#ef4444">' + data.error + '</p>'; document.getElementById('numbersContainer').innerHTML = ''; return; }
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
                        numbersHtml += \`<div class="number-item"><span>\${phone}</span><a href="\${waLink}" target="_blank" class="send-btn">Send via WhatsApp</a></div>\`;
                    }
                    numbersHtml += '</div>';
                    document.getElementById('numbersContainer').innerHTML = numbersHtml;
                } else {
                    document.getElementById('numbersContainer').innerHTML = '<p>No active subscribers for this asset.</p>';
                }
            }
            document.getElementById('markSentBtn').onclick = async () => {
                if (!currentSignalId) return alert('No signal to mark');
                const res = await fetch('/api/admin/mark-sent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: ADMIN_SECRET, signal_id: currentSignalId }) });
                const data = await res.json();
                if (data.success) { alert('Signal marked as sent'); fetchLatest(); } else alert('Error: ' + data.error);
            };
            document.getElementById('deleteAllBtn').onclick = async () => {
                if (confirm('Delete ALL pending signals?')) {
                    const res = await fetch('/api/admin/clear-fake-signals?secret=' + ADMIN_SECRET);
                    const text = await res.text();
                    alert(text);
                    fetchLatest();
                }
            };
            fetchLatest();
            setInterval(fetchLatest, 30000);
        </script></body></html>
    `);
});

// Filter WhatsApp numbers by asset (only users who selected that asset)
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
            WHERE ua.asset_symbol = $1 AND u.phone IS NOT NULL AND u.phone != ''
        `, [signal.asset_symbol]);
        res.json({ signal, whatsapp_numbers: usersResult.rows.map(r => r.phone) });
    } catch (err) { res.json({ error: 'No pending signals' }); }
});

app.post('/api/admin/mark-sent', async (req, res) => {
    const { secret, signal_id } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    await pool.query('UPDATE auto_signals SET sent_to_admin = TRUE WHERE id = $1', [signal_id]);
    res.json({ success: true });
});

// GET endpoint to delete user by email (simple URL)
app.get('/api/admin/delete-user-get', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    const email = req.query.email;
    if (!email) return res.status(400).send('Email parameter missing');
    try {
        await pool.query('DELETE FROM users WHERE email = $1', [email]);
        res.send(`User with email ${email} deleted successfully.`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { secret, email } = req.body;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Unauthorized' });
    if (!email) return res.status(400).json({ error: 'Email required' });
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    res.json({ success: true });
});

// ==================== TEMPORARY ADMIN ENDPOINTS ====================
app.get('/api/admin/clear-fake-signals', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    try {
        const result = await pool.query(`DELETE FROM auto_signals WHERE entry_price BETWEEN 99 AND 101`);
        res.send(`Deleted ${result.rowCount} fake signals. Now generate a new signal.`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

app.get('/api/admin/reset-trial', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    const email = req.query.email || 'freshstart2024@mail.com';
    try {
        await pool.query('UPDATE users SET trial_signals_used = 0 WHERE email = $1', [email]);
        res.send(`Trial reset for ${email}. Now you can generate 3 free signals again.`);
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

app.get('/api/admin/force-signal', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Unauthorized');
    const asset = req.query.asset || 'XAUUSD';
    try {
        await ensurePriceCacheTable();
        const currentPrice = getRealisticPrice(asset);
        const lastPrice = await getLastPrice(asset);
        let direction;
        if (lastPrice !== null) {
            direction = currentPrice > lastPrice ? 'BUY' : 'SELL';
        } else {
            direction = Math.random() < 0.5 ? 'BUY' : 'SELL';
        }
        const entry = currentPrice;
        const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
        const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
        await pool.query(
            `INSERT INTO auto_signals (asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence)
             VALUES ($1, $2, $3, $4, $5, 'High')`,
            [asset, direction, entry, tp, sl]
        );
        await updatePriceCache(asset, currentPrice);
        res.send(`New signal generated for ${asset} (${direction}) at price ${entry.toFixed(2)}. Refresh admin panel.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error: ' + err.message);
    }
});

// ==================== AUTO SIGNAL GENERATION (EVERY 5 MINUTES) ====================
setInterval(async () => {
    const assets = ['XAUUSD', 'US30', 'NAS100', 'EURUSD', 'GBPUSD', 'BTCUSD'];
    console.log('Auto-signal cron running...');
    for (const asset of assets) {
        try {
            await ensurePriceCacheTable();
            const currentPrice = getRealisticPrice(asset);
            const lastPrice = await getLastPrice(asset);
            if (lastPrice !== null) {
                const percentChange = ((currentPrice - lastPrice) / lastPrice) * 100;
                if (Math.abs(percentChange) > 0.05) {
                    const direction = currentPrice > lastPrice ? 'BUY' : 'SELL';
                    const entry = currentPrice;
                    const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
                    const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
                    await pool.query(
                        `INSERT INTO auto_signals (asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence)
                         VALUES ($1, $2, $3, $4, $5, 'Medium')`,
                        [asset, direction, entry, tp, sl]
                    );
                    await updatePriceCache(asset, currentPrice);
                    console.log(`Auto-signal generated for ${asset} (${direction}) at ${entry.toFixed(2)}`);
                } else {
                    await updatePriceCache(asset, currentPrice);
                }
            } else {
                await updatePriceCache(asset, currentPrice);
            }
        } catch (err) {
            console.error(`Auto-signal error for ${asset}:`, err);
        }
    }
}, 5 * 60 * 1000); // every 5 minutes

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
            entry_price DECIMAL(15,5),
            take_profit DECIMAL(15,5),
            stop_loss DECIMAL(15,5),
            confidence VARCHAR(20),
            generated_at TIMESTAMP DEFAULT NOW(),
            sent_to_admin BOOLEAN DEFAULT FALSE
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS price_cache (
            asset_symbol VARCHAR(20) PRIMARY KEY,
            last_price DECIMAL(15,5),
            updated_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('Database tables ready');
}
initDB().catch(console.error);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
