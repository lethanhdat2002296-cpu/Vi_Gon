// /api/transactions + /api/transfers: ghi chi/thu, chuyển giữa ví, sửa, xoá mềm, hoàn tác (F03, F05)
const crypto = require('crypto');
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const balance = require('../services/balance');
const { toId, cleanText } = require('../utils/params');
const { parseVnd } = require('../utils/money');
const { validateAmount } = require('../utils/validators');
const { resolveOccurredAt } = require('../utils/time');

const router = express.Router();
router.use(authRequired, bookRequired);

const KINDS = ['expense', 'income'];
const PAGE = 50;

function publicTx(t) {
  return {
    id: Number(t.id),
    wallet_id: Number(t.wallet_id),
    category_id: t.category_id === null ? null : Number(t.category_id),
    kind: t.kind,
    amount: Number(t.amount),
    occurred_at: t.occurred_at,
    note: t.note,
    source: t.source,
    transfer_group: t.transfer_group,
    deleted: !!t.deleted_at,
    // Thông tin hiển thị (JOIN)
    wallet_name: t.wallet_name,
    category_name: t.category_name === undefined ? undefined : t.category_name,
    category_icon: t.category_icon === undefined ? undefined : t.category_icon,
    category_color: t.category_color === undefined ? undefined : t.category_color,
    counterpart_wallet_id: t.counterpart_wallet_id ? Number(t.counterpart_wallet_id) : null,
    counterpart_wallet_name: t.counterpart_wallet_name || null
  };
}

const SELECT_TX = `
  SELECT t.*, w.name AS wallet_name, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         o.wallet_id AS counterpart_wallet_id, ow.name AS counterpart_wallet_name
  FROM transactions t
  JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN transactions o ON t.transfer_group IS NOT NULL AND o.transfer_group = t.transfer_group AND o.id <> t.id
  LEFT JOIN wallets ow ON ow.id = o.wallet_id`;

async function getTx(bookId, id) {
  if (!id) return null;
  const r = await db.query(`${SELECT_TX} WHERE t.id = $1 AND t.book_id = $2`, [id, bookId]);
  return r.rows[0] || null;
}

// Ví dùng được để ghi: thuộc sổ, chưa ẩn
async function usableWallet(bookId, id) {
  if (!id) return null;
  const r = await db.query('SELECT * FROM wallets WHERE id = $1 AND book_id = $2 AND archived_at IS NULL', [id, bookId]);
  return r.rows[0] || null;
}

async function usableCategory(bookId, id, kind) {
  if (!id) return null;
  const r = await db.query('SELECT * FROM categories WHERE id = $1 AND book_id = $2 AND kind = $3 AND archived_at IS NULL', [id, bookId, kind]);
  return r.rows[0] || null;
}

// Cảnh báo chi vượt số dư (vẫn cho lưu). Thẻ tín dụng thì số âm là bình thường.
async function overdraftWarning(wallet) {
  if (wallet.type === 'credit') return null;
  const bal = await balance.walletBalance(wallet.id);
  return bal !== null && bal < 0n ? `Ví "${wallet.name}" đang âm ${(-bal).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫` : null;
}

// ============ DANH SÁCH (mới nhất trước, phân trang theo con trỏ) ============
// Bộ lọc đầy đủ của Sổ (F04) sẽ thêm ở Bước 4.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE, 1), PAGE);
    const vals = [req.bookId];
    let where = 't.book_id = $1 AND t.deleted_at IS NULL';
    const walletId = toId(req.query.wallet);
    if (walletId) { vals.push(walletId); where += ` AND t.wallet_id = $${vals.length}`; }
    // Con trỏ "occurred_at|id" của dòng cuối trang trước
    if (req.query.cursor) {
      const [at, id] = String(req.query.cursor).split('|');
      if (isNaN(new Date(at)) || !toId(id)) return res.status(400).json({ error: 'cursor không hợp lệ' });
      vals.push(new Date(at), toId(id));
      where += ` AND (t.occurred_at, t.id) < ($${vals.length - 1}, $${vals.length})`;
    }
    vals.push(limit + 1);
    const r = await db.query(`${SELECT_TX} WHERE ${where} ORDER BY t.occurred_at DESC, t.id DESC LIMIT $${vals.length}`, vals);
    const rows = r.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    res.json({
      transactions: rows.map(publicTx),
      next_cursor: r.rows.length > limit ? `${new Date(last.occurred_at).toISOString()}|${last.id}` : null
    });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const t = await getTx(req.bookId, toId(req.params.id));
    if (!t) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    res.json({ transaction: publicTx(t) });
  } catch (e) { next(e); }
});

// ============ GHI CHI / THU ============
router.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Loại phải là chi hoặc thu' });
    const amtErr = validateAmount(b.amount);
    if (amtErr) return res.status(400).json({ error: amtErr });
    const wallet = await usableWallet(req.bookId, toId(b.wallet_id));
    if (!wallet) return res.status(400).json({ error: 'Chọn ví' });
    let categoryId = null;
    if (b.category_id !== undefined && b.category_id !== null) {
      const c = await usableCategory(req.bookId, toId(b.category_id), b.kind);
      if (!c) return res.status(400).json({ error: 'Danh mục không hợp lệ' });
      categoryId = Number(c.id);
    }
    const note = cleanText(b.note, 200);
    if (note === null) return res.status(400).json({ error: 'Ghi chú tối đa 200 ký tự' });
    const when = resolveOccurredAt(b);
    if (when.error) return res.status(400).json({ error: when.error });

    const ins = await db.query(
      `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual') RETURNING id`,
      [req.bookId, req.user.id, wallet.id, categoryId, b.kind, parseVnd(b.amount), when.at, note]
    );
    const warning = b.kind === 'expense' ? await overdraftWarning(wallet) : null;
    res.status(201).json({ transaction: publicTx(await getTx(req.bookId, Number(ins.rows[0].id))), warning });
  } catch (e) { next(e); }
});

// ============ SỬA ============
// Chuyển tiền: sửa số tiền/thời điểm/ghi chú áp cho cả 2 bút toán; không đổi ví (xoá rồi tạo lại).
router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const t = await getTx(req.bookId, toId(req.params.id));
    if (!t || t.deleted_at) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 2}`); };
    const isTransfer = !!t.transfer_group;

    if ('amount' in b) {
      if (t.source === 'bank') return res.status(400).json({ error: 'Không sửa số tiền của giao dịch tự động' });
      const err = validateAmount(b.amount);
      if (err) return res.status(400).json({ error: err });
      add('amount', parseVnd(b.amount));
    }
    if ('note' in b) {
      const note = cleanText(b.note, 200);
      if (note === null) return res.status(400).json({ error: 'Ghi chú tối đa 200 ký tự' });
      add('note', note);
    }
    if ('occurred_at' in b || 'date' in b) {
      const when = resolveOccurredAt(b);
      if (when.error) return res.status(400).json({ error: when.error });
      add('occurred_at', when.at);
    }
    if (!isTransfer && ('kind' in b || 'category_id' in b)) {
      const kind = 'kind' in b ? b.kind : t.kind;
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Loại phải là chi hoặc thu' });
      const catId = 'category_id' in b ? b.category_id : (kind === t.kind ? t.category_id : null);
      let c = null;
      if (catId !== null && catId !== undefined) {
        c = await usableCategory(req.bookId, toId(catId), kind);
        if (!c) return res.status(400).json({ error: 'Danh mục không hợp lệ' });
      }
      if (kind !== t.kind) add('kind', kind);
      add('category_id', c ? Number(c.id) : null);
    }
    if (!isTransfer && 'wallet_id' in b) {
      const w = await usableWallet(req.bookId, toId(b.wallet_id));
      if (!w) return res.status(400).json({ error: 'Ví không hợp lệ' });
      add('wallet_id', Number(w.id));
    }
    if (isTransfer && ('kind' in b || 'category_id' in b || 'wallet_id' in b)) {
      return res.status(400).json({ error: 'Chuyển tiền chỉ sửa được số tiền, ngày và ghi chú' });
    }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });

    // $1 = book, $2 = id hoặc transfer_group
    const target = isTransfer ? 'transfer_group = $2' : 'id = $2';
    await db.query(
      `UPDATE transactions SET ${sets.join(', ')}, updated_at = NOW() WHERE book_id = $1 AND ${target} AND deleted_at IS NULL`,
      [req.bookId, isTransfer ? t.transfer_group : t.id, ...vals]
    );
    res.json({ transaction: publicTx(await getTx(req.bookId, Number(t.id))) });
  } catch (e) { next(e); }
});

// ============ XOÁ (mềm) + HOÀN TÁC ============
// Xoá một bút toán chuyển tiền là xoá cả cặp.
async function setDeleted(req, res, next, deleted) {
  try {
    const t = await getTx(req.bookId, toId(req.params.id));
    if (!t) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    const target = t.transfer_group ? 'transfer_group = $2' : 'id = $2';
    const r = await db.query(
      `UPDATE transactions SET deleted_at = ${deleted ? 'NOW()' : 'NULL'}, updated_at = NOW()
       WHERE book_id = $1 AND ${target} AND deleted_at IS ${deleted ? 'NULL' : 'NOT NULL'}
       RETURNING id`,
      [req.bookId, t.transfer_group || t.id]
    );
    res.json({ ok: true, ids: r.rows.map(x => Number(x.id)) });
  } catch (e) { next(e); }
}
router.delete('/:id', canWrite, (req, res, next) => setDeleted(req, res, next, true));
router.post('/:id/restore', canWrite, (req, res, next) => setDeleted(req, res, next, false));

// ============ CHUYỂN GIỮA VÍ ============
// 2 bút toán cùng transfer_group (chi ở ví nguồn, thu ở ví đích), ghi trong 1 transaction SQL.
const transfers = express.Router();
transfers.use(authRequired, bookRequired);
transfers.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const amtErr = validateAmount(b.amount);
    if (amtErr) return res.status(400).json({ error: amtErr });
    const fromId = toId(b.from_wallet_id);
    const toWalletId = toId(b.to_wallet_id);
    if (fromId && fromId === toWalletId) return res.status(400).json({ error: 'Ví nguồn và ví đích phải khác nhau' });
    const from = await usableWallet(req.bookId, fromId);
    const to = await usableWallet(req.bookId, toWalletId);
    if (!from || !to) return res.status(400).json({ error: 'Chọn ví nguồn và ví đích' });
    const note = cleanText(b.note, 200);
    if (note === null) return res.status(400).json({ error: 'Ghi chú tối đa 200 ký tự' });
    const when = resolveOccurredAt(b);
    if (when.error) return res.status(400).json({ error: when.error });

    const group = crypto.randomUUID();
    const amount = parseVnd(b.amount);
    const ids = await db.withTransaction(async (client) => {
      const out = [];
      for (const [walletId, kind] of [[from.id, 'expense'], [to.id, 'income']]) {
        const r = await client.query(
          `INSERT INTO transactions (book_id, user_id, wallet_id, kind, amount, occurred_at, note, source, transfer_group)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'transfer', $8) RETURNING id`,
          [req.bookId, req.user.id, walletId, kind, amount, when.at, note, group]
        );
        out.push(Number(r.rows[0].id));
      }
      return out;
    });
    res.status(201).json({
      transfer_group: group,
      transactions: [publicTx(await getTx(req.bookId, ids[0])), publicTx(await getTx(req.bookId, ids[1]))],
      warning: await overdraftWarning(from)
    });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.transfers = transfers;
