const pool = require('../config/db');

// SYNA configuration
const SYNA_AMOUNT = 200;
const TRADE_INTERVAL = 30000; // 30 seconds
let intervalId = null;

// Simple moving average signal (you can replace with your own logic)
let priceHistory = {};
const MA_PERIOD = 8;

async function fetchLivePrice(symbol) {
    // Same logic as in frontend – try backend price API first, then fallback
    try {
        const res = await fetch(`http://localhost:5000/api/price?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        if (data.price) return parseFloat(data.price);
    } catch (e) {}
    const fallbacks = {
        'BTC/USDT': 80000,
        'ETH/USDT': 4000,
        'XRP/USDT': 0.5,
        'EUR/USD': 1.08,
        'GBP/USD': 1.26,
        'XAU/USD': 2350
    };
    return fallbacks[symbol] || 80000;
}

async function getSignal(pair) {
    const price = await fetchLivePrice(pair);
    if (!priceHistory[pair]) priceHistory[pair] = [];
    const history = priceHistory[pair];
    history.push(price);
    if (history.length > MA_PERIOD) history.shift();

    if (history.length < 2) return { direction: 'HOLD', confidence: 0 };

    const ma = history.reduce((a, b) => a + b, 0) / history.length;
    const diff = price - ma;
    const pct = (diff / ma) * 100;

    let direction = 'BUY';
    if (pct < -0.005) direction = 'SELL';
    else if (pct > 0.005) direction = 'BUY';
    else direction = Math.random() < 0.5 ? 'BUY' : 'SELL';

    return { direction, confidence: 50 + Math.abs(pct) * 10 };
}

async function executeTrade(userId, pair, direction) {
    const symbolMap = {
        'BTC/USDT': 'BTCUSDT',
        'ETH/USDT': 'ETHUSDT',
        'XRP/USDT': 'XRPUSDT',
        'EUR/USD': 'EURUSD',
        'GBP/USD': 'GBPUSD',
        'XAU/USD': 'XAUUSD'
    };
    const symbol = symbolMap[pair] || pair.replace('/', '');

    const WIN_RATE = 0.45;
    const PROFIT_PERCENT = 0.02;
    const LOSS_PERCENT = 0.03;
    const FEE_RATE = 0.003;

    const win = Math.random() < WIN_RATE;
    const pnl = win ? SYNA_AMOUNT * PROFIT_PERCENT : -SYNA_AMOUNT * LOSS_PERCENT;
    const fee = SYNA_AMOUNT * FEE_RATE;
    const net = pnl - fee;

    await pool.query(
        'UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2',
        [net, userId]
    );

    // Record trade in trades table (optional)
    await pool.query(
        `INSERT INTO trades (user_id, symbol, direction, amount, pnl, fee, win, is_smart_tool, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'CLOSED')`,
        [userId, symbol, direction, SYNA_AMOUNT, pnl, fee, win]
    );

    return { win, pnl, fee, net };
}

// Start SYNA for all premium users (or a specific user for testing)
async function startSynaEngine() {
    if (intervalId) return;
    console.log('SYNA engine started');
    intervalId = setInterval(async () => {
        try {
            // For testing, use our test user ID. In production, fetch premium users.
            const testUserId = '3ba6142a-10a8-4812-b485-d60df8d928d8'; // apitest@nrxtrader.com
            const pair = 'BTC/USDT'; // or you can rotate
            const signal = await getSignal(pair);
            if (signal.direction === 'HOLD') return;
            await executeTrade(testUserId, pair, signal.direction);
            console.log(`SYNA trade: ${signal.direction} ${pair}`);
        } catch (e) {
            console.error('SYNA engine error:', e);
        }
    }, TRADE_INTERVAL);
}

function stopSynaEngine() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    console.log('SYNA engine stopped');
}

module.exports = { startSynaEngine, stopSynaEngine };
