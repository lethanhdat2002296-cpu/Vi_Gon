const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../lib/db');

// Xác thực JWT + kiểm tra token còn hiệu lực (token_version) và tài khoản còn tồn tại.
// → đổi mật khẩu / xoá tài khoản sẽ thu hồi mọi JWT cũ.
// FAIL-CLOSED: không kiểm được DB thì TỪ CHỐI, không cho qua dựa trên JWT.
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }

  let u;
  try {
    const r = await db.query('SELECT id, email, token_version FROM users WHERE id = $1', [payload.id]);
    u = r.rows[0];
  } catch (e) {
    console.error('Lỗi kiểm tra phiên:', e.message);
    return res.status(503).json({ error: 'Máy chủ đang bận, vui lòng thử lại sau.' });
  }
  if (!u) return res.status(401).json({ error: 'Phiên không còn hiệu lực' });
  if ((u.token_version || 0) !== (payload.tv || 0)) {
    return res.status(401).json({ error: 'Phiên đã hết hiệu lực (mật khẩu đã đổi). Vui lòng đăng nhập lại.' });
  }

  req.user = { id: Number(u.id), email: u.email, tv: u.token_version || 0 };
  next();
}

// Bắt nhập lại mật khẩu cho thao tác PHÁ HUỶ (xoá tài khoản, nhập đè dữ liệu).
// Đặt SAU authRequired. Nhận mật khẩu qua header x-confirm-password hoặc body.password.
async function passwordConfirmRequired(req, res, next) {
  try {
    const pw = req.headers['x-confirm-password'] || (req.body && req.body.password) || '';
    if (!pw) {
      return res.status(403).json({ error: 'Cần nhập lại mật khẩu để thực hiện thao tác này.', need_password: true });
    }
    const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(String(pw), u.password_hash))) {
      return res.status(403).json({ error: 'Mật khẩu không đúng.', need_password: true });
    }
    next();
  } catch (e) { next(e); }
}

module.exports = { authRequired, passwordConfirmRequired };
