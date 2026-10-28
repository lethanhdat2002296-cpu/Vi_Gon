// Rate limit theo key, lưu DB (serverless không có bộ nhớ chung)
// FAIL-CLOSED: lỗi DB thì coi như bị chặn, không cho qua.
const db = require('../lib/db');

// Lấy IP client (Vercel đặt qua x-forwarded-for)
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Trả { allowed, retryAfterSec }. 1 câu UPSERT NGUYÊN TỬ (chống race vượt ngưỡng).
async function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  try {
    // Hết cửa sổ → reset count=1 + window mới; còn cửa sổ → count+1. RETURNING giá trị mới.
    const r = await db.query(`
      INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN $2 - rate_limits.window_start > $3 THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN $2 - rate_limits.window_start > $3 THEN $2 ELSE rate_limits.window_start END
      RETURNING count, window_start
    `, [key, now, windowMs]);
    const row = r.rows[0];
    if (row.count > max) {
      const retryAfterSec = Math.ceil((windowMs - (now - Number(row.window_start))) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    return { allowed: true };
  } catch (e) {
    console.error('Lỗi rate limit:', e.message);
    return { allowed: false, retryAfterSec: 30, error: true };
  }
}

// Chỉ ĐỌC (không tăng): key đã bị khoá chưa (count >= max trong cửa sổ).
async function peekRateLimit(key, max, windowMs) {
  const now = Date.now();
  try {
    const r = await db.query('SELECT count, window_start FROM rate_limits WHERE key = $1', [key]);
    const row = r.rows[0];
    if (!row || now - Number(row.window_start) > windowMs) return { locked: false };
    if (row.count >= max) {
      return { locked: true, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - Number(row.window_start))) / 1000)) };
    }
    return { locked: false };
  } catch (e) {
    console.error('Lỗi đọc rate limit:', e.message);
    return { locked: true, retryAfterSec: 30, error: true };
  }
}

// Chỉ TĂNG đếm (ghi nhận 1 lần thất bại). Mở cửa sổ mới nếu hết hạn. 1 câu UPSERT nguyên tử.
async function incrementKey(key, windowMs) {
  const now = Date.now();
  try {
    await db.query(`
      INSERT INTO rate_limits (key, count, window_start) VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN $2 - rate_limits.window_start > $3 THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN $2 - rate_limits.window_start > $3 THEN $2 ELSE rate_limits.window_start END
    `, [key, now, windowMs]);
  } catch (e) { console.error('Lỗi increment rate limit:', e.message); }
}

// Xoá key (vd reset bộ đếm sai khi đăng nhập thành công).
async function clearKey(key) {
  try { await db.query('DELETE FROM rate_limits WHERE key = $1', [key]); } catch (e) {}
}

// Middleware: giới hạn theo IP + tên nhóm route. Lỗi DB → 503 (fail-closed).
function rateLimit(name, max, windowMs) {
  return async (req, res, next) => {
    const r = await checkRateLimit(`${name}:${getClientIp(req)}`, max, windowMs);
    if (r.allowed) return next();
    res.setHeader('Retry-After', String(r.retryAfterSec));
    if (r.error) return res.status(503).json({ error: 'Máy chủ đang bận, vui lòng thử lại sau.' });
    return res.status(429).json({ error: `Thao tác quá nhiều, thử lại sau ${r.retryAfterSec} giây.` });
  };
}

module.exports = { getClientIp, checkRateLimit, peekRateLimit, incrementKey, clearKey, rateLimit };
