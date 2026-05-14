-- MT5 accounts linked to users
CREATE TABLE IF NOT EXISTS mt5_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Track trial signal usage (3 free signals for new users)
CREATE TABLE IF NOT EXISTS mt5_trial_usage (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    remaining_signals INTEGER DEFAULT 3
);

-- Log of signals sent to EA
CREATE TABLE IF NOT EXISTS mt5_signal_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    lot_size DECIMAL(10,2),
    stop_loss DECIMAL(10,5),
    take_profit DECIMAL(10,5),
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Log of trade results reported by EA
CREATE TABLE IF NOT EXISTS mt5_trade_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    request_id TEXT,
    symbol TEXT,
    action TEXT,
    lot_size DECIMAL(10,2),
    status TEXT,
    order_id INTEGER,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
