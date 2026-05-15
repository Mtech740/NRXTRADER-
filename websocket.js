const pool = require('./config/db');
const clients = new Map();

module.exports = async function handleWebSocket(ws, req, wss) {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        if (data.type === 'auth') {
            const { account_id, api_key } = data;
            const result = await pool.query(`SELECT user_id FROM mt5_accounts WHERE account_id = $1 AND api_key = $2`, [account_id, api_key]);
            if (result.rows.length === 0) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid credentials' }));
                ws.close();
                return;
            }
            const userId = result.rows[0].user_id;
            const userSub = await pool.query(`SELECT is_premium, premium_subscription_end FROM users WHERE id = $1`, [userId]);
            const hasPaid = userSub.rows[0].is_premium && new Date(userSub.rows[0].premium_subscription_end) > new Date();
            const trial = await pool.query(`SELECT remaining_signals FROM mt5_trial_usage WHERE user_id = $1`, [userId]);
            const trialRemaining = trial.rows[0]?.remaining_signals || 0;
            const canTrade = hasPaid || trialRemaining > 0;
            clients.set(account_id, { ws, userId, canTrade });
            ws.send(JSON.stringify({ type: 'auth_response', success: true, can_trade: canTrade, subscription_active: hasPaid, trial_remaining: trialRemaining }));
        }
    });
    ws.on('close', () => { /* cleanup */ });
};
