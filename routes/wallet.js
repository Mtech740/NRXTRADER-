// Withdrawal – minimum K5000
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
