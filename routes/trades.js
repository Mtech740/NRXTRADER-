const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');
const { executeSmartTrade } = require('../utils/tradeEngine');

// Manual trade (simulated)
router.post('/manual', auth, async (req, res) => {
    const { symbol, direction, amount } = req.body; // amount in ZMW
    const feeRate = req.user.is_premium ? 0.002 : 0.003;
    const maxTrade = req.user.is_premium ? 2000 : 500;

    if (amount < 100 || amount > maxTrade) return res.status(400).json({ error: 'Trade amount out of limits' });
    // Check balance
    const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
    if (amount > user.rows[0].balance_zmw) return res.status(400).json({ error: 'Insufficient balance' });

    // Simulate 50/50 win
    const win = Math.random() < 0.5;
    const pnl = win ? amount * 0.02 : -amount * 0.02;
    const fee = amount * feeRate;
    const net = pnl - fee;

    await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [net, req.userId]);
    // Record trade
    const trade = await pool.query(
        `INSERT INTO trades (user_id, symbol, direction, entry_price, exit_price, quantity, status, pnl, fee, win)
         VALUES ($1,$2,$3,$4,$5,$6,'CLOSED',$7,$8,$9) RETURNING id`,
        [req.userId, symbol, direction, 100, 102, amount, pnl, fee, win]
    );
    // Ledger
    await pool.query(
        `INSERT INTO ledger (user_id, trade_id, entry_type, amount, description)
         VALUES ($1, $2, 'PROFIT', $3, 'Manual trade')`,
        [req.userId, trade.rows[0].id, net]
    );

    const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
    res.json({
        success: true,
        win,
        pnl,
        fee,
        net,
        new_balance: newBal.rows[0].balance_zmw
    });
});

// Smart tool (toggle on/off) – start/stop is managed by backend job, but for simplicity we can trigger single trade
router.post('/smart/execute', auth, async (req, res) => {
    const result = await executeSmartTrade(req.userId);
    res.json(result);
});

module.exports = router;
