const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const auth = require('../middleware/auth'); // we need auth middleware

router.post('/register', async (req, res) => {
    const { email, phone, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, email, phone',
            [email, phone || null, hash]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Email already registered' });
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                balance: user.balance_zmw,
                is_premium: user.is_premium,
                trial_active: user.premium_trial_ends_at && new Date(user.premium_trial_ends_at) > new Date()
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ==================== NEW ENDPOINTS for frontend ====================

// Get current user's subscription info and phone
router.get('/me', auth, async (req, res) => {
    try {
        const user = await pool.query(
            `SELECT email, phone, subscription_plan, signal_subscription_end, trial_signals_used 
             FROM users WHERE id = $1`,
            [req.userId]
        );
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update WhatsApp phone number
router.post('/update-phone', auth, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    try {
        await pool.query('UPDATE users SET phone = $1 WHERE id = $2', [phone, req.userId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
