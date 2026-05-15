-- 1. Create mt5_accounts table WITHOUT foreign key first
CREATE TABLE IF NOT EXISTS mt5_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create trial usage table
CREATE TABLE IF NOT EXISTS mt5_trial_usage (
    user_id INTEGER PRIMARY KEY,
    remaining_signals INTEGER DEFAULT 3
);

-- 3. Add foreign key constraint AFTER tables exist
ALTER TABLE mt5_accounts
ADD CONSTRAINT mt5_accounts_user_id_fkey
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 4. Optional: logs for signals sent to MT5
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

-- 5. Optional: logs for trade results from EA
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
