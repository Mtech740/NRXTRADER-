-- Users & authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR UNIQUE NOT NULL,
    email VARCHAR UNIQUE,
    password_hash VARCHAR NOT NULL,
    balance_zmw DECIMAL(12,2) DEFAULT 0,
    usdt_balance DECIMAL(12,8) DEFAULT 0,
    is_premium BOOLEAN DEFAULT false,
    premium_trial_ends_at TIMESTAMP,
    premium_subscription_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Trades (manual & smart tool)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    symbol VARCHAR NOT NULL,
    direction VARCHAR CHECK (direction IN ('LONG','SHORT','BUY','SELL')),
    entry_price DECIMAL(18,8),
    exit_price DECIMAL(18,8),
    quantity DECIMAL(18,8),
    status VARCHAR CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
    opened_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    pnl DECIMAL(18,8),
    fee DECIMAL(18,8),
    is_smart_tool BOOLEAN DEFAULT false,
    win BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Financial ledger (every balance change)
CREATE TABLE ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    trade_id UUID REFERENCES trades(id),
    entry_type VARCHAR CHECK (entry_type IN ('DEPOSIT','WITHDRAWAL','FEE','PROFIT','LOSS','SUBSCRIPTION')),
    amount DECIMAL(18,8),
    balance_after DECIMAL(18,8),
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Premium subscriptions log
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    plan VARCHAR DEFAULT 'pro_monthly',
    amount DECIMAL(10,2) DEFAULT 100,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    status VARCHAR DEFAULT 'active'
);
