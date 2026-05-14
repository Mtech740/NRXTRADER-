const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

async function run() {
    try {
        const sql = fs.readFileSync('./schema.sql', 'utf8');
        await pool.query(sql);
        console.log('Migration completed successfully');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        process.exit();
    }
}
run();
