const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pool = require('../config/db');

// Middleware to verify admin (simple check against a secret or email)
// For now, allow any authenticated user – replace with real admin check later
router.use(auth);

// Get all pending deposit/withdrawal requests (from ledger)
router.get('/requests', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM ledger WHERE entry_type IN ('DEPOSIT','WITHDRAWAL') ORDER BY created_at DESC`
        );
        res.json({ requests: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Approve a deposit or withdrawal
router.post('/approve/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Find the ledger entry
        const entry = await pool.query('SELECT * FROM ledger WHERE id = $1', [id]);
        if (entry.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        // For deposit: already credited? No, deposit is manual confirmation.
        // For withdrawal: already deducted? Yes, but we need to mark as completed.
        // For simplicity, we'll just delete the ledger entry (or add a status column).
        // In a real system, add a status column to ledger.
        // Here we assume the entry is already processed; approval means we mark it.
        await pool.query('UPDATE ledger SET description = CONCAT(description, \' [approved]\') WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Reject a request
router.post('/reject/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE ledger SET description = CONCAT(description, \' [rejected]\') WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
