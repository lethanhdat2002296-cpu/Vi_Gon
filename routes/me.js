// /api/me: hồ sơ người đang đăng nhập, cài đặt, đổi mật khẩu (F01, F08)
const express = require('express');
const db = require('../lib/db');
const auth = require('../services/auth');
const { authRequired, passwordConfirmRequired } = require('../middleware/auth');
const { validatePassword, validateEmail, normalizeEmail } = require('../utils/validators');
const { checkRealEmail } = require('../utils/realemail');
const config = require('../config');
const { checkRateLimit, clearKey } = require('../utils/ratelimit');
const email = require('../utils/email');
const { USER_COLS, validateName } = require('./auth');

const router = express.Router();
router.use(authRequired);

const THEMES = ['system', 'light', 'dark'];
const PURPOSES = ['track', 'save', 'debt', 'family', 'other'];

router.get('/', async (req, res, next) => {
  try {
    const r = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.id]);
    res.json({ user: auth.publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});

// Chỉ sửa được các trường liệt kê; trường lạ bị bỏ qua
router.patch('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const vals = [req.user.id];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if ('full_name' in b) {
      const err = validateName(b.full_name);
      if (err) return res.status(400).json({ error: err });
      add('full_name', (b.full_name || '').trim());
    }
    if ('theme' in b) {
      if (!THEMES.includes(b.theme)) return res.status(400).json({ error: 'Giao diện không hợp lệ' });
      add('theme', b.theme);
    }
    if ('hide_amounts' in b) {
      if (typeof b.hide_amounts !== 'boolean') return res.status(400).json({ error: 'hide_amounts phải là true/false' });
      add('hide_amounts', b.hide_amounts);
    }
    if ('onboarding_purpose' in b) {
      if (b.onboarding_purpose !== null && !PURPOSES.includes(b.onboarding_purpose)) {
        return res.status(400).json({ error: 'Mục đích không hợp lệ' });
      }
      add('onboarding_purpose', b.onboarding_purpose);
    }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });

    const r = await db.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`,
      vals
    );
    res.json({ user: auth.publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});

// Đổi mật khẩu: tăng token_version → mọi máy khác bị đăng xuất; máy này nhận token mới.
router.post('/password', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (typeof b.current_password !== 'string' || !b.current_password) {
      return res.status(400).json({ error: 'Nhập mật khẩu hiện tại' });
    }
    const err = validatePassword(b.new_password);
    if (err) return res.status(400).json({ error: err });

    const cur = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await auth.verifyPassword(b.current_password, cur.rows[0] && cur.rows[0].password_hash))) {
      return res.status(403).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    const hash = await auth.hashPassword(b.new_password);
    const r = await db.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = NOW()
       WHERE id = $1 RETURNING ${USER_COLS}`,
      [req.user.id, hash]
    );
    const user = r.rows[0];
    res.json({ token: auth.signToken(user), user: auth.publicUser(user) });
  } catch (e) { next(e); }
});

// ============ ĐỔI EMAIL (nhập lại mật khẩu) ============
// Email mới phải xác minh lại; gửi link xác minh tới email mới.
router.post('/email', passwordConfirmRequired, async (req, res, next) => {
  try {
    const raw = (req.body || {}).email;
    const err = validateEmail(raw);
    if (err) return res.status(400).json({ error: err });
    const fake = await checkRealEmail(raw, { mx: config.EMAIL_MX_CHECK });
    if (fake) return res.status(400).json({ error: fake, field: 'email' });
    const addr = normalizeEmail(raw);
    const taken = await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2', [addr, req.user.id]);
    if (taken.rows[0]) return res.status(409).json({ error: 'Email này đã có tài khoản khác dùng' });
    const r = await db.query(
      `UPDATE users SET email = $2, email_verified_at = CASE WHEN LOWER(email) = $2 THEN email_verified_at END, updated_at = NOW()
       WHERE id = $1 RETURNING ${USER_COLS}`,
      [req.user.id, addr]
    );
    const user = r.rows[0];
    let sent = { ok: true };
    if (!user.email_verified_at) {
      const token = await auth.createEmailToken(user.id, 'verify');
      sent = await email.sendVerifyEmail(user.email, token, user.full_name);
    }
    res.json({ user: auth.publicUser(user), email_sent: !!sent.ok });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email này đã có tài khoản khác dùng' });
    next(e);
  }
});

// ============ PIN KHOÁ APP (tạo mới: đúng 6 số; mở khoá vẫn nhận PIN cũ 4–5 số), băm bcrypt ============
const PIN_RE = /^\d{4,6}$/;      // mở khoá (PIN cũ có thể 4–5 số)
const NEW_PIN_RE = /^\d{6}$/;     // tạo / đổi PIN
const PIN_MAX_FAILS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

router.post('/pin', passwordConfirmRequired, async (req, res, next) => {
  try {
    const pin = String((req.body || {}).pin || '');
    if (!NEW_PIN_RE.test(pin)) return res.status(400).json({ error: 'PIN phải gồm đúng 6 chữ số' });
    const hash = await auth.hashPassword(pin);
    const r = await db.query(`UPDATE users SET pin_hash = $2, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`, [req.user.id, hash]);
    await clearKey(`pin:${req.user.id}`);
    res.json({ user: auth.publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});

router.delete('/pin', passwordConfirmRequired, async (req, res, next) => {
  try {
    const r = await db.query(`UPDATE users SET pin_hash = NULL, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`, [req.user.id]);
    res.json({ user: auth.publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});

// Mở khoá bằng PIN. Sai 5 lần trong 15 phút → thu hồi mọi phiên, phải đăng nhập lại bằng mật khẩu.
router.post('/pin/verify', async (req, res, next) => {
  try {
    const r = await db.query('SELECT pin_hash FROM users WHERE id = $1', [req.user.id]);
    const hash = r.rows[0] && r.rows[0].pin_hash;
    if (!hash) return res.json({ ok: true, no_pin: true });
    const pin = String((req.body || {}).pin || '');
    if (PIN_RE.test(pin) && await auth.verifyPassword(pin, hash)) {
      await clearKey(`pin:${req.user.id}`);
      return res.json({ ok: true });
    }
    const rl = await checkRateLimit(`pin:${req.user.id}`, PIN_MAX_FAILS - 1, PIN_WINDOW_MS);
    if (!rl.allowed) {
      await db.query('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1', [req.user.id]);
      await clearKey(`pin:${req.user.id}`);
      return res.status(401).json({ error: 'Sai PIN quá nhiều lần. Hãy đăng nhập lại bằng mật khẩu.', signed_out: true });
    }
    res.status(403).json({ error: 'PIN không đúng' });
  } catch (e) { next(e); }
});

// ============ XOÁ TÀI KHOẢN VĨNH VIỄN (nhập lại mật khẩu) ============
// Xoá cứng: sổ cá nhân (ví, danh mục, giao dịch) đi theo ON DELETE CASCADE; bộ đếm theo email/id xoá tay.
router.delete('/', passwordConfirmRequired, async (req, res, next) => {
  try {
    if ((req.body || {}).confirm !== 'XOA') return res.status(400).json({ error: 'Gõ XOA để xác nhận' });
    await db.withTransaction(async (client) => {
      const u = (await client.query('SELECT email FROM users WHERE id = $1 FOR UPDATE', [req.user.id])).rows[0];
      await client.query('DELETE FROM books WHERE owner_id = $1', [req.user.id]);
      await client.query('DELETE FROM users WHERE id = $1', [req.user.id]);
      await client.query('DELETE FROM login_attempts WHERE email = $1', [normalizeEmail(u.email)]);
      await client.query('DELETE FROM rate_limits WHERE key = ANY($1::text[])',
        [[`resend:${req.user.id}`, `pin:${req.user.id}`, `import:${req.user.id}`, `forgot-email:${normalizeEmail(u.email)}`]]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
