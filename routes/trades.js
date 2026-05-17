const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// ---- Demo trading constants (only for /open and /close, not used for signals) ----
const NORMAL_WIN_RATE = 0.45;
const PROFIT_PERCENT = 0.12;
const LOSS_PERCENT = 0.08;
const TRADE_FEE = 0.003;

// ---- Helper: fetch live price from your own price API ----
async function fetchLivePrice(symbol) {
    const apiUrl = process.env.API_BASE_URL || 'https://nrxtrader-api.onrender.com';
    const res = await fetch(`${apiUrl}/api/price?symbol=${symbol}`);
    const data = await res.json();
    return data.price;
}

// ---- Simple in‑memory cache to remember last price per asset ----
const lastPrices = {};

// ---- Generate a signal based on real price movement and store in auto_signals ----
async function generateAndStoreSignal(assetSymbol) {
    const currentPrice = await fetchLivePrice(assetSymbol);
    const lastPrice = lastPrices[assetSymbol] || currentPrice;
    const priceChangePercent = ((currentPrice - lastPrice) / lastPrice) * 100;
    lastPrices[assetSymbol] = currentPrice;

    // Only generate a signal if price moved more than 0.05% (adjustable)
    if (Math.abs(priceChangePercent) < 0.05) {
        return null; // no significant movement
    }

    let direction, confidence, entry, takeProfit, stopLoss;
    entry = currentPrice;

    if (priceChangePercent > 0) {
        direction = 'BUY';
        confidence = priceChangePercent > 0.2 ? 'High' : 'Medium';
        takeProfit = entry * 1.005;   // +0.5%
        stopLoss   = entry * 0.997;   // -0.3%
    } else {
        direction = 'SELL';
        confidence = priceChangePercent < -0.2 ? 'High' : 'Medium';
        takeProfit = entry * 0.995;   // -0.5%
        stopLoss   = entry * 1.003;   // +0.3%
    }

    await pool.query(`
        INSERT INTO auto_signals (asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, [assetSymbol, direction, entry, takeProfit, stopLoss, confidence]);

    return { assetSymbol, direction, entry, takeProfit, stopLoss, confidence };
}

// ==================== DEMO TRADING ENDPOINTS (optional) ====================
router.post('/open', auth, async (req, res) => {
    try {
        const { symbol, direction, amount } = req.body;
        if (!symbol || !direction || !amount) return res.status(400).json({ error: 'Missing fields' });

        const tradeAmount = parseFloat(amount);
        const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        if (user.rows[0].balance_zmw < tradeAmount) return res.status(400).json({ error: 'Insufficient balance' });

        await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [tradeAmount, req.userId]);
        const result = await pool.query(
            `INSERT INTO trades (user_id, symbol, direction, entry_price, quantity, status, opened_at)
             VALUES ($1, $2, $3, 0, $4, 'OPEN', NOW()) RETURNING id`,
            [req.userId, symbol, direction, tradeAmount]
        );
        res.json({ success: true, position_id: result.rows[0].id, used_margin: tradeAmount });
    } catch (err) {
        console.error('Open trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/close', auth, async (req, res) => {
    try {
        const { position_id } = req.body;
        if (!position_id) return res.status(400).json({ error: 'Missing position_id' });

        const pos = await pool.query('SELECT * FROM trades WHERE id = $1 AND status = $2', [position_id, 'OPEN']);
        if (pos.rows.length === 0) return res.status(400).json({ error: 'Position not found or already closed' });

        const trade = pos.rows[0];
        const tradeAmount = parseFloat(trade.quantity);
        const fee = tradeAmount * TRADE_FEE;

        const win = Math.random() < NORMAL_WIN_RATE;
        const pnl = win ? tradeAmount * PROFIT_PERCENT : -tradeAmount * LOSS_PERCENT;
        const netChange = tradeAmount + pnl - fee;

        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [netChange, trade.user_id]);
        await pool.query('UPDATE trades SET status = $1, closed_at = NOW(), pnl = $2, fee = $3, win = $4 WHERE id = $5',
            ['CLOSED', pnl, fee, win, position_id]);
        await pool.query("UPDATE platform_stats SET value = value + 1 WHERE key = 'total_trades'");

        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [trade.user_id]);
        res.json({
            success: true,
            symbol: trade.symbol,
            direction: trade.direction,
            amount: tradeAmount,
            pnl,
            win,
            new_balance: parseFloat(newBal.rows[0].balance_zmw)
        });
    } catch (err) {
        console.error('Close trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== SIGNAL GENERATION ENDPOINT ====================
// Replaces the old /manual endpoint – generates a real signal from market data
router.post('/generate-signal', auth, async (req, res) => {
    const { assetSymbol } = req.body;
    if (!assetSymbol) return res.status(400).json({ error: 'Asset symbol required' });
    try {
        const signal = await generateAndStoreSignal(assetSymbol);
        if (signal) {
            res.json({ success: true, signal });
        } else {
            res.json({ success: true, message: 'No significant movement, no signal generated' });
        }
    } catch (err) {
        console.error('Signal generation error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deprecated old /manual endpoint
router.post('/manual', auth, async (req, res) => {
    res.status(410).json({ error: 'This endpoint is deprecated. Use /generate-signal instead.' });
});

module.exports = router;
