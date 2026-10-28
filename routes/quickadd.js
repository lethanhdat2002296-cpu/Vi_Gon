// /api/quickadd: dữ liệu mở bảng nhập nhanh trong 1 lần gọi (F03)
//   ví dùng được + ví dùng lần trước + 9 danh mục dùng nhiều nhất mỗi loại
// /api/quickadd/suggest?q=: ghi chú quen thuộc → gợi ý danh mục và số tiền lần trước
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const balance = require('../services/balance');
const { publicWallet } = require('./wallets');
const { publicCategory } = require('./categories');

const router = express.Router();
router.use(authRequired, bookRequired);

const TOP = 9;

router.get('/', async (req, res, next) => {
  try {
    const wallets = await balance.walletsWithBalance(req.bookId);
    const last = await db.query(
      `SELECT t.wallet_id FROM transactions t JOIN wallets w ON w.id = t.wallet_id
       WHERE t.book_id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL AND t.source = 'manual' AND w.archived_at IS NULL
       ORDER BY t.created_at DESC LIMIT 1`,
      [req.bookId, req.user.id]
    );
    // Xếp theo số lần dùng trong 90 ngày, sau đó theo thứ tự người dùng sắp
    const cats = await db.query(
      `SELECT c.*, COALESCE(u.n, 0) AS uses
       FROM categories c
       LEFT JOIN (
         SELECT category_id, COUNT(*) AS n FROM transactions
         WHERE book_id = $1 AND deleted_at IS NULL AND occurred_at > NOW() - INTERVAL '90 days'
         GROUP BY category_id
       ) u ON u.category_id = c.id
       WHERE c.book_id = $1 AND c.archived_at IS NULL
       ORDER BY c.kind, uses DESC, (c.parent_id IS NOT NULL), c.sort_order, c.id`,
      [req.bookId]
    );
    const top = kind => cats.rows.filter(c => c.kind === kind).slice(0, TOP).map(publicCategory);
    res.json({
      wallets: wallets.map(publicWallet),
      last_wallet_id: last.rows[0] ? Number(last.rows[0].wallet_id) : (wallets[0] ? Number(wallets[0].id) : null),
      top_categories: { expense: top('expense'), income: top('income') },
      categories: cats.rows.map(publicCategory)
    });
  } catch (e) { next(e); }
});

router.get('/suggest', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ suggestions: [] });
    // Thoát ký tự đặc biệt của LIKE
    const pattern = q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    const r = await db.query(
      `SELECT DISTINCT ON (LOWER(t.note)) t.note, t.kind, t.category_id, t.amount
       FROM transactions t
       WHERE t.book_id = $1 AND t.deleted_at IS NULL AND t.transfer_group IS NULL AND t.source <> 'adjust'
         AND t.note ILIKE $2
       ORDER BY LOWER(t.note), t.occurred_at DESC
       LIMIT 5`,
      [req.bookId, pattern]
    );
    res.json({
      suggestions: r.rows.map(x => ({
        note: x.note, kind: x.kind, amount: Number(x.amount),
        category_id: x.category_id === null ? null : Number(x.category_id)
      }))
    });
  } catch (e) { next(e); }
});

module.exports = router;
