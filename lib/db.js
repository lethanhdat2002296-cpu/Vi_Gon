// Postgres connection - Neon serverless driver
// Hoạt động cả local Node.js và Vercel serverless functions
// Schema tạo bằng migration: `npm run migrate` (db/migrations/*.sql)
const { Pool, neonConfig } = require('@neondatabase/serverless');

// Node 22+ có native WebSocket, các version cũ cần fallback
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    neonConfig.webSocketConstructor = require('ws');
  } catch (e) {
    console.warn('Node version < 22 và chưa cài ws. Cài thêm: npm i ws');
  }
}

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  console.error('⚠ DATABASE_URL chưa được set trong env. App sẽ không kết nối được DB.');
}

// Pool: tái sử dụng connection trong cùng instance Vercel (warm)
let pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Vercel function ngắn, pooler của Neon đã lo multiplexing
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

// Chạy fn(client) trong 1 transaction; lỗi thì ROLLBACK và ném lại
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    throw e;
  } finally {
    client.release();
  }
}

// Chỉ dùng trong test: thay pool Neon bằng pool `pg` trỏ vào Postgres local
function setPoolForTests(p) {
  pool = p;
}

module.exports = { query, withTransaction, setPoolForTests, getPool: () => pool };
