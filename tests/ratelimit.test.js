import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, require } from './helpers.js';
const { getClientIp, checkRateLimit, peekRateLimit, incrementKey, rateLimit } = require('../utils/ratelimit.js');

const realQuery = db.query;
let calls;

// DB giả trong bộ nhớ, mô phỏng đúng logic UPSERT của rate_limits
function fakeRateLimitDb() {
  const rows = new Map();
  return async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*INSERT INTO rate_limits/.test(sql)) {
      const [key, now, windowMs] = params;
      const cur = rows.get(key);
      let next;
      if (!cur) next = { count: 1, window_start: now };
      else if (now - cur.window_start > windowMs) next = { count: 1, window_start: now };
      else next = { count: cur.count + 1, window_start: cur.window_start };
      rows.set(key, next);
      return { rows: [{ ...next, window_start: String(next.window_start) }] };
    }
    if (/^SELECT count, window_start FROM rate_limits/.test(sql)) {
      const cur = rows.get(params[0]);
      return { rows: cur ? [{ ...cur, window_start: String(cur.window_start) }] : [] };
    }
    if (/^DELETE FROM rate_limits/.test(sql)) { rows.delete(params[0]); return { rows: [] }; }
    throw new Error('SQL không mong đợi: ' + sql);
  };
}

beforeEach(() => {
  calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  db.query = realQuery;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('getClientIp', () => {
  it('lấy IP đầu tiên của x-forwarded-for', () => {
    expect(getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })).toBe('1.2.3.4');
  });
  it('fallback req.ip', () => {
    expect(getClientIp({ headers: {}, ip: '5.6.7.8' })).toBe('5.6.7.8');
  });
  it('không có gì → unknown', () => {
    expect(getClientIp({ headers: {} })).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  it('cho qua đến đúng ngưỡng, chặn từ lần vượt', async () => {
    db.query = fakeRateLimitDb();
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit('k', 3, 60_000)).allowed).toBe(true);
    }
    const r = await checkRateLimit('k', 3, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it('hết cửa sổ thì mở lại', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    db.query = fakeRateLimitDb();
    await checkRateLimit('k', 1, 60_000);
    expect((await checkRateLimit('k', 1, 60_000)).allowed).toBe(false);
    vi.setSystemTime(new Date('2026-06-01T00:01:01Z'));
    expect((await checkRateLimit('k', 1, 60_000)).allowed).toBe(true);
  });
  it('key khác nhau đếm riêng', async () => {
    db.query = fakeRateLimitDb();
    await checkRateLimit('a', 1, 60_000);
    expect((await checkRateLimit('b', 1, 60_000)).allowed).toBe(true);
  });
  it('lỗi DB → TỪ CHỐI (fail-closed)', async () => {
    db.query = async () => { throw new Error('db down'); };
    const r = await checkRateLimit('k', 100, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.error).toBe(true);
  });
});

describe('peekRateLimit + incrementKey', () => {
  it('khoá sau đủ số lần sai, không tự tăng khi peek', async () => {
    db.query = fakeRateLimitDb();
    expect((await peekRateLimit('login:a@b.vn', 2, 900_000)).locked).toBe(false);
    await incrementKey('login:a@b.vn', 900_000);
    expect((await peekRateLimit('login:a@b.vn', 2, 900_000)).locked).toBe(false);
    await incrementKey('login:a@b.vn', 900_000);
    const r = await peekRateLimit('login:a@b.vn', 2, 900_000);
    expect(r.locked).toBe(true);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });
  it('lỗi DB khi peek → coi như đang khoá (fail-closed)', async () => {
    db.query = async () => { throw new Error('db down'); };
    expect((await peekRateLimit('k', 5, 60_000)).locked).toBe(true);
  });
});

describe('middleware rateLimit', () => {
  function mockRes() {
    return {
      statusCode: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; }
    };
  }
  it('quá ngưỡng → 429 + Retry-After', async () => {
    db.query = fakeRateLimitDb();
    const mw = rateLimit('login', 1, 60_000);
    const req = { headers: { 'x-forwarded-for': '9.9.9.9' } };
    const next = vi.fn();
    await mw(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const res = mockRes();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
    expect(calls[0].params[0]).toBe('login:9.9.9.9');
  });
  it('lỗi DB → 503, không gọi next', async () => {
    db.query = async () => { throw new Error('db down'); };
    const res = mockRes();
    const next = vi.fn();
    await rateLimit('login', 10, 60_000)({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });
});
