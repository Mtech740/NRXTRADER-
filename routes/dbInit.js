const pool = require('./config/db');

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                phone VARCHAR(50),
                password_hash VARCHAR(255) NOT NULL,
                balance_zmw DECIMAL(15,2) DEFAULT 0,
                is_premium BOOLEAN DEFAULT FALSE,
                premium_trial_ends_at TIMESTAMP,
                premium_subscription_end TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS platform_stats (
                key VARCHAR(50) PRIMARY KEY,
                value BIGINT DEFAULT 0
            )
        `);
        await pool.query(`
            INSERT INTO platform_stats (key, value) VALUES ('total_trades', 0)
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Database initialized');
    } catch (err) {
        console.error('DB init error:', err);
    }
}

module.exports = initDatabase;
