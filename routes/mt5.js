const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');
const crypto = require('crypto');

router.post('/register', auth, async (req, res) => {
    try {
        const userId = req.userId;
        const apiKey = crypto.randomBytes(32).toString('hex');
        const accountId = `MT5_${userId}_${Date.now()}`;

        // Check if user already has an MT5 account
        const existing = await pool.query(
            `SELECT user_id FROM mt5_accounts WHERE user_id = $1`,
            [userId]
        );

        if (existing.rows.length > 0) {
            // Update existing record
            await pool.query(
                `UPDATE mt5_accounts 
                 SET api_key = $1, account_id = $2, updated_at = NOW()
                 WHERE user_id = $3`,
                [apiKey, accountId, userId]
            );
        } else {
            // Insert new record
            await pool.query(
                `INSERT INTO mt5_accounts (user_id, api_key, account_id) 
                 VALUES ($1, $2, $3)`,
                [userId, apiKey, accountId]
            );
        }

        // Ensure trial usage record exists
        const trial = await pool.query(
            `SELECT remaining_signals FROM mt5_trial_usage WHERE user_id = $1`,
            [userId]
        );
        let trialRemaining = 3;
        if (trial.rows.length === 0) {
            await pool.query(
                `INSERT INTO mt5_trial_usage (user_id, remaining_signals) VALUES ($1, 3)`,
                [userId]
            );
        } else {
            trialRemaining = trial.rows[0].remaining_signals;
        }

        // Check subscription status
        const userSub = await pool.query(
            `SELECT is_premium, premium_subscription_end FROM users WHERE id = $1`,
            [userId]
        );
        const hasActiveSubscription = userSub.rows[0].is_premium && 
            new Date(userSub.rows[0].premium_subscription_end) > new Date();

        res.json({
            success: true,
            api_key: apiKey,
            account_id: accountId,
            trial_signals_remaining: trialRemaining,
            has_active_subscription: hasActiveSubscription,
            websocket_url: 'wss://nrxtrader-api.onrender.com'
        });
    } catch (err) {
        console.error('MT5 register error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

router.get('/status/:accountId', async (req, res) => {
    const { accountId } = req.params;
    const { api_key } = req.query;
    try {
        const account = await pool.query(
            `SELECT user_id FROM mt5_accounts WHERE account_id = $1 AND api_key = $2`,
            [accountId, api_key]
        );
        if (account.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const userId = account.rows[0].user_id;
        const user = await pool.query(
            `SELECT is_premium, premium_subscription_end FROM users WHERE id = $1`,
            [userId]
        );
        const trial = await pool.query(
            `SELECT remaining_signals FROM mt5_trial_usage WHERE user_id = $1`,
            [userId]
        );
        const active = user.rows[0].is_premium && 
            new Date(user.rows[0].premium_subscription_end) > new Date();
        res.json({
            active_subscription: active,
            trial_signals_remaining: trial.rows[0]?.remaining_signals || 0
        });
    } catch (err) {
        console.error('Status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
