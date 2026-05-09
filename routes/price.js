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
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    // Crypto
    if (binanceSymbolMap[symbol]) {
        try {
            const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbolMap[symbol]}`);
            const data = await response.json();
            return res.json({ price: parseFloat(data.price) });
        } catch (e) {
            return res.status(502).json({ error: 'Binance fetch failed' });
        }
    }

    // Forex / Gold
    if (forexApiMap[symbol]) {
        const targetCurrency = forexApiMap[symbol];

        // Primary API
        try {
            const response = await fetch(`https://api.exchangerate.host/convert?from=${targetCurrency}&to=USD&amount=1`);
            const data = await response.json();
            if (data.result !== null) return res.json({ price: parseFloat(data.result) });
        } catch (e) { /* ignore */ }

        // Backup API
        try {
            const response = await fetch(`https://open.er-api.com/v6/latest/USD`);
            const data = await response.json();
            if (data?.rates?.[targetCurrency]) {
                return res.json({ price: 1 / parseFloat(data.rates[targetCurrency]) });
            }
        } catch (e) { /* ignore */ }

        // Hard fallback
        const fallback = { 'EUR': 1.07, 'GBP': 1.25, 'XAU': 2350 };
        return res.json({ price: fallback[targetCurrency] || null, fallback: true });
    }

    res.status(400).json({ error: 'Unsupported symbol' });
});

module.exports = router;
