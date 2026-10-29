// Logic tài khoản: mật khẩu, JWT, token email, khoá đăng nhập.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../lib/db');

const BCRYPT_COST = 10;
const TOKEN_TTL_MS = { verify: 24 * 3600 * 1000, reset: 3600 * 1000 };

// Hash giả để so khi email không tồn tại → thời gian phản hồi như nhau
let dummyHash = null;

async function hashPassword(pw) {
  return bcrypt.hash(String(pw), BCRYPT_COST);
}

async function verifyPassword(pw, hash) {
  if (!hash) {
    dummyHash = dummyHash || await bcrypt.hash('khong-co-tai-khoan', BCRYPT_COST);
    await bcrypt.compare(String(pw), dummyHash);
    return false;
  }
  return bcrypt.compare(String(pw), hash);
}

// JWT mang id + token_version; tăng token_version là thu hồi mọi phiên cũ
function signToken(user) {
  return jwt.sign({ id: Number(user.id), tv: user.token_version || 0 }, config.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN
  });
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Tạo token email mới (trả bản rõ để gửi đi, DB chỉ giữ hash).
// Token cùng loại còn hiệu lực trước đó bị vô hiệu → chỉ link mới nhất dùng được.
async function createEmailToken(userId, kind) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    'UPDATE email_tokens SET used_at = NOW() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL',
    [userId, kind]
  );
  await db.query(
    `INSERT INTO email_tokens (token_hash, user_id, kind, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::bigint * INTERVAL '1 millisecond'))`,
    [sha256(token), userId, kind, TOKEN_TTL_MS[kind]]
  );
  return token;
}

// Dùng token 1 lần (nguyên tử). Trả user_id hoặc null nếu sai/hết hạn/đã dùng.
async function consumeEmailToken(token, kind) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const r = await db.query(
    `UPDATE email_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
    [sha256(token), kind]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

// Chủ của 1 mã (kể cả đã dùng / hết hạn) — để báo "đã xác minh rồi" khi bấm lại link cũ
async function emailTokenOwner(token, kind) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const r = await db.query('SELECT user_id FROM email_tokens WHERE token_hash = $1 AND kind = $2', [sha256(token), kind]);
  return r.rows[0] ? r.rows[0].user_id : null;
}

// ============ KHOÁ ĐĂNG NHẬP (theo email) ============
const lockMs = () => config.LOCKOUT_SECONDS * 1000;

// Trả { locked, retryAfterSec }. Lỗi DB ném ra → route trả 503 (fail-closed).
async function getLock(email) {
  const now = Date.now();
  const r = await db.query('SELECT locked_until FROM login_attempts WHERE email = $1', [email]);
  const until = r.rows[0] ? Number(r.rows[0].locked_until) : 0;
  if (until > now) return { locked: true, retryAfterSec: Math.ceil((until - now) / 1000) };
  return { locked: false };
}

// Ghi 1 lần sai (1 câu UPSERT nguyên tử). Sai lần thứ MAX → khoá LOCKOUT_SECONDS.
// Đếm lại từ 1 nếu lần sai trước đã quá cửa sổ khoá, hoặc vừa hết khoá.
async function recordFailure(email) {
  const now = Date.now();
  const stale = `($2::bigint - login_attempts.last_failed_at > $4::bigint
                 OR (login_attempts.locked_until <> 0 AND login_attempts.locked_until <= $2::bigint))`;
  const nextCount = `CASE WHEN ${stale} THEN 1 ELSE login_attempts.failed_count + 1 END`;
  const r = await db.query(`
    INSERT INTO login_attempts (email, failed_count, locked_until, last_failed_at)
    VALUES ($1, 1, CASE WHEN 1 >= $3::int THEN $2::bigint + $4::bigint ELSE 0 END, $2::bigint)
    ON CONFLICT (email) DO UPDATE SET
      failed_count = ${nextCount},
      locked_until = CASE WHEN ${nextCount} >= $3::int THEN $2::bigint + $4::bigint ELSE 0 END,
      last_failed_at = $2::bigint
    RETURNING failed_count, locked_until
  `, [email, now, config.MAX_LOGIN_ATTEMPTS, lockMs()]);
  const row = r.rows[0];
  const until = Number(row.locked_until);
  return {
    failedCount: row.failed_count,
    locked: until > now,
    retryAfterSec: until > now ? Math.ceil((until - now) / 1000) : 0
  };
}

async function clearFailures(email) {
  await db.query('DELETE FROM login_attempts WHERE email = $1', [email]);
}

// Dữ liệu user trả cho client (không bao giờ kèm hash)
function publicUser(u) {
  return {
    id: Number(u.id),
    email: u.email,
    full_name: u.full_name || '',
    email_verified: !!u.email_verified_at,
    theme: u.theme || 'system',
    hide_amounts: !!u.hide_amounts,
    onboarding_purpose: u.onboarding_purpose || null,
    onboarded: !!u.onboarded_at,
    has_pin: !!u.pin_hash,
    created_at: u.created_at
  };
}

module.exports = {
  hashPassword, verifyPassword, signToken, sha256,
  createEmailToken, consumeEmailToken,
  getLock, recordFailure, clearFailures, publicUser, emailTokenOwner
};
