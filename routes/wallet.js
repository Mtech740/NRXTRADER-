const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// GET /api/wallet/balance
router.get('/balance', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT balance_zmw, is_premium FROM users WHERE id = $1', [req.userId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ 
            balance_zmw: parseFloat(user.rows[0].balance_zmw), 
            is_premium: user.rows[0].is_premium 
        });
    } catch (err) {
        console.error('Balance error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/wallet/deposit
router.post('/deposit', auth, async (req, res) => {
    try {
        const { amount, reference } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [amount, req.userId]);
        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        res.json({ success: true, new_balance: parseFloat(newBal.rows[0].balance_zmw) });
    } catch (err) {
        console.error('Deposit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/wallet/withdraw
router.post('/withdraw', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
        const current = user.rows[0];
        const withdrawFee = current.is_premium ? 0.008 : 0.01;
        const { amount } = req.body;

        if (!amount || amount < 5000) {
            return res.status(400).json({ error: 'Minimum withdrawal is K5000.' });
        }
        const totalDeduction = amount + (amount * withdrawFee);
        if (current.balance_zmw < totalDeduction) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        await pool.query('UPDATE users SET balance_zmw = balance_zmw - $1 WHERE id = $2', [totalDeduction, req.userId]);
        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        res.json({ success: true, new_balance: parseFloat(newBal.rows[0].balance_zmw) });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
