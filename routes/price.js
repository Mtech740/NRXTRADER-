const express = require('express');
const router = express.Router();

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
        if (!symbol) return res.status(400).json({ error: 'Symbol required' });

        // Crypto via Binance
        if (binanceSymbolMap[symbol]) {
            const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbolMap[symbol]}`);
            if (!response.ok) throw new Error('Binance fetch failed');
            const data = await response.json();
            return res.json({ price: parseFloat(data.price) });
        }

        // Forex / Gold
        if (forexApiMap[symbol]) {
            const targetCurrency = forexApiMap[symbol];   // <-- THIS WAS MISSING

            const fallback = {
                'EUR': 1.08,
                'GBP': 1.26,
                'XAU': 2350
            };

            // Use Frankfurter for forex (not gold)
            if (targetCurrency !== 'XAU') {
                try {
                    const response = await fetch(`https://api.frankfurter.app/latest?from=${targetCurrency}&to=USD`);
                    const data = await response.json();
                    if (data?.rates?.USD) {
                        return res.json({ price: parseFloat(data.rates.USD) });
                    }
                } catch (e) {
                    console.log('Forex API failed, using fallback');
                }
            }

            // Gold fallback (always static for now)
            if (targetCurrency === 'XAU') {
                return res.json({ price: fallback['XAU'] });
            }

            // Final fallback
            return res.json({ price: fallback[targetCurrency] });
        }

        res.status(400).json({ error: 'Unsupported symbol' });

    } catch (err) {
        console.error('Price route error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
