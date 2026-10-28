import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { db, require } from './helpers.js';
const fs = require('fs');
const path = require('path');
const app = require('../app.js');
const { listMigrations } = require('../scripts/migrate.js');

const realQuery = db.query;
let server, base;
beforeAll(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(r => server.close(r)));
afterEach(() => { db.query = realQuery; });

describe('/api/health', () => {
  it('DB lên → 200 {ok:true, db:"up"}', async () => {
    db.query = async () => ({ rows: [{ '?column?': 1 }] });
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
  });
  it('DB xuống → 503 {ok:false, db:"down"}', async () => {
    db.query = async () => { throw new Error('db down'); };
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(503);
    expect((await r.json()).db).toBe('down');
  });
  it('có security headers', async () => {
    db.query = async () => ({ rows: [] });
    const r = await fetch(`${base}/api/health`);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('route khác', () => {
  it('API không tồn tại → 404 JSON', async () => {
    const r = await fetch(`${base}/api/khong-co`);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBeTruthy();
  });
  it('trang chủ trả HTML', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Ví Gọn');
  });
});

describe('migrations', () => {
  it('file đánh số liên tục, bắt đầu từ 001_init.sql', () => {
    const files = listMigrations();
    expect(files[0]).toBe('001_init.sql');
    files.forEach((f, i) => expect(f.slice(0, 3)).toBe(String(i + 1).padStart(3, '0')));
  });
  it('001 tạo đủ bảng nền tảng, tiền không dùng số thực', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_init.sql'), 'utf8');
    for (const t of ['schema_migrations', 'users', 'login_attempts', 'rate_limits']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
    expect(sql).not.toMatch(/\b(REAL|FLOAT|DOUBLE PRECISION|NUMERIC)\b/i);
  });
});
