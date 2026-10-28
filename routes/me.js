// /api/me: hồ sơ người đang đăng nhập, cài đặt, đổi mật khẩu (F01, F08)
const express = require('express');
const db = require('../lib/db');
const auth = require('../services/auth');
const { authRequired } = require('../middleware/auth');
const { validatePassword } = require('../utils/validators');
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

module.exports = router;
