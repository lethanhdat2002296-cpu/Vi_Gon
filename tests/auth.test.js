import { describe, it, expect, afterEach, vi } from 'vitest';
import { db, require } from './helpers.js';
const jwt = require('jsonwebtoken');
const config = require('../config.js');
const { authRequired } = require('../middleware/auth.js');

const realQuery = db.query;
afterEach(() => { db.query = realQuery; vi.restoreAllMocks(); });

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
const sign = (p) => jwt.sign(p, config.JWT_SECRET, { expiresIn: '1h' });

describe('authRequired', () => {
  it('không có token → 401', async () => {
    const res = mockRes(); const next = vi.fn();
    await authRequired({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('token sai chữ ký → 401', async () => {
    const res = mockRes(); const next = vi.fn();
    const bad = jwt.sign({ id: 1, tv: 0 }, 'khac-secret');
    await authRequired({ headers: { authorization: `Bearer ${bad}` } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('token hợp lệ + token_version khớp → cho qua, gắn req.user từ DB', async () => {
    db.query = async () => ({ rows: [{ id: 7, email: 'a@b.vn', token_version: 2 }] });
    const req = { headers: { authorization: `Bearer ${sign({ id: 7, tv: 2 })}` } };
    const next = vi.fn();
    await authRequired(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 7, email: 'a@b.vn', tv: 2 });
  });
  it('token_version cũ (đã đổi mật khẩu) → 401', async () => {
    db.query = async () => ({ rows: [{ id: 7, email: 'a@b.vn', token_version: 3 }] });
    const res = mockRes(); const next = vi.fn();
    await authRequired({ headers: { authorization: `Bearer ${sign({ id: 7, tv: 2 })}` } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('tài khoản đã xoá → 401', async () => {
    db.query = async () => ({ rows: [] });
    const res = mockRes(); const next = vi.fn();
    await authRequired({ headers: { authorization: `Bearer ${sign({ id: 7, tv: 0 })}` } }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('lỗi DB → TỪ CHỐI 503 (fail-closed), không cho qua', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.query = async () => { throw new Error('db down'); };
    const res = mockRes(); const next = vi.fn();
    await authRequired({ headers: { authorization: `Bearer ${sign({ id: 7, tv: 0 })}` } }, res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
