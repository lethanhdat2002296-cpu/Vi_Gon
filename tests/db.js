// Test tích hợp với Postgres THẬT (không mock SQL).
// Chạy khi có TEST_DATABASE_URL, ví dụ:
//   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/vigon_test npm test
// Không có biến này thì các test dùng DB được bỏ qua (skip).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const TEST_DB = process.env.TEST_DATABASE_URL || '';
export const db = require('../lib/db.js');

let pgPool = null;

export async function setupDb() {
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: TEST_DB, max: 5 });
  db.setPoolForTests(pgPool);
  // Làm sạch schema rồi chạy toàn bộ migration như production
  await pgPool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { migrate } = require('../scripts/migrate.js');
  await migrate({ pool: pgPool, log: () => {} });
}

export async function resetData() {
  await pgPool.query('TRUNCATE users, login_attempts, rate_limits, email_tokens, books RESTART IDENTITY CASCADE');
}

export async function teardownDb() {
  if (pgPool) await pgPool.end();
}

export function sql(text, params) {
  return pgPool.query(text, params);
}

// Chạy app trên cổng ngẫu nhiên; trả { call, close }
export async function startApp() {
  const app = require('../app.js');
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // token có thể là chuỗi, hoặc { token, book } để chọn sổ chung (header X-Book-Id)
  async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token && typeof token === 'object') {
      if (token.book) headers['X-Book-Id'] = String(token.book);
      if (token.password) headers['X-Confirm-Password'] = token.password;
      token = token.token;
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  return { call, base, close: () => new Promise(r => server.close(r)) };
}
