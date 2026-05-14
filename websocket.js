const pool = require('./config/db');

// Store connected clients with their accountId
const clients = new Map(); // accountId -> { ws, userId, apiKey }

module.exports = async function handleWebSocket(ws, req, wss) {
    let authenticated = false;
    let accountId = null;
    let userId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Step 1: Authentication
            if (data.type === 'auth') {
                const { account_id, api_key } = data;
                if (!account_id || !api_key) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Missing credentials' }));
                    ws.close();
                    return;
                }
                
                // Verify against database
                const result = await pool.query(
                    `SELECT mt5.user_id, u.is_premium, u.premium_subscription_end, u.premium_trial_ends_at,
                            trial.remaining_signals
                     FROM mt5_accounts mt5
                     JOIN users u ON mt5.user_id = u.id
                     LEFT JOIN mt5_trial_usage trial ON trial.user_id = u.id
                     WHERE mt5.account_id = $1 AND mt5.api_key = $2`,
                    [account_id, api_key]
                );
                
                if (result.rows.length === 0) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid credentials' }));
                    ws.close();
                    return;
                }
                
                const user = result.rows[0];
                const hasPaidSubscription = user.is_premium && 
                    (new Date(user.premium_subscription_end) > new Date() ||
                     (user.premium_trial_ends_at && new Date(user.premium_trial_ends_at) > new Date()));
                const trialRemaining = user.remaining_signals || 0;
                const canTrade = hasPaidSubscription || trialRemaining > 0;
                
                authenticated = true;
                accountId = account_id;
                userId = user.user_id;
                
                // Store client
                clients.set(accountId, { ws, userId, apiKey: api_key });
                
                ws.send(JSON.stringify({
                    type: 'auth_response',
                    success: true,
                    can_trade: canTrade,
                    subscription_active: hasPaidSubscription,
                    trial_remaining: trialRemaining
                }));
                
                console.log(`EA connected: ${accountId} (user ${userId})`);
                return;
            }
            
            // Only authenticated clients can send other messages
            if (!authenticated) {
                ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
                return;
            }
            
            // Handle trade result reports from EA
            if (data.type === 'trade_result') {
                const { request_id, status, order_id, error, symbol, action, lot_size } = data;
                // Store trade result in database for history
                await pool.query(
                    `INSERT INTO mt5_trade_logs (user_id, account_id, request_id, symbol, action, lot_size, status, order_id, error, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                    [userId, accountId, request_id, symbol, action, lot_size, status, order_id, error]
                );
                ws.send(JSON.stringify({ type: 'result_received', request_id }));
            }
            
            // Heartbeat
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
            
        } catch (err) {
            console.error('WebSocket message error:', err);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });
    
    ws.on('close', () => {
        if (accountId) {
            clients.delete(accountId);
            console.log(`EA disconnected: ${accountId}`);
        }
    });
};

// Function to broadcast a trading signal to a specific user's EA
async function sendSignalToUser(userId, signal) {
    // Find client by userId (iterate through clients)
    for (const [accId, client] of clients.entries()) {
        if (client.userId === userId) {
            // Check subscription / trial before sending
            const canSend = await canSendSignal(userId);
            if (!canSend) {
                client.ws.send(JSON.stringify({
                    type: 'error',
                    message: 'No active subscription or trial signals remaining'
                }));
                return false;
            }
            
            // Deduct trial signal if no paid subscription
            await deductSignalIfNeeded(userId);
            
            // Send the signal
            client.ws.send(JSON.stringify({
                type: 'signal',
                ...signal,
                timestamp: Date.now()
            }));
            
            // Record that signal was sent (for history)
            await pool.query(
                `INSERT INTO mt5_signal_history (user_id, account_id, symbol, action, lot_size, stop_loss, take_profit, sent_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                [userId, accId, signal.symbol, signal.action, signal.lot_size, signal.stop_loss, signal.take_profit]
            );
            
            return true;
        }
    }
    return false; // no connected EA for this user
}

async function canSendSignal(userId) {
    const result = await pool.query(
        `SELECT u.is_premium, u.premium_subscription_end, u.premium_trial_ends_at,
                trial.remaining_signals
         FROM users u
         LEFT JOIN mt5_trial_usage trial ON trial.user_id = u.id
         WHERE u.id = $1`,
        [userId]
    );
    if (result.rows.length === 0) return false;
    const user = result.rows[0];
    const hasPaid = user.is_premium && new Date(user.premium_subscription_end) > new Date();
    const hasTrial = user.premium_trial_ends_at && new Date(user.premium_trial_ends_at) > new Date();
    const trialRemaining = user.remaining_signals || 0;
    return hasPaid || hasTrial || trialRemaining > 0;
}

async function deductSignalIfNeeded(userId) {
    const user = await pool.query(
        `SELECT is_premium, premium_subscription_end, premium_trial_ends_at FROM users WHERE id = $1`,
        [userId]
    );
    const hasPaid = user.rows[0].is_premium && new Date(user.rows[0].premium_subscription_end) > new Date();
    const hasTrial = user.rows[0].premium_trial_ends_at && new Date(user.rows[0].premium_trial_ends_at) > new Date();
    if (!hasPaid && !hasTrial) {
        await pool.query(
            `UPDATE mt5_trial_usage SET remaining_signals = remaining_signals - 1 WHERE user_id = $1 AND remaining_signals > 0`,
            [userId]
        );
    }
}

module.exports = { handleWebSocket: module.exports, sendSignalToUser };
