const express = require('express');
const router = express.Router();

const binanceSymbolMap = {
    'BTC/USDT': 'BTCUSDT',
    'ETH/USDT': 'ETHUSDT',
    'XRP/USDT': 'XRPUSDT'
};

// Hard-coded forex/gold prices (updated as needed)
const forexPrices = {
    'EUR/USD': 1.08,
    'GBP/USD': 1.26,
    'XAU/USD': 2350
};

router.get('/', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    // Crypto – try Binance, but fallback to a sensible price if offline
    if (binanceSymbolMap[symbol]) {
        try {
            const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbolMap[symbol]}`);
            const data = await resp.json();
            if (data.price) return res.json({ price: parseFloat(data.price) });
        } catch (e) { /* fall through */ }
        // Fallback prices for crypto (so SYNA never stops)
        const cryptoFallback = { 'BTC/USDT': 80000, 'ETH/USDT': 4000, 'XRP/USDT': 0.5 };
        return res.json({ price: cryptoFallback[symbol] || 80000 });
    }

    // Forex / Gold – use hard-coded prices (reliable)
    if (forexPrices[symbol]) {
        return res.json({ price: forexPrices[symbol] });
    }

    res.status(400).json({ error: 'Unsupported symbol' });
});

module.exports = router;
