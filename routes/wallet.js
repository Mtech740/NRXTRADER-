const express = require('express');
const router = express.Router();
const pool = require('../db');          // Adjust path to your database connection
const auth = require('../middleware/auth');  // Your auth middleware

// Get user balance
router.get('/balance', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        const isPremium = await pool.query('SELECT is_premium FROM users WHERE id = $1', [req.userId]);
        res.json({
            balance_zmw: parseFloat(user.rows[0].balance_zmw) || 0,
            is_premium: isPremium.rows[0].is_premium || false
        });
    } catch (err) {
        console.error('Balance error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Deposit (manual verification – just adds to balance)
router.post('/deposit', auth, async (req, res) => {
    try {
        const { amount, reference } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [amount, req.userId]);
        await pool.query(
            `INSERT INTO ledger (user_id, entry_type, amount, description) VALUES ($1, 'DEPOSIT', $2, $3)`,
            [req.userId, amount, `Deposit reference: ${reference || 'manual'}`]
        );
        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        res.json({ success: true, new_balance: newBal.rows[0].balance_zmw });
    } catch (err) {
        console.error('Deposit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Withdrawal – minimum K5000 (as provided)
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
        await pool.query(
            `INSERT INTO ledger (user_id, entry_type, amount, description) VALUES ($1, 'WITHDRAWAL', $2, $3)`,
            [req.userId, -totalDeduction, `Withdrawal fee: K${ (amount * withdrawFee).toFixed(2) }`]
        );

        const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [req.userId]);
        res.json({ success: true, new_balance: newBal.rows[0].balance_zmw });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
