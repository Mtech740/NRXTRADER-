const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// Get user's selected assets
router.get('/assets', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT asset_symbol FROM user_assets WHERE user_id = $1', [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Replace user's asset selections
router.post('/assets', auth, async (req, res) => {
    const { assets } = req.body; // array of strings, e.g. ["XAUUSD", "US30"]
    if (!Array.isArray(assets)) return res.status(400).json({ error: 'Assets must be an array' });
    try {
        await pool.query('BEGIN');
        await pool.query('DELETE FROM user_assets WHERE user_id = $1', [req.userId]);
        for (const asset of assets) {
            await pool.query('INSERT INTO user_assets (user_id, asset_symbol) VALUES ($1, $2)', [req.userId, asset]);
        }
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: 'Server error' });
    }
});

// Get remaining free trial signals (max 3)
router.get('/trial-remaining', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT trial_signals_used FROM users WHERE id = $1', [req.userId]);
        const used = parseInt(user.rows[0].trial_signals_used) || 0;
        const remaining = Math.max(0, 3 - used);
        res.json({ remaining });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
