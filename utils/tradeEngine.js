const pool = require('../config/db');

async function executeSmartTrade(userId) {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const current = user.rows[0];
    const feeRate = current.is_premium ? 0.002 : 0.003;
    const tradeAmount = 100; // fixed for smart tool

    if (current.balance_zmw < tradeAmount) return { error: 'Insufficient balance' };

    const win = Math.random() < 0.8; // 80%
    const profit = tradeAmount * 0.03;
    const pnl = win ? profit : -profit;
    const fee = tradeAmount * feeRate;
    const net = pnl - fee;

    await pool.query('UPDATE users SET balance_zmw = balance_zmw + $1 WHERE id = $2', [net, userId]);
    const trade = await pool.query(
        `INSERT INTO trades (user_id, symbol, direction, entry_price, exit_price, quantity, status, pnl, fee, win, is_smart_tool)
         VALUES ($1,'BTCUSDT','BUY',10000,10200,$2,'CLOSED',$3,$4,$5,true) RETURNING id`,
        [userId, tradeAmount, pnl, fee, win]
    );
    await pool.query(
        `INSERT INTO ledger (user_id, trade_id, entry_type, amount, description)
         VALUES ($1, $2, 'PROFIT', $3, 'Smart trade')`,
        [userId, trade.rows[0].id, net]
    );

    const newBal = await pool.query('SELECT balance_zmw FROM users WHERE id = $1', [userId]);
    return { win, pnl, fee, net, new_balance: newBal.rows[0].balance_zmw };
}

module.exports = { executeSmartTrade };
