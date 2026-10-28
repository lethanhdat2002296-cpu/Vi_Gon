// /api/auth: đăng ký, đăng nhập, đăng xuất, xác minh email, quên/đặt lại mật khẩu (F01)
const express = require('express');
const db = require('../lib/db');
const auth = require('../services/auth');
const email = require('../utils/email');
const { authRequired } = require('../middleware/auth');
const { rateLimit, checkRateLimit } = require('../utils/ratelimit');
const { validateEmail, normalizeEmail, validatePassword } = require('../utils/validators');

const router = express.Router();
const HOUR = 3600 * 1000;
const USER_COLS = 'id, email, password_hash, full_name, pin_hash, token_version, email_verified_at, theme, hide_amounts, onboarding_purpose, onboarded_at, created_at';
const BAD_LOGIN = 'Email hoặc mật khẩu không đúng';

function validateName(name) {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string') return 'Tên không hợp lệ';
  if (name.trim().length > 100) return 'Tên tối đa 100 ký tự';
  return null;
}

// ============ ĐĂNG KÝ ============
// Trả token luôn → client vào thẳng bước làm quen, không phải đăng nhập lại.
router.post('/register', rateLimit('register', 10, HOUR), async (req, res, next) => {
  try {
    const body = req.body || {};
    const err = validateEmail(body.email) || validatePassword(body.password) || validateName(body.full_name);
    if (err) return res.status(400).json({ error: err });

    const addr = normalizeEmail(body.email);
    const hash = await auth.hashPassword(body.password);
    const r = await db.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)
       ON CONFLICT ((LOWER(email))) DO NOTHING
       RETURNING ${USER_COLS}`,
      [addr, hash, (body.full_name || '').trim()]
    );
    const user = r.rows[0];
    if (!user) return res.status(409).json({ error: 'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng "Quên mật khẩu".' });

    const token = await auth.createEmailToken(user.id, 'verify');
    const sent = await email.sendVerifyEmail(user.email, token, user.full_name);
    res.status(201).json({ token: auth.signToken(user), user: auth.publicUser(user), email_sent: !!sent.ok });
  } catch (e) { next(e); }
});

// ============ ĐĂNG NHẬP ============
// Khoá 15 phút sau 5 lần sai (theo email). Thông báo lỗi giống nhau dù email có tồn tại hay không.
router.post('/login', rateLimit('login', 30, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
      return res.status(400).json({ error: 'Nhập email và mật khẩu' });
    }
    const addr = normalizeEmail(body.email);

    const lock = await auth.getLock(addr);
    if (lock.locked) return locked(res, lock.retryAfterSec);

    const r = await db.query(`SELECT ${USER_COLS} FROM users WHERE LOWER(email) = $1`, [addr]);
    const user = r.rows[0];
    const ok = await auth.verifyPassword(body.password, user && user.password_hash);
    if (!ok) {
      const f = await auth.recordFailure(addr);
      if (f.locked) return locked(res, f.retryAfterSec);
      return res.status(401).json({ error: BAD_LOGIN });
    }

    await auth.clearFailures(addr);
    res.json({ token: auth.signToken(user), user: auth.publicUser(user) });
  } catch (e) { next(e); }
});

function locked(res, sec) {
  res.setHeader('Retry-After', String(sec));
  const min = Math.ceil(sec / 60);
  return res.status(429).json({ error: `Sai quá nhiều lần. Thử lại sau ${min} phút hoặc dùng "Quên mật khẩu".`, retry_after: sec });
}

// ============ ĐĂNG XUẤT ============
// Mặc định chỉ máy này (client xoá token). { all: true } → thu hồi mọi phiên trên mọi máy.
router.post('/logout', authRequired, async (req, res, next) => {
  try {
    if (req.body && req.body.all === true) {
      await db.query('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1', [req.user.id]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============ XÁC MINH EMAIL (token 24h) ============
router.post('/verify-email', rateLimit('verify', 20, HOUR), async (req, res, next) => {
  try {
    const userId = await auth.consumeEmailToken(req.body && req.body.token, 'verify');
    if (!userId) return res.status(400).json({ error: 'Link xác minh không hợp lệ hoặc đã hết hạn.' });
    await db.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = $1',
      [userId]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Gửi lại email xác minh cho người đang đăng nhập
router.post('/resend-verify', authRequired, async (req, res, next) => {
  try {
    const rl = await checkRateLimit(`resend:${req.user.id}`, 3, HOUR);
    if (!rl.allowed) return res.status(rl.error ? 503 : 429).json({ error: 'Đã gửi nhiều lần, thử lại sau.' });
    const r = await db.query('SELECT id, email, full_name, email_verified_at FROM users WHERE id = $1', [req.user.id]);
    const u = r.rows[0];
    if (u.email_verified_at) return res.json({ ok: true, already: true });
    const token = await auth.createEmailToken(u.id, 'verify');
    const sent = await email.sendVerifyEmail(u.email, token, u.full_name);
    if (!sent.ok) return res.status(502).json({ error: 'Chưa gửi được email, thử lại sau.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============ QUÊN MẬT KHẨU ============
// Luôn trả cùng một câu → không lộ email có tài khoản hay không.
const FORGOT_OK = 'Nếu email này có tài khoản, chúng tôi đã gửi link đặt lại mật khẩu. Link có hạn 1 giờ.';
router.post('/forgot', rateLimit('forgot', 10, HOUR), async (req, res, next) => {
  try {
    const raw = req.body && req.body.email;
    const err = validateEmail(raw);
    if (err) return res.status(400).json({ error: err });
    const addr = normalizeEmail(raw);

    const rl = await checkRateLimit(`forgot-email:${addr}`, 3, HOUR);
    if (!rl.allowed) return res.json({ ok: true, message: FORGOT_OK });

    const r = await db.query('SELECT id, email, full_name FROM users WHERE LOWER(email) = $1', [addr]);
    const u = r.rows[0];
    if (u) {
      const token = await auth.createEmailToken(u.id, 'reset');
      await email.sendResetPassword(u.email, token, u.full_name);
    }
    res.json({ ok: true, message: FORGOT_OK });
  } catch (e) { next(e); }
});

// ============ ĐẶT LẠI MẬT KHẨU (token 1h, dùng 1 lần) ============
// Thu hồi mọi phiên cũ + mở khoá đăng nhập; trả token mới để vào app luôn.
router.post('/reset', rateLimit('reset', 20, HOUR), async (req, res, next) => {
  try {
    const body = req.body || {};
    const err = validatePassword(body.password);
    if (err) return res.status(400).json({ error: err });

    const userId = await auth.consumeEmailToken(body.token, 'reset');
    if (!userId) return res.status(400).json({ error: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' });

    const hash = await auth.hashPassword(body.password);
    const r = await db.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = NOW()
       WHERE id = $1 RETURNING ${USER_COLS}`,
      [userId, hash]
    );
    const user = r.rows[0];
    if (!user) return res.status(400).json({ error: 'Tài khoản không còn tồn tại.' });
    await auth.clearFailures(normalizeEmail(user.email));
    res.json({ token: auth.signToken(user), user: auth.publicUser(user) });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.USER_COLS = USER_COLS;
module.exports.validateName = validateName;
