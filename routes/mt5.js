const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');
const crypto = require('crypto');

// Generate a new API key for MT5 EA
router.post('/register', auth, async (req, res) => {
    try {
        const { account_id } = req.body; // optional: user can specify a custom account ID
        const userId = req.userId;
        
        // Generate unique API key
        const apiKey = crypto.randomBytes(32).toString('hex');
        const finalAccountId = account_id || `MT5_${userId}_${Date.now()}`;
        
        // Check if user already has an MT5 account registered
        const existing = await pool.query(
            'SELECT id FROM mt5_accounts WHERE user_id = $1',
            [userId]
        );
        
        if (existing.rows.length > 0) {
            // Update existing record
            await pool.query(
                `UPDATE mt5_accounts 
                 SET api_key = $1, account_id = $2, updated_at = NOW()
                 WHERE user_id = $3`,
                [apiKey, finalAccountId, userId]
            );
        } else {
            // Insert new record
            await pool.query(
                `INSERT INTO mt5_accounts (user_id, api_key, account_id, created_at)
                 VALUES ($1, $2, $3, NOW())`,
                [userId, apiKey, finalAccountId]
            );
        }
        
        // Get user's current subscription status
        const userSub = await pool.query(
            `SELECT is_premium, premium_subscription_end, premium_trial_ends_at,
                    (SELECT value FROM platform_stats WHERE key = 'total_trades') as total_trades
             FROM users WHERE id = $1`,
            [userId]
        );
        const userData = userSub.rows[0];
        const hasActiveSubscription = userData.is_premium && 
            (new Date(userData.premium_subscription_end) > new Date() ||
             (userData.premium_trial_ends_at && new Date(userData.premium_trial_ends_at) > new Date()));
        
        // Determine remaining trial signals (3 free trades for all new users)
        // We'll store trial count in a separate table or a column
        let trialRemaining = 0;
        const trialCheck = await pool.query(
            `SELECT remaining_signals FROM mt5_trial_usage WHERE user_id = $1`,
            [userId]
        );
        if (trialCheck.rows.length === 0) {
            trialRemaining = 3;
            await pool.query(
                `INSERT INTO mt5_trial_usage (user_id, remaining_signals) VALUES ($1, 3)`,
                [userId]
            );
        } else {
            trialRemaining = trialCheck.rows[0].remaining_signals;
        }
        
        res.json({
            success: true,
            api_key: apiKey,
            account_id: finalAccountId,
            websocket_url: `wss://nrxtrader-api.onrender.com`,
            has_active_subscription: hasActiveSubscription,
            trial_signals_remaining: trialRemaining
        });
    } catch (err) {
        console.error('MT5 registration error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Check subscription status for an EA (used by EA to verify)
router.get('/status/:accountId', async (req, res) => {
    try {
        const { accountId } = req.params;
        const { api_key } = req.query;
        if (!api_key) return res.status(401).json({ error: 'API key required' });
        
        // Validate API key and get user
        const account = await pool.query(
            `SELECT user_id FROM mt5_accounts WHERE account_id = $1 AND api_key = $2`,
            [accountId, api_key]
        );
        if (account.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const userId = account.rows[0].user_id;
        
        // Get user subscription details
        const userData = await pool.query(
            `SELECT is_premium, premium_subscription_end, premium_trial_ends_at FROM users WHERE id = $1`,
            [userId]
        );
        const user = userData.rows[0];
        const hasActiveSubscription = user.is_premium && 
            (new Date(user.premium_subscription_end) > new Date() ||
             (user.premium_trial_ends_at && new Date(user.premium_trial_ends_at) > new Date()));
        
        // Get remaining trial signals
        const trial = await pool.query(
            `SELECT remaining_signals FROM mt5_trial_usage WHERE user_id = $1`,
            [userId]
        );
        let trialRemaining = 0;
        if (trial.rows.length > 0) trialRemaining = trial.rows[0].remaining_signals;
        
        res.json({
            active_subscription: hasActiveSubscription,
            trial_signals_remaining: trialRemaining,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Record a signal that was sent (for trial deduction)
router.post('/record_signal', async (req, res) => {
    try {
        const { account_id, api_key } = req.body;
        if (!account_id || !api_key) return res.status(400).json({ error: 'Missing credentials' });
        
        const account = await pool.query(
            `SELECT user_id FROM mt5_accounts WHERE account_id = $1 AND api_key = $2`,
            [account_id, api_key]
        );
        if (account.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const userId = account.rows[0].user_id;
        
        // Deduct trial signal only if no active paid subscription
        const userSub = await pool.query(
            `SELECT is_premium, premium_subscription_end, premium_trial_ends_at FROM users WHERE id = $1`,
            [userId]
        );
        const hasPaid = userSub.rows[0].is_premium && 
            new Date(userSub.rows[0].premium_subscription_end) > new Date();
        const hasTrialActive = userSub.rows[0].premium_trial_ends_at && 
            new Date(userSub.rows[0].premium_trial_ends_at) > new Date();
        
        if (!hasPaid && !hasTrialActive) {
            // Deduct one trial signal
            await pool.query(
                `UPDATE mt5_trial_usage SET remaining_signals = remaining_signals - 1 WHERE user_id = $1 AND remaining_signals > 0`,
                [userId]
            );
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Record signal error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
