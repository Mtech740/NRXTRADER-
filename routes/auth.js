const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Register
router.post('/register', async (req, res) => {
    const { phone, email, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (phone, email, password_hash) VALUES ($1, $2, $3) RETURNING id, phone',
            [phone, email || null, hash]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Phone already registered' });
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

    try {
        const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user.id,
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

module.exports = router;
