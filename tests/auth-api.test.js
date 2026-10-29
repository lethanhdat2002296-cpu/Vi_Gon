import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql } from './db.js';
const require = createRequire(import.meta.url);

const email = require('../utils/email.js');
const config = require('../config.js');

describe.skipIf(!TEST_DB)('API tài khoản (Postgres thật)', () => {
  let server, base, sent;

  beforeAll(async () => {
    await setupDb();
    const app = require('../app.js');
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise(r => server.close(r));
    await teardownDb();
  });
  beforeEach(async () => {
    await resetData();
    sent = [];
    // Bắt email thay vì gửi thật; giữ token để test link
    vi.spyOn(email, 'sendVerifyEmail').mockImplementation(async (to, token) => { sent.push({ kind: 'verify', to, token }); return { ok: true }; });
    vi.spyOn(email, 'sendResetPassword').mockImplementation(async (to, token) => { sent.push({ kind: 'reset', to, token }); return { ok: true }; });
  });

  async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const register = (e = 'an@vigon.vn', p = 'matkhau123', full_name = 'An') =>
    call('POST', '/api/auth/register', { email: e, password: p, full_name });

  describe('health', () => {
    it('báo DB up và migration mới nhất', async () => {
      const r = await call('GET', '/api/health');
      expect(r.status).toBe(200);
      expect(r.body.db).toBe('up');
      expect(r.body.migration).toBe('007_sharing.sql');
    });
  });

  describe('đăng ký', () => {
    it('tạo tài khoản, trả token dùng được ngay (vào thẳng làm quen)', async () => {
      const r = await register();
      expect(r.status).toBe(201);
      expect(r.body.user).toMatchObject({ email: 'an@vigon.vn', full_name: 'An', email_verified: false, onboarded: false });
      expect(r.body.user.password_hash).toBeUndefined();
      const me = await call('GET', '/api/me', null, r.body.token);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('an@vigon.vn');
    });
    it('băm mật khẩu bằng bcrypt cost ≥ 10', async () => {
      await register();
      const { rows } = await sql('SELECT password_hash FROM users');
      expect(rows[0].password_hash).toMatch(/^\$2[aby]\$1\d\$/);
      expect(rows[0].password_hash).not.toContain('matkhau123');
    });
    it('gửi email xác minh, DB chỉ lưu hash của token', async () => {
      await register();
      expect(sent).toHaveLength(1);
      expect(sent[0].kind).toBe('verify');
      const { rows } = await sql('SELECT token_hash FROM email_tokens');
      expect(rows[0].token_hash).not.toBe(sent[0].token);
    });
    it('mỗi email một tài khoản (không phân biệt hoa thường)', async () => {
      await register('an@vigon.vn');
      const r = await register('  AN@Vigon.VN ');
      expect(r.status).toBe(409);
    });
    it('chặn mật khẩu < 8 ký tự và email sai', async () => {
      expect((await register('an@vigon.vn', '1234567')).status).toBe(400);
      expect((await register('khong-phai-email', 'matkhau123')).status).toBe(400);
    });
    it('giới hạn số lần đăng ký theo IP', async () => {
      for (let i = 0; i < 10; i++) expect((await register(`u${i}@vigon.vn`)).status).toBe(201);
      expect((await register('u10@vigon.vn')).status).toBe(429);
    });
  });

  describe('đăng nhập', () => {
    it('đúng mật khẩu → token; email không phân biệt hoa thường', async () => {
      await register();
      const r = await call('POST', '/api/auth/login', { email: 'AN@vigon.vn', password: 'matkhau123' });
      expect(r.status).toBe(200);
      expect(r.body.token).toBeTruthy();
    });
    it('sai mật khẩu và email không tồn tại trả CÙNG thông báo', async () => {
      await register();
      const a = await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai-mat-khau' });
      const b = await call('POST', '/api/auth/login', { email: 'khongco@vigon.vn', password: 'sai-mat-khau' });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.error).toBe(b.body.error);
    });
    it('khoá 15 phút sau 5 lần sai, kể cả khi sau đó nhập đúng', async () => {
      await register();
      for (let i = 0; i < 4; i++) {
        expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' })).status).toBe(401);
      }
      const fifth = await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      expect(fifth.status).toBe(429);
      expect(fifth.body.retry_after).toBeGreaterThan(14 * 60);
      expect(fifth.body.retry_after).toBeLessThanOrEqual(config.LOCKOUT_SECONDS);
      const right = await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhau123' });
      expect(right.status).toBe(429);
    });
    it('hết thời gian khoá thì đăng nhập lại được và đếm lại từ đầu', async () => {
      await register();
      for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      await sql('UPDATE login_attempts SET locked_until = $1', [Date.now() - 1]);
      const r = await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhau123' });
      expect(r.status).toBe(200);
      const { rows } = await sql('SELECT * FROM login_attempts');
      expect(rows).toHaveLength(0);
    });
    it('đăng nhập đúng xoá bộ đếm sai', async () => {
      await register();
      for (let i = 0; i < 4; i++) await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhau123' });
      expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' })).status).toBe(401);
    });
    it('lần sai cũ quá cửa sổ khoá thì không cộng dồn', async () => {
      await register();
      for (let i = 0; i < 4; i++) await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      await sql('UPDATE login_attempts SET last_failed_at = $1', [Date.now() - config.LOCKOUT_SECONDS * 1000 - 1000]);
      const r = await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      expect(r.status).toBe(401);
      const { rows } = await sql('SELECT failed_count FROM login_attempts');
      expect(rows[0].failed_count).toBe(1);
    });
  });

  describe('xác minh email', () => {
    it('link đúng → đã xác minh; bấm lại lần 2 báo "đã xác minh rồi" chứ không báo lỗi', async () => {
      const reg = await register();
      const t = sent[0].token;
      const first = await call('POST', '/api/auth/verify-email', { token: t });
      expect(first.status).toBe(200);
      expect(first.body.already).toBeUndefined();
      const me = await call('GET', '/api/me', null, reg.body.token);
      expect(me.body.user.email_verified).toBe(true);
      expect(await call('POST', '/api/auth/verify-email', { token: t })).toEqual({ status: 200, body: { ok: true, already: true } });
    });
    it('link quá 24h bị từ chối', async () => {
      await register();
      await sql("UPDATE email_tokens SET expires_at = NOW() - INTERVAL '1 second'");
      expect((await call('POST', '/api/auth/verify-email', { token: sent[0].token })).status).toBe(400);
    });
    it('token rác bị từ chối', async () => {
      expect((await call('POST', '/api/auth/verify-email', { token: 'abc' })).status).toBe(400);
      expect((await call('POST', '/api/auth/verify-email', {})).status).toBe(400);
    });
    it('gửi lại email: link cũ hết hiệu lực, link mới dùng được', async () => {
      const reg = await register();
      const old = sent[0].token;
      expect((await call('POST', '/api/auth/resend-verify', null, reg.body.token)).status).toBe(200);
      expect((await call('POST', '/api/auth/verify-email', { token: old })).status).toBe(400);
      expect((await call('POST', '/api/auth/verify-email', { token: sent[1].token })).status).toBe(200);
    });
  });

  describe('quên / đặt lại mật khẩu', () => {
    it('email có hay không có tài khoản đều trả cùng câu', async () => {
      await register();
      sent = [];
      const a = await call('POST', '/api/auth/forgot', { email: 'an@vigon.vn' });
      const b = await call('POST', '/api/auth/forgot', { email: 'khongco@vigon.vn' });
      expect(a.status).toBe(200);
      expect(a.body).toEqual(b.body);
      expect(sent).toHaveLength(1);
    });
    it('đặt lại: mật khẩu mới dùng được, cũ thì không; phiên cũ bị thu hồi; link dùng 1 lần', async () => {
      const reg = await register();
      await call('POST', '/api/auth/forgot', { email: 'an@vigon.vn' });
      const t = sent.find(s => s.kind === 'reset').token;
      const r = await call('POST', '/api/auth/reset', { token: t, password: 'matkhaumoi1' });
      expect(r.status).toBe(200);
      expect((await call('GET', '/api/me', null, r.body.token)).status).toBe(200);
      expect((await call('GET', '/api/me', null, reg.body.token)).status).toBe(401);
      expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhau123' })).status).toBe(401);
      expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhaumoi1' })).status).toBe(200);
      expect((await call('POST', '/api/auth/reset', { token: t, password: 'matkhaukhac1' })).status).toBe(400);
    });
    it('link quá 1 giờ bị từ chối', async () => {
      await register();
      await call('POST', '/api/auth/forgot', { email: 'an@vigon.vn' });
      const { rows } = await sql("SELECT expires_at - created_at AS ttl FROM email_tokens WHERE kind = 'reset'");
      expect(rows[0].ttl.hours || 0).toBe(1);
      await sql("UPDATE email_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE kind = 'reset'");
      const t = sent.find(s => s.kind === 'reset').token;
      expect((await call('POST', '/api/auth/reset', { token: t, password: 'matkhaumoi1' })).status).toBe(400);
    });
    it('đặt lại mật khẩu mở khoá đăng nhập', async () => {
      await register();
      for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'sai' });
      await call('POST', '/api/auth/forgot', { email: 'an@vigon.vn' });
      const t = sent.find(s => s.kind === 'reset').token;
      await call('POST', '/api/auth/reset', { token: t, password: 'matkhaumoi1' });
      expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhaumoi1' })).status).toBe(200);
    });
  });

  describe('/api/me', () => {
    it('chưa đăng nhập → 401', async () => {
      expect((await call('GET', '/api/me')).status).toBe(401);
    });
    it('sửa tên, giao diện, ẩn số tiền, mục đích; bỏ qua trường lạ', async () => {
      const { body } = await register();
      const r = await call('PATCH', '/api/me', {
        full_name: 'Bình', theme: 'dark', hide_amounts: true, onboarding_purpose: 'save', token_version: 99, email: 'x@y.vn'
      }, body.token);
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ full_name: 'Bình', theme: 'dark', hide_amounts: true, onboarding_purpose: 'save', email: 'an@vigon.vn' });
      expect((await call('GET', '/api/me', null, body.token)).status).toBe(200);
    });
    it('giá trị sai → 400', async () => {
      const { body } = await register();
      expect((await call('PATCH', '/api/me', { theme: 'tim' }, body.token)).status).toBe(400);
      expect((await call('PATCH', '/api/me', { hide_amounts: 'yes' }, body.token)).status).toBe(400);
      expect((await call('PATCH', '/api/me', { onboarding_purpose: 'x' }, body.token)).status).toBe(400);
      expect((await call('PATCH', '/api/me', {}, body.token)).status).toBe(400);
    });
    it('chỉ thấy và sửa được tài khoản của chính mình', async () => {
      const a = await register('a@vigon.vn');
      const b = await register('b@vigon.vn');
      await call('PATCH', '/api/me', { full_name: 'Của B' }, b.body.token);
      const meA = await call('GET', '/api/me', null, a.body.token);
      expect(meA.body.user.email).toBe('a@vigon.vn');
      expect(meA.body.user.full_name).toBe('An');
    });
  });

  describe('đổi mật khẩu', () => {
    it('đổi xong: máy này nhận token mới, token cũ bị thu hồi', async () => {
      const { body } = await register();
      const r = await call('POST', '/api/me/password', { current_password: 'matkhau123', new_password: 'matkhaumoi1' }, body.token);
      expect(r.status).toBe(200);
      expect((await call('GET', '/api/me', null, body.token)).status).toBe(401);
      expect((await call('GET', '/api/me', null, r.body.token)).status).toBe(200);
      expect((await call('POST', '/api/auth/login', { email: 'an@vigon.vn', password: 'matkhaumoi1' })).status).toBe(200);
    });
    it('sai mật khẩu hiện tại → 403, không đổi gì', async () => {
      const { body } = await register();
      const r = await call('POST', '/api/me/password', { current_password: 'sai', new_password: 'matkhaumoi1' }, body.token);
      expect(r.status).toBe(403);
      expect((await call('GET', '/api/me', null, body.token)).status).toBe(200);
    });
    it('mật khẩu mới < 8 ký tự → 400', async () => {
      const { body } = await register();
      expect((await call('POST', '/api/me/password', { current_password: 'matkhau123', new_password: '123' }, body.token)).status).toBe(400);
    });
  });

  describe('đăng xuất', () => {
    it('mặc định không thu hồi phiên; all:true thu hồi mọi phiên', async () => {
      const { body } = await register();
      expect((await call('POST', '/api/auth/logout', {}, body.token)).status).toBe(200);
      expect((await call('GET', '/api/me', null, body.token)).status).toBe(200);
      expect((await call('POST', '/api/auth/logout', { all: true }, body.token)).status).toBe(200);
      expect((await call('GET', '/api/me', null, body.token)).status).toBe(401);
    });
  });
});
