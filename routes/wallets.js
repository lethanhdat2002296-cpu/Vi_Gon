// /api/wallets: ví, điều chỉnh số dư, ẩn ví (F05). Mọi truy vấn lọc theo book_id của sổ đang dùng.
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const balance = require('../services/balance');
const { toId, toSignedVnd, COLOR_RE, cleanText } = require('../utils/params');
const { MAX_VND } = require('../utils/money');

const router = express.Router();
router.use(authRequired, bookRequired);

const TYPES = ['cash', 'bank', 'ewallet', 'credit', 'savings'];

function publicWallet(w) {
  return {
    id: Number(w.id),
    name: w.name,
    type: w.type,
    color: w.color,
    opening_balance: Number(w.opening_balance),
    balance: Number(w.balance),
    exclude_from_total: w.exclude_from_total,
    credit_limit: w.credit_limit === null ? null : Number(w.credit_limit),
    due_day: w.due_day,
    sort_order: w.sort_order,
    archived: !!w.archived_at,
    has_transactions: !!w.has_transactions
  };
}

// Kiểm các trường ví; partial = PATCH (chỉ kiểm trường có gửi). Trả { values } hoặc { error }.
function readWallet(b, partial) {
  const v = {};
  if (!partial || 'name' in b) {
    const name = cleanText(b.name, 60);
    if (!name) return { error: 'Tên ví từ 1 đến 60 ký tự' };
    v.name = name;
  }
  if (!partial || 'type' in b) {
    if (!TYPES.includes(b.type)) return { error: 'Loại ví không hợp lệ' };
    v.type = b.type;
  }
  if ('color' in b) {
    if (!COLOR_RE.test(String(b.color))) return { error: 'Màu không hợp lệ' };
    v.color = b.color;
  }
  if (!partial && 'opening_balance' in b) {
    const n = toSignedVnd(b.opening_balance);
    if (n === null) return { error: 'Số dư đầu phải là số nguyên VND' };
    v.opening_balance = n;
  }
  if ('exclude_from_total' in b) {
    if (typeof b.exclude_from_total !== 'boolean') return { error: 'exclude_from_total phải là true/false' };
    v.exclude_from_total = b.exclude_from_total;
  }
  if ('credit_limit' in b) {
    const n = b.credit_limit === null ? null : toSignedVnd(b.credit_limit);
    if (b.credit_limit !== null && (n === null || n < 0)) return { error: 'Hạn mức không hợp lệ' };
    v.credit_limit = n;
  }
  if ('due_day' in b) {
    const d = b.due_day;
    if (d !== null && !(Number.isInteger(d) && d >= 1 && d <= 31)) return { error: 'Ngày đến hạn từ 1 đến 31' };
    v.due_day = d;
  }
  if ('sort_order' in b) {
    if (!Number.isInteger(b.sort_order)) return { error: 'sort_order phải là số nguyên' };
    v.sort_order = b.sort_order;
  }
  return { values: v };
}

async function loadWallet(req, id) {
  const all = await balance.walletsWithBalance(req.bookId, { includeArchived: true });
  return all.find(w => Number(w.id) === id) || null;
}

router.get('/', async (req, res, next) => {
  try {
    const rows = await balance.walletsWithBalance(req.bookId, { includeArchived: req.query.include_archived === '1' });
    res.json({
      wallets: rows.map(publicWallet),
      total: Number(balance.totalBalance(rows))
    });
  } catch (e) { next(e); }
});

router.post('/', canWrite, async (req, res, next) => {
  try {
    const r = readWallet(req.body || {}, false);
    if (r.error) return res.status(400).json({ error: r.error });
    const v = r.values;
    const ins = await db.query(
      `INSERT INTO wallets (book_id, name, type, color, opening_balance, exclude_from_total, credit_limit, due_day, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, '#0D6B5E'), $5, $6, $7, $8,
               COALESCE($9, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM wallets WHERE book_id = $1)))
       RETURNING id`,
      [req.bookId, v.name, v.type, v.color || null, v.opening_balance || 0, !!v.exclude_from_total,
        v.credit_limit === undefined ? null : v.credit_limit, v.due_day === undefined ? null : v.due_day,
        v.sort_order === undefined ? null : v.sort_order]
    );
    res.status(201).json({ wallet: publicWallet(await loadWallet(req, Number(ins.rows[0].id))) });
  } catch (e) { next(e); }
});

router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id || !(await loadWallet(req, id))) return res.status(404).json({ error: 'Không tìm thấy ví' });
    if ('opening_balance' in (req.body || {})) {
      return res.status(400).json({ error: 'Đổi số dư bằng "Điều chỉnh số dư" để giữ lịch sử' });
    }
    const r = readWallet(req.body || {}, true);
    if (r.error) return res.status(400).json({ error: r.error });
    const cols = Object.keys(r.values);
    if (!cols.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    const vals = [id, req.bookId, ...cols.map(c => r.values[c])];
    await db.query(
      `UPDATE wallets SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 AND book_id = $2`,
      vals
    );
    res.json({ wallet: publicWallet(await loadWallet(req, id)) });
  } catch (e) { next(e); }
});

// Điều chỉnh số dư: nhập số dư thật, tạo khoản "Điều chỉnh" bằng phần chênh lệch
router.post('/:id/adjust', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const w = id && await loadWallet(req, id);
    if (!w) return res.status(404).json({ error: 'Không tìm thấy ví' });
    const actual = toSignedVnd((req.body || {}).actual_balance);
    if (actual === null) return res.status(400).json({ error: 'Số dư thực tế phải là số nguyên VND' });
    const diff = actual - Number(w.balance);
    let tx = null;
    if (diff !== 0) {
      if (Math.abs(diff) > MAX_VND) return res.status(400).json({ error: 'Chênh lệch quá lớn' });
      const ins = await db.query(
        `INSERT INTO transactions (book_id, user_id, wallet_id, kind, amount, occurred_at, note, source)
         VALUES ($1, $2, $3, $4, $5, NOW(), 'Điều chỉnh số dư', 'adjust') RETURNING id`,
        [req.bookId, req.user.id, id, diff > 0 ? 'income' : 'expense', Math.abs(diff)]
      );
      tx = { id: Number(ins.rows[0].id), kind: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff) };
    }
    res.json({ wallet: publicWallet(await loadWallet(req, id)), adjustment: tx });
  } catch (e) { next(e); }
});

// Ẩn / hiện lại ví. Ví ẩn không hiện khi nhập giao dịch và không tính vào tổng.
router.post('/:id/archive', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id || !(await loadWallet(req, id))) return res.status(404).json({ error: 'Không tìm thấy ví' });
    const archived = !((req.body || {}).archived === false);
    await db.query(
      `UPDATE wallets SET archived_at = ${archived ? 'COALESCE(archived_at, NOW())' : 'NULL'}, updated_at = NOW()
       WHERE id = $1 AND book_id = $2`,
      [id, req.bookId]
    );
    res.json({ wallet: publicWallet(await loadWallet(req, id)) });
  } catch (e) { next(e); }
});

// Xoá hẳn: chỉ khi ví CHƯA từng có giao dịch (kể cả đã xoá); có rồi thì chỉ ẩn được.
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const r = id && await db.query(
      `DELETE FROM wallets w WHERE w.id = $1 AND w.book_id = $2
         AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.wallet_id = w.id)
         AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.wallet_id = w.id)
         AND NOT EXISTS (SELECT 1 FROM recurring_rules r WHERE r.wallet_id = w.id)
       RETURNING id`,
      [id, req.bookId]
    );
    if (r && r.rows[0]) return res.json({ ok: true });
    if (!id || !(await loadWallet(req, id))) return res.status(404).json({ error: 'Không tìm thấy ví' });
    res.status(409).json({ error: 'Ví đã có giao dịch hoặc đang dùng cho mục tiêu/định kỳ nên chỉ ẩn được, không xoá được.' });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.publicWallet = publicWallet;
