const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

router.get('/assets', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT asset_symbol FROM user_assets WHERE user_id = $1', [req.userId]);
        res.json({ assets: result.rows.map(r => r.asset_symbol) });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/assets', auth, async (req, res) => {
    const { assets } = req.body;
    if (!Array.isArray(assets)) return res.status(400).json({ error: 'Assets must be an array' });
    try {
        await pool.query('DELETE FROM user_assets WHERE user_id = $1', [req.userId]);
        for (const asset of assets) {
            await pool.query('INSERT INTO user_assets (user_id, asset_symbol) VALUES ($1, $2)', [req.userId, asset]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/trial-remaining', auth, async (req, res) => {
    try {
        const user = await pool.query('SELECT trial_signals_used FROM users WHERE id = $1', [req.userId]);
        const used = parseInt(user.rows[0].trial_signals_used) || 0;
        const remaining = Math.max(0, 3 - used);
        res.json({ remaining });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;nrxtrader-api

NodeFreeUpgrade your instance

ConnectManual Deploy

Service ID:srv-d7t8sm1j2pic73fb8rf0

Mtech740 / NRXTRADER-main

https://nrxtrader-api.onrender.com

Your free instance will spin down with inactivity, which can delay requests by 50 seconds or more.

Upgrade now

May 18, 2026 at 1:05 AMfailed

a3e5a91Update auth.js

Rollback

Exited with status 1 while running your code.

Read our docs for common ways to troubleshoot your deploy.

