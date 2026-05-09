const express = require('express');
const router = express.Router();

router.post('/manual', async (req, res) => {

    try {

        console.log("TRADE WORKING");
        console.log(req.body);

        return res.json({
            success: true,
            new_balance: 5000,
            pnl: 120,
            win: true
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            error: "Server error"
        });

    }

});

module.exports = router;
