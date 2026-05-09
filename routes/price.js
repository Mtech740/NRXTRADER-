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

        // Forex / Gold via exchangerate.host
        if (forexApiMap[symbol]) {
            const targetCurrency = forexApiMap[symbol];
            try {
                const response = await fetch(`https://api.exchangerate.host/convert?from=${targetCurrency}&to=USD&amount=1`);
                const data = await response.json();
                if (data && data.result) return res.json({ price: parseFloat(data.result) });
            } catch (e) { /* fall through */ }

            // Backup: frankfurter.app
            try {
                const response = await fetch(`https://api.frankfurter.app/latest?amount=1&from=${targetCurrency}&to=USD`);
                const data = await response.json();
                if (data && data.rates && data.rates.USD) return res.json({ price: parseFloat(data.rates.USD) });
            } catch (e) { /* fall through */ }

            // Hard fallback
            const fallback = { 'EUR': 1.07, 'GBP': 1.25, 'XAU': 2350 };
            return res.json({ price: fallback[targetCurrency] || 1 });
        }

        res.status(400).json({ error: 'Unsupported symbol' });

    } catch (err) {
        console.error('Price route error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
