const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// House edge parameters
const WIN_RATE = 0.45;           // 45% chance trader wins
const PROFIT_PERCENT = 0.02;     // 2% profit on win
const LOSS_PERCENT = 0.03;       // 3% loss on loss
const FEE_RATE = 0.003;          // 0.3% trade fee

router.post('/manual', auth, async (req, res) => {
    try {
        const { symbol, direction, amount } = req.body;
        if (!symbol || !direction || !amount) {
            return res.status(400).json({ error: 'Missing fields' });
        }

        const fee = amount * FEE_RATE;
        const win = Math.random() < WIN_RATE;
        const pnl = win ? amount * PROFIT_PERCENT : -amount * LOSS_PERCENT;
        const net = pnl - fee;

        await pool.query(
            'UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2',
            [net, req.userId]
        );

        const newBal = await pool.query(
            'SELECT balance_zmw FROM users WHERE id = $1',
            [req.userId]
        );

        res.json({
            success: true,
            symbol,
            direction,
            amount,
            pnl,
            win,
            new_balance: newBal.rows[0].balance_zmw
        });
    } catch (err) {
        console.error('Trade error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
