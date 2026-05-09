const express = require('express');
const router = express.Router';

const binanceSymbolMap = {
    'BTC/USDT': 'BTCUSDT',
    'ETH/USDT': 'ETHUSDT',
    'XRP/USDT': 'XRPUSDT'
};

const forexApiMap = {
    'EUR/USD': 'EUR',
    'GBP/USD': 'GBP',
    'XAU/USD': 'XAU'
};

router.get('/', async (req, res) => {
    try {
        const { symbol } = req.query;

        if (!symbol) {
            return res.status(400).json({
                error: 'Symbol required'
            });
        }

        // =========================
        // CRYPTO
        // =========================
        if (binanceSymbolMap[symbol]) {

            const response = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbolMap[symbol]}`
            );

            if (!response.ok) {
                throw new Error('Binance request failed');
            }

            const data = await response.json();

            return res.json({
                success: true,
                symbol,
                price: Number(data.price)
            });
        }

        // =========================
        // FOREX + GOLD
        // =========================
        if (forexApiMap[symbol]) {

            const targetCurrency = forexApiMap[symbol];

            const fallback = {
                EUR: 1.08,
                GBP: 1.26,
                XAU: 2350
            };

            // GOLD
            if (targetCurrency === 'XAU') {
                return res.json({
                    success: true,
                    symbol,
                    price: fallback.XAU
                });
            }

            try {

                const response = await fetch(
                    `https://api.frankfurter.app/latest?from=${targetCurrency}&to=USD`
                );

                if (!response.ok) {
                    throw new Error('Forex API failed');
                }

                const data = await response.json();

                if (data?.rates?.USD) {
                    return res.json({
                        success: true,
                        symbol,
                        price: Number(data.rates.USD)
                    });
                }

            } catch (e) {

                console.log('Using forex fallback');

                return res.json({
                    success: true,
                    symbol,
                    price: fallback[targetCurrency]
                });
            }
        }

        return res.status(400).json({
            error: 'Unsupported symbol'
        });

    } catch (err) {

        console.error('Price route error:', err.message);

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
});

module.exports = router;
