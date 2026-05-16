-- 1. Create mt5_accounts table WITHOUT foreign key first (using UUID for user_id)
CREATE TABLE IF NOT EXISTS mt5_accounts (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create trial usage table (user_id as UUID)
CREATE TABLE IF NOT EXISTS mt5_trial_usage (
    user_id UUID PRIMARY KEY,
    remaining_signals INTEGER DEFAULT 3
);

-- 3. Add foreign key constraint AFTER tables exist (matches UUID)
ALTER TABLE mt5_accounts
ADD CONSTRAINT mt5_accounts_user_id_fkey
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 4. Signal history (user_id as UUID)
CREATE TABLE IF NOT EXISTS mt5_signal_history (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    lot_size DECIMAL(10,2),
    stop_loss DECIMAL(10,5),
    take_profit DECIMAL(10,5),
    sent_at TIMESTAMP DEFAULT NOW()
);

-- 5. Trade logs (user_id as UUID)
CREATE TABLE IF NOT EXISTS mt5_trade_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
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

-- 6. Add Telegram and subscription columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(50) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20) DEFAULT 'free';
-- subscription_plan values: 'free', 'basic', 'premium'
