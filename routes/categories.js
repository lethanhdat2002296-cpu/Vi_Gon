// /api/categories: danh mục thu/chi, con 1 cấp, sắp xếp, gộp, xoá có chuyển giao dịch (F06)
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const { toId, COLOR_RE, cleanText } = require('../utils/params');

const router = express.Router();
router.use(authRequired, bookRequired);

const KINDS = ['expense', 'income'];

function publicCategory(c) {
  return {
    id: Number(c.id),
    name: c.name,
    kind: c.kind,
    parent_id: c.parent_id === null ? null : Number(c.parent_id),
    color: c.color,
    icon: c.icon,
    sort_order: c.sort_order,
    tx_count: c.tx_count === undefined ? undefined : Number(c.tx_count)
  };
}

async function getCategory(bookId, id, q = db) {
  if (!id) return null;
  const r = await q.query('SELECT * FROM categories WHERE id = $1 AND book_id = $2', [id, bookId]);
  return r.rows[0] || null;
}

router.get('/', async (req, res, next) => {
  try {
    const kind = req.query.kind;
    if (kind !== undefined && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind không hợp lệ' });
    const r = await db.query(
      `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS tx_count
       FROM categories c
       WHERE c.book_id = $1 AND c.archived_at IS NULL ${kind ? 'AND c.kind = $2' : ''}
       ORDER BY c.kind, c.sort_order, c.id`,
      kind ? [req.bookId, kind] : [req.bookId]
    );
    res.json({ categories: r.rows.map(publicCategory) });
  } catch (e) { next(e); }
});

// Danh mục cha hợp lệ: cùng sổ, cùng loại, bản thân là cấp 1 (chỉ cho 1 cấp con)
async function checkParent(bookId, parentId, kind) {
  if (parentId === null || parentId === undefined) return { parent: null };
  const p = await getCategory(bookId, toId(parentId));
  if (!p) return { error: 'Danh mục cha không tồn tại' };
  if (p.parent_id !== null) return { error: 'Chỉ có 1 cấp danh mục con' };
  if (p.kind !== kind) return { error: 'Danh mục cha phải cùng loại thu/chi' };
  return { parent: p };
}

router.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 40);
    if (!name) return res.status(400).json({ error: 'Tên danh mục từ 1 đến 40 ký tự' });
    if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Loại phải là chi hoặc thu' });
    if ('color' in b && !COLOR_RE.test(String(b.color))) return res.status(400).json({ error: 'Màu không hợp lệ' });
    const icon = cleanText(b.icon, 8);
    if (icon === null) return res.status(400).json({ error: 'Biểu tượng không hợp lệ' });
    const pc = await checkParent(req.bookId, b.parent_id, b.kind);
    if (pc.error) return res.status(400).json({ error: pc.error });
    const parentId = pc.parent ? Number(pc.parent.id) : null;
    const r = await db.query(
      `INSERT INTO categories (book_id, name, kind, parent_id, color, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories
                WHERE book_id = $1 AND kind = $3 AND parent_id IS NOT DISTINCT FROM $4))
       RETURNING *`,
      [req.bookId, name, b.kind, parentId, b.color || (pc.parent ? pc.parent.color : '#9AA79F'), icon]
    );
    res.status(201).json({ category: publicCategory(r.rows[0]) });
  } catch (e) { next(e); }
});

// Sắp xếp: gửi danh sách id theo thứ tự mới (cùng một cấp)
router.post('/reorder', canWrite, async (req, res, next) => {
  try {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(toId) : null;
    if (!ids || !ids.length || ids.some(x => !x) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: 'ids phải là danh sách id không trùng' });
    }
    const r = await db.query(
      `UPDATE categories c SET sort_order = x.ord - 1
       FROM unnest($2::bigint[]) WITH ORDINALITY AS x(id, ord)
       WHERE c.id = x.id AND c.book_id = $1
       RETURNING c.id`,
      [req.bookId, ids]
    );
    if (r.rows.length !== ids.length) return res.status(404).json({ error: 'Có danh mục không tồn tại' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const c = await getCategory(req.bookId, toId(req.params.id));
    if (!c) return res.status(404).json({ error: 'Không tìm thấy danh mục' });
    const b = req.body || {};
    const sets = [];
    const vals = [c.id, req.bookId];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('name' in b) {
      const name = cleanText(b.name, 40);
      if (!name) return res.status(400).json({ error: 'Tên danh mục từ 1 đến 40 ký tự' });
      add('name', name);
    }
    if ('color' in b) {
      if (!COLOR_RE.test(String(b.color))) return res.status(400).json({ error: 'Màu không hợp lệ' });
      add('color', b.color);
    }
    if ('icon' in b) {
      const icon = cleanText(b.icon, 8);
      if (icon === null) return res.status(400).json({ error: 'Biểu tượng không hợp lệ' });
      add('icon', icon);
    }
    if ('parent_id' in b) {
      if (b.parent_id !== null && toId(b.parent_id) === Number(c.id)) return res.status(400).json({ error: 'Không chọn chính nó làm cha' });
      const kids = await db.query('SELECT 1 FROM categories WHERE parent_id = $1 LIMIT 1', [c.id]);
      if (b.parent_id !== null && kids.rows[0]) return res.status(400).json({ error: 'Danh mục đang có mục con nên không thành mục con được' });
      const pc = await checkParent(req.bookId, b.parent_id, c.kind);
      if (pc.error) return res.status(400).json({ error: pc.error });
      add('parent_id', pc.parent ? Number(pc.parent.id) : null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    const r = await db.query(`UPDATE categories SET ${sets.join(', ')} WHERE id = $1 AND book_id = $2 RETURNING *`, vals);
    res.json({ category: publicCategory(r.rows[0]) });
  } catch (e) { next(e); }
});

// Chuyển mọi giao dịch của danh mục `fromIds` sang `toId`, rồi xoá các danh mục đó. 1 transaction SQL.
async function moveAndDelete(client, bookId, fromIds, targetId) {
  if (targetId) {
    await client.query(
      'UPDATE transactions SET category_id = $3, updated_at = NOW() WHERE book_id = $1 AND category_id = ANY($2::bigint[])',
      [bookId, fromIds, targetId]
    );
  }
  await client.query('DELETE FROM categories WHERE book_id = $1 AND id = ANY($2::bigint[])', [bookId, fromIds]);
}

// Gộp: giao dịch của danh mục này chuyển sang danh mục `into`; mục con được đưa sang dưới `into`
// (hoặc dưới cha của `into` nếu `into` là mục con).
router.post('/:id/merge', canWrite, async (req, res, next) => {
  try {
    const src = await getCategory(req.bookId, toId(req.params.id));
    if (!src) return res.status(404).json({ error: 'Không tìm thấy danh mục' });
    const dst = await getCategory(req.bookId, toId((req.body || {}).into));
    if (!dst) return res.status(400).json({ error: 'Chọn danh mục nhận' });
    if (Number(dst.id) === Number(src.id)) return res.status(400).json({ error: 'Không gộp vào chính nó' });
    if (Number(dst.parent_id) === Number(src.id)) return res.status(400).json({ error: 'Không gộp vào mục con của chính nó' });
    if (dst.kind !== src.kind) return res.status(400).json({ error: 'Chỉ gộp được danh mục cùng loại thu/chi' });

    const moved = await db.withTransaction(async (client) => {
      const newParent = dst.parent_id === null ? Number(dst.id) : Number(dst.parent_id);
      await client.query('UPDATE categories SET parent_id = $3 WHERE book_id = $1 AND parent_id = $2', [req.bookId, src.id, newParent]);
      const n = await client.query(
        'UPDATE transactions SET category_id = $3, updated_at = NOW() WHERE book_id = $1 AND category_id = $2',
        [req.bookId, src.id, dst.id]
      );
      await client.query('DELETE FROM categories WHERE book_id = $1 AND id = $2', [req.bookId, src.id]);
      return n.rowCount;
    });
    res.json({ ok: true, moved_transactions: moved, into: Number(dst.id) });
  } catch (e) { next(e); }
});

// Xoá danh mục (và mục con). Đang có giao dịch thì bắt buộc ?move_to=<id> để nhận lại giao dịch.
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const c = await getCategory(req.bookId, toId(req.params.id));
    if (!c) return res.status(404).json({ error: 'Không tìm thấy danh mục' });
    const ids = (await db.query('SELECT id FROM categories WHERE book_id = $1 AND (id = $2 OR parent_id = $2)', [req.bookId, c.id]))
      .rows.map(r => Number(r.id));
    // Chỉ giao dịch chưa xoá mới bắt chọn nơi nhận; giao dịch đã xoá đi theo (nếu có nơi nhận) hoặc mất danh mục
    const used = await db.query(
      'SELECT COUNT(*)::int AS n FROM transactions WHERE book_id = $1 AND category_id = ANY($2::bigint[]) AND deleted_at IS NULL',
      [req.bookId, ids]
    );
    let target = null;
    if (used.rows[0].n > 0) {
      target = await getCategory(req.bookId, toId(req.query.move_to));
      if (!target) return res.status(409).json({ error: 'Danh mục đang có giao dịch. Chọn danh mục nhận lại.', tx_count: used.rows[0].n });
      if (ids.includes(Number(target.id))) return res.status(400).json({ error: 'Danh mục nhận không được là danh mục đang xoá' });
      if (target.kind !== c.kind) return res.status(400).json({ error: 'Danh mục nhận phải cùng loại thu/chi' });
    }
    await db.withTransaction(client => moveAndDelete(client, req.bookId, ids, target ? Number(target.id) : null));
    res.json({ ok: true, deleted: ids, moved_transactions: used.rows[0].n });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.publicCategory = publicCategory;
