const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

const NORMAL_WIN_RATE = 0.45;
const PROFIT_PERCENT = 0.12;
const LOSS_PERCENT = 0.08;
const TRADE_FEE = 0.003;

const PROMO_TRADE_LIMIT = 1000;
const PROMO_WIN_RATE = 0.80;

router.post('/manual', auth, async (req, res) => {
    try {
        const { symbol, direction, amount } = req.body;
        if (!symbol || !direction || !amount) {
            return res.status(400).json({ error: 'Missing fields' });
        }

        // Get current total trades
        const stats = await pool.query("SELECT value FROM platform_stats WHERE key = 'total_trades'");
        const totalTrades = parseInt(stats.rows[0].value);
        const winRate = totalTrades < PROMO_TRADE_LIMIT ? PROMO_WIN_RATE : NORMAL_WIN_RATE;

        const tradeAmount = parseFloat(amount);
        const fee = tradeAmount * TRADE_FEE;

        const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        if (user.rows[0].balance_zmw < tradeAmount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }
        await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [tradeAmount, req.userId]);

        const win = Math.random() < winRate;
        const pnl = win ? tradeAmount * PROFIT_PERCENT : -tradeAmount * LOSS_PERCENT;
        const netChange = tradeAmount + pnl - fee;
        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [netChange, req.userId]);

        // Increment global trade counter
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
