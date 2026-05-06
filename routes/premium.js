const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// Start 7-day trial
router.post('/trial', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
        const current = user.rows[0];
        if (current.is_premium || (current.premium_trial_ends_at && new Date(current.premium_trial_ends_at) > new Date())) {
            return res.status(400).json({ error: 'Trial already activated or already premium' });
        }
        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query('UPDATE users SET premium_trial_ends_at = $1, is_premium = true WHERE id = $2', [trialEnd, req.userId]);
        res.json({ success: true, trial_ends_at: trialEnd });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Subscribe (charge K100)
router.post('/subscribe', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
        const current = user.rows[0];
        if (current.balance_zmw < 100) return res.status(400).json({ error: 'Insufficient balance' });

        const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await pool.query('BEGIN');
        await pool.query('UPDATE users SET balance_zmw = balance_zmw - 100, is_premium = true, premium_subscription_end = $1, premium_trial_ends_at = NULL WHERE id = $2', [subEnd, req.userId]);
        await pool.query(
            'INSERT INTO ledger (user_id, entry_type, amount, description) VALUES ($1, $2, $3, $4)',
            [req.userId, 'SUBSCRIPTION', -100, 'NRX Pro monthly']
        );
        await pool.query('COMMIT');
        res.json({ success: true, subscription_end: subEnd });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
