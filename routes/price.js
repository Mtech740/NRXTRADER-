const express = require('express');
const router = express.Router();

const binanceSymbolMap = {
    'BTC/USDT': 'BTCUSDT',
    'ETH/USDT': 'ETHUSDT',
    'XRP/USDT': 'XRPUSDT'
};

// Hard-coded fallback prices (updated as needed)
const forexFallback = {
    'EUR/USD': 1.08,
    'GBP/USD': 1.26,
    'XAU/USD': 2350
};

const cryptoFallback = {
    'BTC/USDT': 80000,
    'ETH/USDT': 4000,
    'XRP/USDT': 0.5
};

router.get('/', async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    // Crypto – try Binance, then fallback
    if (binanceSymbolMap[symbol]) {
        try {
            const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbolMap[symbol]}`);
            const data = await resp.json();
            if (data.price) return res.json({ price: parseFloat(data.price) });
        } catch (e) { /* fall through */ }
        return res.json({ price: cryptoFallback[symbol] || 80000 });
    }

    // Forex / Gold – try Frankfurter, then fallback
    if (forexFallback[symbol]) {
        const targetCurrency = symbol.split('/')[0]; // e.g., 'EUR'
        if (targetCurrency !== 'XAU') {
            try {
                const resp = await fetch(`https://api.frankfurter.app/latest?from=${targetCurrency}&to=USD`);
                const data = await resp.json();
                if (data?.rates?.USD) return res.json({ price: parseFloat(data.rates.USD) });
            } catch (e) { /* ignore */ }
        }
        return res.json({ price: forexFallback[symbol] });
    }

    res.status(400).json({ error: 'Unsupported symbol' });
});

module.exports = router;
