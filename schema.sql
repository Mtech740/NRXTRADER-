-- Add email column if missing
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;

-- Make phone optional
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- If you need to create the table from scratch (only for fresh databases),
-- you can use the full CREATE TABLE below. Otherwise, ignore this part.
/*
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    balance_zmw DECIMAL(12,2) DEFAULT 0,
    usdt_balance DECIMAL(12,8) DEFAULT 0,
    is_premium BOOLEAN DEFAULT false,
    premium_trial_ends_at TIMESTAMP,
    premium_subscription_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR NOT NULL,
    direction VARCHAR CHECK (direction IN ('LONG','SHORT','BUY','SELL')),
    entry_price DECIMAL(18,8),
    exit_price DECIMAL(18,8),
    quantity DECIMAL(18,8),
    status VARCHAR CHECK (status IN ('OPEN','CLOSED','CANCELLED')) DEFAULT 'OPEN',
    opened_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    pnl DECIMAL(18,8),
    fee DECIMAL(18,8),
    is_smart_tool BOOLEAN DEFAULT false,
    win BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
    entry_type VARCHAR CHECK (entry_type IN ('DEPOSIT','WITHDRAWAL','FEE','PROFIT','LOSS','SUBSCRIPTION')),
    amount DECIMAL(18,8),
    balance_after DECIMAL(18,8),
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR DEFAULT 'pro_monthly',
    amount DECIMAL(10,2) DEFAULT 100,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    status VARCHAR DEFAULT 'active'
);
*/
