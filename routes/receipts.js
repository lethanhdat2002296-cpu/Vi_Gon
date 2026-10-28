// Ảnh hoá đơn đính kèm giao dịch (F13). Ảnh đã nén ở trình duyệt (< 200 KB).
//   PUT    /api/transactions/:id/receipt   { data: base64 }
//   GET    /api/transactions/:id/receipt   → ảnh
//   DELETE /api/transactions/:id/receipt
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const { toId } = require('../utils/params');

const router = express.Router({ mergeParams: true });
router.use(authRequired, bookRequired);

const MAX_BYTES = 200 * 1024;

// Nhận dạng ảnh theo vài byte đầu (không tin mime client gửi)
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function ownTx(req) {
  const id = toId(req.params.id);
  if (!id) return null;
  const r = await db.query('SELECT id, user_id FROM transactions WHERE id = $1 AND book_id = $2', [id, req.bookId]);
  return r.rows[0] ? { id, user_id: r.rows[0].user_id } : null;
}
// Sổ chung: chỉ người ghi hoặc chủ sổ đổi ảnh
function mayChange(req, t) {
  return req.bookRole === 'owner' || Number(t.user_id) === req.user.id;
}

router.put('/', canWrite, async (req, res, next) => {
  try {
    const t = await ownTx(req);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    if (!mayChange(req, t)) return res.status(403).json({ error: 'Chỉ người ghi hoặc chủ sổ được đổi ảnh' });
    const id = t.id;
    const b64 = (req.body || {}).data;
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) return res.status(400).json({ error: 'Ảnh không hợp lệ' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_BYTES) return res.status(400).json({ error: 'Ảnh lớn quá 200 KB' });
    const mime = sniff(buf);
    if (!mime) return res.status(400).json({ error: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP' });
    await db.query(
      `INSERT INTO transaction_receipts (transaction_id, mime, data) VALUES ($1, $2, $3)
       ON CONFLICT (transaction_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = NOW()`,
      [id, mime, buf]
    );
    res.json({ ok: true, bytes: buf.length });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const t = await ownTx(req);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    const id = t.id;
    const r = await db.query('SELECT mime, data FROM transaction_receipts WHERE transaction_id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Giao dịch chưa có ảnh' });
    res.setHeader('Content-Type', r.rows[0].mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(r.rows[0].data);
  } catch (e) { next(e); }
});

router.delete('/', canWrite, async (req, res, next) => {
  try {
    const t = await ownTx(req);
    if (!t) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    if (!mayChange(req, t)) return res.status(403).json({ error: 'Chỉ người ghi hoặc chủ sổ được xoá ảnh' });
    const id = t.id;
    await db.query('DELETE FROM transaction_receipts WHERE transaction_id = $1', [id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
