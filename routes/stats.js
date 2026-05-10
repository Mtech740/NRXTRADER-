const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/totalTrades', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM platform_stats WHERE key = 'total_trades'");
        res.json({ total_trades: parseInt(result.rows[0].value) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
