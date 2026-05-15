app.get('/api/setup-mt5-tables', async (req, res) => {
    try {
        const pool = require('./config/db');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mt5_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                api_key TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS mt5_trial_usage (
                user_id INTEGER PRIMARY KEY,
                remaining_signals INTEGER DEFAULT 3
            );
            
            -- Safer foreign key creation using DO block
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mt5_accounts_user_id_fkey') THEN
                    ALTER TABLE mt5_accounts
                    ADD CONSTRAINT mt5_accounts_user_id_fkey
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
                END IF;
            END $$;
            
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
        `);
        res.send('MT5 tables created successfully!');
    } catch (err) {
        console.error('Setup error:', err);
        res.status(500).send('Error: ' + err.message);
    }
});
