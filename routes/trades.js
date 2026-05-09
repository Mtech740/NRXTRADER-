const express = require('express');
const router = express.Router();

/*
    TEST MANUAL TRADE ROUTE
    This version confirms:
    - POST requests work
    - CORS works
    - Frontend/backend communication works
*/

router.post('/manual', async (req, res) => {

    try {

        console.log("TRADE ROUTE HIT");
        console.log("BODY:", req.body);

        // Extract request data
        const { symbol, direction, amount } = req.body;

        // Validate fields
        if (!symbol || !direction || !amount) {
            return res.status(400).json({
                error: "Missing fields"
            });
        }

        // Validate amount
        if (amount < 200) {
            return res.status(400).json({
                error: "Minimum trade amount is K200"
            });
        }

        // Validate direction
        if (
            direction !== 'BUY' &&
            direction !== 'SELL'
        ) {
            return res.status(400).json({
                error: "Invalid direction"
            });
        }

        // Simulate trade result
        const win = Math.random() > 0.5;

        // Simulated profit/loss
        const pnl = win ? amount * 0.12 : -(amount * 0.08);

        // Simulated balance
        const new_balance = win
            ? 5000 + pnl
            : 5000 + pnl;

        console.log("TRADE SUCCESS");

        // Send response
        return res.json({
            success: true,
            symbol,
            direction,
            amount,
            pnl,
            win,
            new_balance
        });

    } catch (err) {

        console.error("TRADE ERROR:", err);

        return res.status(500).json({
            error: "Internal server error"
        });

    }

});

module.exports = router;
