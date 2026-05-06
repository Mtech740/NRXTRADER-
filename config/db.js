const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false   // disable SSL for internal Render communication
});
module.exports = pool;
