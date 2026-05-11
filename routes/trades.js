const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// Normal house edge (used for manual trading)
const NORMAL_WIN_RATE = 0.45;
const PROFIT_PERCENT = 0.12;
const LOSS_PERCENT = 0.08;
const TRADE_FEE = 0.003;

// Promo win rate until total_trades reaches this limit (used only by SYNA)
const PROMO_TRADE_LIMIT = 1000;
const PROMO_WIN_RATE = 0.80;

// Helper: get current win rate based on global trade counter (used by SYNA)
async function getWinRate() {
    const stats = await pool.query("SELECT value FROM platform_stats WHERE key = 'total_trades'");
    const total = parseInt(stats.rows[0].value);
    return total < PROMO_TRADE_LIMIT ? PROMO_WIN_RATE : NORMAL_WIN_RATE;
}

// ---------- OPEN POSITION (manual only) ----------
router.post('/open', auth, async (req, res) => {
    try {
        const { symbol, direction, amount } = req.body;
        if (!symbol || !direction || !amount) return res.status(400).json({ error: 'Missing fields' });

        const tradeAmount = parseFloat(amount);

        // Check balance
        const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        if (user.rows[0].balance_zmw < tradeAmount) return res.status(400).json({ error: 'Insufficient balance' });

        // Deduct the full amount (used margin)
        await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [tradeAmount, req.userId]);

        // Insert open position
        const result = await pool.query(
            `INSERT INTO trades (user_id, symbol, direction, entry_price, quantity, status, opened_at)
             VALUES ($1, $2, $3, 0, $4, 'OPEN', NOW()) RETURNING id`,
            [req.userId, symbol, direction, tradeAmount]
        );
        const positionId = result.rows[0].id;

        res.json({ success: true, position_id: positionId, used_margin: tradeAmount });
    } catch (err) {
        console.error('Open trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ---------- CLOSE POSITION (manual only) ----------
router.post('/close', auth, async (req, res) => {
    try {
        const { position_id } = req.body;
        if (!position_id) return res.status(400).json({ error: 'Missing position_id' });

        // Fetch open position
        const pos = await pool.query('SELECT * FROM trades WHERE id = $1 AND status = $2', [position_id, 'OPEN']);
        if (pos.rows.length === 0) return res.status(400).json({ error: 'Position not found or already closed' });

        const trade = pos.rows[0];
        const tradeAmount = parseFloat(trade.quantity);
        const fee = tradeAmount * TRADE_FEE;

        // ✅ MANUAL TRADE ALWAYS USES NORMAL HOUSE EDGE (45%)
        const winRate = NORMAL_WIN_RATE;
        const win = Math.random() < winRate;
        const pnl = win ? tradeAmount * PROFIT_PERCENT : -tradeAmount * LOSS_PERCENT;
        const netChange = tradeAmount + pnl - fee;

        // Add net change back to balance
        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [netChange, trade.user_id]);

        // Mark position as closed
        await pool.query('UPDATE trades SET status = $1, closed_at = NOW(), pnl = $2, fee = $3, win = $4 WHERE id = $5',
            ['CLOSED', pnl, fee, win, position_id]);

        // Increment global trade counter
        await pool.query("UPDATE platform_stats SET value = value + 1 WHERE key = 'total_trades'");

        // Fetch new balance
        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [trade.user_id]);
        const finalBalance = parseFloat(newBal.rows[0].balance_zmw);

        res.json({
            success: true,
            symbol: trade.symbol,
            direction: trade.direction,
            amount: tradeAmount,
            pnl,
            win,
            new_balance: finalBalance
        });
    } catch (err) {
        console.error('Close trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ---------- INSTANT TRADE (SYNA only) – unchanged ----------
router.post('/manual', auth, async (req, res) => {
    try {
        const { symbol, direction, amount } = req.body;
        if (!symbol || !direction || !amount) return res.status(400).json({ error: 'Missing fields' });

        const tradeAmount = parseFloat(amount);
        const fee = tradeAmount * TRADE_FEE;

        const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        if (user.rows[0].balance_zmw < tradeAmount) return res.status(400).json({ error: 'Insufficient balance' });

        await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [tradeAmount, req.userId]);

        // SYNA uses the promotional win rate
        const winRate = await getWinRate();
        const win = Math.random() < winRate;
        const pnl = win ? tradeAmount * PROFIT_PERCENT : -tradeAmount * LOSS_PERCENT;
        const netChange = tradeAmount + pnl - fee;
        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [netChange, req.userId]);

        await pool.query("UPDATE platform_stats SET value = value + 1 WHERE key = 'total_trades'");

        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        const finalBalance = parseFloat(newBal.rows[0].balance_zmw);

        res.json({
            success: true,
            symbol,
            direction,
            amount: tradeAmount,
            pnl,
            win,
            new_balance: finalBalance
        });
    } catch (err) {
        console.error('Trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
