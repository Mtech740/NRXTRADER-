const pool = require('./config/db');

async function initDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
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
                telegram_id VARCHAR(50) UNIQUE,
                subscription_plan VARCHAR(20) DEFAULT 'free',
                trial_signals_used INTEGER DEFAULT 0,
                signal_subscription_end TIMESTAMP,
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

            -- MT5 tables (UUID foreign keys)
            CREATE TABLE IF NOT EXISTS mt5_accounts (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL,
                api_key TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS mt5_trial_usage (
                user_id UUID PRIMARY KEY,
                remaining_signals INTEGER DEFAULT 3
            );

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

            -- New tables for WhatsApp signal dispatch system
            CREATE TABLE IF NOT EXISTS user_assets (
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                asset_symbol VARCHAR(20) NOT NULL,
                PRIMARY KEY (user_id, asset_symbol)
            );

            CREATE TABLE IF NOT EXISTS auto_signals (
                id SERIAL PRIMARY KEY,
                asset_symbol VARCHAR(20) NOT NULL,
                signal_type VARCHAR(4) CHECK (signal_type IN ('BUY','SELL')),
                entry_price DECIMAL(10,5),
                take_profit DECIMAL(10,5),
                stop_loss DECIMAL(10,5),
                confidence VARCHAR(20),
                generated_at TIMESTAMP DEFAULT NOW(),
                sent_to_admin BOOLEAN DEFAULT FALSE
            );

            CREATE TABLE IF NOT EXISTS signal_delivery_log (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id),
                asset_symbol VARCHAR(20),
                signal_type VARCHAR(4),
                entry_price DECIMAL(10,5),
                take_profit DECIMAL(10,5),
                stop_loss DECIMAL(10,5),
                confidence VARCHAR(20),
                sent_at TIMESTAMP DEFAULT NOW()
            );

            -- Add foreign key constraints for mt5 tables (if not already added)
            ALTER TABLE mt5_accounts
                ADD CONSTRAINT IF NOT EXISTS mt5_accounts_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        `);
        console.log('Database tables ready.');
    } catch (err) {
        console.error('Table creation error:', err.message);
    } finally {
        client.release();
    }
}

module.exports = initDatabase;
