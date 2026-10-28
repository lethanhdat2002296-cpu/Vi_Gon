// Chạy các migration chưa áp dụng trong db/migrations (theo thứ tự tên file).
// Dùng: npm run migrate   (cần DATABASE_URL trong .env hoặc env)
// Mỗi file chạy trong 1 transaction; đã chạy thì ghi vào schema_migrations, không chạy lại.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

function listMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

async function migrate({ pool, log = console.log } = {}) {
  const client = await pool.connect();
  try {
    // Khoá để 2 lần chạy cùng lúc không áp migration chồng nhau
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const done = new Set((await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename));
    const pending = listMigrations().filter(f => !done.has(f));
    if (!pending.length) log('✓ Không có migration mới.');
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`✓ ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} lỗi: ${e.message}`);
      }
    }
    return pending;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727001)'); } catch (e) {}
    client.release();
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Chưa set DATABASE_URL.');
    process.exit(1);
  }
  const pool = require('../lib/db').getPool();
  migrate({ pool })
    .then(() => pool.end())
    .catch(e => { console.error('✗', e.message); pool.end().finally(() => process.exit(1)); });
}

module.exports = { migrate, listMigrations };
