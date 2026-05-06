const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// Get balance
router.get('/balance', auth, async (req, res) => {
    const result = await pool.query('SELECT balance_zmw, is_premium FROM users WHERE id = $1', [req.userId]);
    res.json(result.rows[0]);
});

// Simulated bank deposit (for development)
router.post('/deposit', auth, async (req, res) => {
    const { amount, reference } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });

    await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [amount, req.userId]);
    // Log to ledger
    await pool.query(
        `INSERT INTO ledger (user_id, entry_type, amount, description) VALUES ($1, 'DEPOSIT', $2, $3)`,
        [req.userId, amount, `Bank deposit ref: ${reference || 'N/A'}`]
    );
    const balance = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
    res.json({ success: true, new_balance: balance.rows[0].balance_zmw });
});

// Withdrawal
router.post('/withdraw', auth, async (req, res) => {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const current = user.rows[0];
    const withdrawFee = current.is_premium ? 5 : 10;
    const { amount } = req.body;

    if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum withdrawal K100' });
    if (amount + withdrawFee > current.balance_zmw) return res.status(400).json({ error: 'Insufficient balance' });

    await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [amount + withdrawFee, req.userId]);
    await pool.query(
        `INSERT INTO ledger (user_id, entry_type, amount, description) VALUES ($1, 'WITHDRAWAL', $2, $3)`,
        [req.userId, -amount, `Withdrawal fee: K${withdrawFee}`]
    );
    const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
    res.json({ success: true, new_balance: newBal.rows[0].balance_zmw });
});

module.exports = router;
