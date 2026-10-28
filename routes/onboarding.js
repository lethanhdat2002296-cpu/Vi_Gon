// /api/onboarding/complete: kết thúc làm quen (F01). Bắt buộc đã có ít nhất 1 ví (bước 2).
// category_preset: 'full' giữ cả mục con; 'basic' chỉ giữ danh mục cấp 1 (bỏ mục con chưa dùng).
const express = require('express');
const db = require('../lib/db');
const auth = require('../services/auth');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const { USER_COLS } = require('./auth');

const router = express.Router();
router.use(authRequired, bookRequired);

router.post('/complete', async (req, res, next) => {
  try {
    const preset = (req.body || {}).category_preset || 'full';
    if (!['full', 'basic'].includes(preset)) return res.status(400).json({ error: 'Bộ danh mục không hợp lệ' });
    const w = await db.query('SELECT 1 FROM wallets WHERE book_id = $1 AND archived_at IS NULL LIMIT 1', [req.bookId]);
    if (!w.rows[0]) return res.status(400).json({ error: 'Cần tạo ít nhất 1 ví trước' });
    if (preset === 'basic') {
      await db.query(
        `DELETE FROM categories c WHERE c.book_id = $1 AND c.parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.category_id = c.id)`,
        [req.bookId]
      );
    }
    const r = await db.query(
      `UPDATE users SET onboarded_at = COALESCE(onboarded_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLS}`,
      [req.user.id]
    );
    res.json({ user: auth.publicUser(r.rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
