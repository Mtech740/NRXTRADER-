async function initDB() {
    // Enable UUID generation
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Users table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            phone VARCHAR(20) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            subscription_plan VARCHAR(20) DEFAULT 'free',
            trial_signals_used INTEGER DEFAULT 0,
            signal_subscription_end TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);

    // User assets table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_assets (
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            asset_symbol VARCHAR(20) NOT NULL,
            PRIMARY KEY (user_id, asset_symbol)
        );
    `);

    // Auto signals table
    await pool.query(`
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
    `);

    console.log('Database tables ready');
}
