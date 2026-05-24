// ==========================
// MANUAL SIGNAL GENERATION (for frontend trial button) with fallback price
// ==========================

app.post('/api/trades/generate-signal', authMiddleware, async (req, res) => {
    const { assetSymbol } = req.body;
    if (!assetSymbol) return res.status(400).json({ error: 'Asset symbol required' });
    
    // Fallback realistic prices (for demo/trial when API fails)
    const FALLBACK_PRICES = {
        'XAUUSD': 2350.50,
        'US30': 33500.00,
        'NAS100': 18500.00,
        'EURUSD': 1.0850,
        'GBPUSD': 1.2650,
        'BTCUSD': 65000.00
    };

    try {
        let currentPrice = await getLivePrice(assetSymbol);
        let usedFallback = false;
        if (!currentPrice) {
            currentPrice = FALLBACK_PRICES[assetSymbol];
            usedFallback = true;
            console.log(`Using fallback price for ${assetSymbol}: ${currentPrice}`);
        }
        if (!currentPrice) return res.status(500).json({ error: 'Price fetch failed (no fallback)' });

        const lastPrice = await getLastPrice(assetSymbol);
        if (!lastPrice) {
            // First time – store price and tell user to try again in a moment
            await pool.query(
                `INSERT INTO price_cache(asset_symbol, last_price) VALUES($1,$2) ON CONFLICT(asset_symbol) DO UPDATE SET last_price=$2`,
                [assetSymbol, currentPrice]
            );
            return res.json({ success: true, message: 'Price cache initialized, please try again in 30 seconds', price: currentPrice });
        }

        const movement = ((currentPrice - lastPrice) / lastPrice) * 100;
        const volatility = Math.abs(movement);
        if (volatility < 0.03) {
            return res.json({ success: true, message: 'No significant price movement yet', price: currentPrice });
        }

        const direction = movement > 0 ? 'BUY' : 'SELL';
        const confidence = calculateConfidence(movement, volatility);
        if (confidence < 75) {
            return res.json({ success: true, message: `Signal confidence too low (${confidence}%)`, confidence });
        }

        const entry = currentPrice;
        const tp = direction === 'BUY' ? entry * 1.005 : entry * 0.995;
        const sl = direction === 'BUY' ? entry * 0.997 : entry * 1.003;
        const trend = movement > 0 ? 'bullish' : 'bearish';

        await pool.query(
            `INSERT INTO auto_signals(asset_symbol, signal_type, entry_price, take_profit, stop_loss, confidence, market_trend, volatility)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [assetSymbol, direction, entry, tp, sl, confidence, trend, volatility]
        );

        // Increment trial counter
        await pool.query('UPDATE users SET trial_signals_used = trial_signals_used + 1 WHERE id = $1', [req.userId]);

        res.json({ success: true, direction, price: currentPrice, used_fallback: usedFallback });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
