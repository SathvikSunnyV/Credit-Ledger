// db.js
// A single shared connection pool to your Neon Postgres database.
// Neon connection strings already include `sslmode=require`, but we set the
// SSL option explicitly here too since some hosts (like Render) need it spelled out.

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    '\n[db] FATAL: DATABASE_URL is not set in your .env file.\n' +
    '     1. Get your connection string from Neon -> your project -> Connection Details.\n' +
    '     2. Add it to .env as: DATABASE_URL=postgresql://user:password@...neon.tech/dbname?sslmode=require\n' +
    '     3. Restart the server.\n'
  );
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

module.exports = pool;