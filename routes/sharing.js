// /api/groups (chia tiền nhóm, F15) + /api/debts (sổ nợ, F16)
// Nhóm luôn thuộc SỔ CÁ NHÂN của người tạo (người trong nhóm chỉ là tên, không cần tài khoản);
// phần của mình ghi vào sổ cá nhân. Sổ nợ thuộc sổ đang dùng (có thể là sổ chung).
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const split = require('../services/split');
const debtsSvc = require('../services/debts');
const { toId, cleanText } = require('../utils/params');
const { parseVnd } = require('../utils/money');
const { validateAmount, validateDate } = require('../utils/validators');
const { resolveOccurredAt, nowInTimezone } = require('../utils/time');
const { helpers } = require('./transactions');

const MODES = ['equal', 'amount', 'ratio'];
const MAX_MEMBERS = 30;
const MAX_EXPENSES = 500;
const BANK_RE = /^[A-Za-z0-9]{2,20}$/;
const ACCOUNT_RE = /^[0-9A-Za-z]{4,30}$/;
const ascii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

const groups = express.Router();
groups.use(authRequired, bookRequired);
const debts = express.Router();
debts.use(authRequired, bookRequired);

// ================= CHIA TIỀN NHÓM =================
async function loadGroup(req, res) {
  const id = toId(req.params.id);
  const r = id && await db.query('SELECT * FROM groups WHERE id = $1 AND book_id = $2', [id, req.personalBookId]);
  if (!r || !r.rows[0]) { res.status(404).json({ error: 'Không tìm thấy nhóm' }); return null; }
  return r.rows[0];
}

// Thông tin ngân hàng để tạo VietQR (tuỳ chọn)
function bankInfo(b) {
  const out = {};
  if ('bank_code' in b) {
    const v = String(b.bank_code || '').trim().replace(/\s+/g, '');
    if (v && !BANK_RE.test(v)) return { error: 'Mã ngân hàng không hợp lệ (vd VCB, TCB, MB)' };
    out.bank_code = v || null;
  }
  if ('account_no' in b) {
    const v = String(b.account_no || '').trim().replace(/[\s.-]/g, '');
    if (v && !ACCOUNT_RE.test(v)) return { error: 'Số tài khoản không hợp lệ' };
    out.account_no = v || null;
  }
  if ('account_name' in b) {
    const v = cleanText(b.account_name === null ? '' : b.account_name, 50);
    if (v === null) return { error: 'Tên chủ tài khoản tối đa 50 ký tự' };
    out.account_name = v ? ascii(v).toUpperCase() : null;
  }
  return out;
}

function memberName(v) {
  const name = cleanText(v, 40);
  return name ? name : null;
}

// Toàn bộ dữ liệu 1 nhóm + số dư từng người + kế hoạch tất toán
async function groupDetail(g) {
  const [mr, er, sr, shr] = await Promise.all([
    db.query('SELECT * FROM group_members WHERE group_id = $1 ORDER BY is_me DESC, id', [g.id]),
    db.query('SELECT id, title, amount::text AS amount, paid_by, split_mode, occurred_on::text AS occurred_on FROM group_expenses WHERE group_id = $1 ORDER BY occurred_on DESC, id DESC', [g.id]),
    db.query('SELECT id, from_member, to_member, amount::text AS amount, paid_at FROM group_settlements WHERE group_id = $1 ORDER BY paid_at DESC, id DESC', [g.id]),
    db.query('SELECT s.expense_id, s.member_id, s.value::text AS value FROM group_expense_shares s JOIN group_expenses e ON e.id = s.expense_id WHERE e.group_id = $1', [g.id])
  ]);
  const members = mr.rows.map(m => ({ ...m, id: Number(m.id) }));
  const byId = {};
  members.forEach(m => { byId[m.id] = m; });
  const sharesOf = {};
  shr.rows.forEach(s => { (sharesOf[s.expense_id] = sharesOf[s.expense_id] || []).push({ member_id: Number(s.member_id), value: Number(s.value) }); });
  const expenses = er.rows.map(e => ({ id: Number(e.id), title: e.title, amount: Number(e.amount), paid_by: Number(e.paid_by), split_mode: e.split_mode, occurred_on: e.occurred_on, shares: sharesOf[e.id] || [] }));
  const settlements = sr.rows.map(s => ({ id: Number(s.id), from_member: Number(s.from_member), to_member: Number(s.to_member), amount: Number(s.amount), paid_at: s.paid_at }));
  const bal = split.balances(members, expenses, settlements);
  const me = members.find(m => m.is_me);
  const plan = split.settle(bal.balance).map(p => {
    const to = byId[p.to];
    return {
      from: p.from, to: p.to, amount: p.amount, from_name: byId[p.from].name, to_name: to.name,
      qr: split.vietQrUrl({ ...to, amount: p.amount, description: ascii(`${g.name} ${byId[p.from].name}`).slice(0, 50) })
    };
  });
  const myShare = me ? (bal.owed[me.id] || 0) : 0;
  return {
    group: { id: Number(g.id), name: g.name, archived: !!g.archived_at, recorded_amount: Number(g.recorded_amount) },
    members: members.map(m => ({
      id: m.id, name: m.name, is_me: m.is_me, bank_code: m.bank_code, account_no: m.account_no, account_name: m.account_name,
      paid: bal.paid[m.id] || 0, owed: bal.owed[m.id] || 0, balance: bal.balance[m.id] || 0
    })),
    expenses: expenses.map(e => ({ ...e, payer_name: byId[e.paid_by].name, split: split.expenseShares(e) })),
    settlements: settlements.map(s => ({ ...s, from_name: byId[s.from_member].name, to_name: byId[s.to_member].name })),
    plan,
    total: expenses.reduce((s, e) => s + e.amount, 0),
    my_share: myShare,
    unrecorded: myShare - Number(g.recorded_amount)
  };
}

groups.get('/', async (req, res, next) => {
  try {
    const r = await db.query('SELECT * FROM groups WHERE book_id = $1 ORDER BY archived_at NULLS FIRST, created_at DESC', [req.personalBookId]);
    const list = [];
    for (const g of r.rows) {
      const d = await groupDetail(g);
      const me = d.members.find(m => m.is_me);
      list.push({ ...d.group, total: d.total, members: d.members.length, my_balance: me ? me.balance : 0, settled: !d.plan.length, open_transfers: d.plan.length });
    }
    res.json({ groups: list });
  } catch (e) { next(e); }
});

// { name, me_name?, members: ['Hà', 'Minh', ...] } — "mình" luôn là người đầu tiên
groups.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    if (!name) return res.status(400).json({ error: 'Nhập tên nhóm / chuyến đi' });
    const others = Array.isArray(b.members) ? b.members.map(memberName) : [];
    if (others.some(x => !x)) return res.status(400).json({ error: 'Tên người tối đa 40 ký tự' });
    const me = memberName(b.me_name) || 'Tôi';
    const names = [me, ...others];
    if (new Set(names.map(x => x.toLowerCase())).size !== names.length) return res.status(400).json({ error: 'Tên người trong nhóm bị trùng' });
    if (names.length > MAX_MEMBERS) return res.status(400).json({ error: `Tối đa ${MAX_MEMBERS} người` });
    const n = await db.query('SELECT COUNT(*)::int AS n FROM groups WHERE book_id = $1', [req.personalBookId]);
    if (n.rows[0].n >= 100) return res.status(400).json({ error: 'Tối đa 100 nhóm' });
    const id = await db.withTransaction(async (client) => {
      const g = await client.query('INSERT INTO groups (book_id, name, created_by) VALUES ($1, $2, $3) RETURNING id', [req.personalBookId, name, req.user.id]);
      const gid = Number(g.rows[0].id);
      await client.query(
        'INSERT INTO group_members (group_id, name, is_me) SELECT $1, x.name, x.ord = 1 FROM unnest($2::text[]) WITH ORDINALITY AS x(name, ord)',
        [gid, names]);
      return gid;
    });
    const g = (await db.query('SELECT * FROM groups WHERE id = $1', [id])).rows[0];
    res.status(201).json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.get('/:id', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (g) res.json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.patch('/:id', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const b = req.body || {};
    if ('name' in b) {
      const name = cleanText(b.name, 60);
      if (!name) return res.status(400).json({ error: 'Nhập tên nhóm / chuyến đi' });
      await db.query('UPDATE groups SET name = $2 WHERE id = $1', [g.id, name]);
    }
    if ('archived' in b) await db.query(`UPDATE groups SET archived_at = ${b.archived ? 'NOW()' : 'NULL'} WHERE id = $1`, [g.id]);
    res.json(await groupDetail((await db.query('SELECT * FROM groups WHERE id = $1', [g.id])).rows[0]));
  } catch (e) { next(e); }
});

groups.delete('/:id', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    await db.query('DELETE FROM groups WHERE id = $1', [g.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

groups.post('/:id/members', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const b = req.body || {};
    const name = memberName(b.name);
    if (!name) return res.status(400).json({ error: 'Nhập tên (tối đa 40 ký tự)' });
    const bank = bankInfo(b);
    if (bank.error) return res.status(400).json({ error: bank.error });
    const cur = await db.query('SELECT name FROM group_members WHERE group_id = $1', [g.id]);
    if (cur.rows.length >= MAX_MEMBERS) return res.status(400).json({ error: `Tối đa ${MAX_MEMBERS} người` });
    if (cur.rows.some(m => m.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Đã có người tên này' });
    await db.query('INSERT INTO group_members (group_id, name, bank_code, account_no, account_name) VALUES ($1, $2, $3, $4, $5)',
      [g.id, name, bank.bank_code || null, bank.account_no || null, bank.account_name || null]);
    res.status(201).json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.patch('/:id/members/:mid', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const b = req.body || {};
    const sets = [], vals = [];
    if ('name' in b) {
      const name = memberName(b.name);
      if (!name) return res.status(400).json({ error: 'Nhập tên (tối đa 40 ký tự)' });
      const dup = await db.query('SELECT 1 FROM group_members WHERE group_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3', [g.id, name, toId(req.params.mid)]);
      if (dup.rows[0]) return res.status(400).json({ error: 'Đã có người tên này' });
      vals.push(name); sets.push(`name = $${vals.length + 2}`);
    }
    const bank = bankInfo(b);
    if (bank.error) return res.status(400).json({ error: bank.error });
    for (const [k, v] of Object.entries(bank)) { vals.push(v); sets.push(`${k} = $${vals.length + 2}`); }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    const r = await db.query(`UPDATE group_members SET ${sets.join(', ')} WHERE group_id = $1 AND id = $2 RETURNING id`, [g.id, toId(req.params.mid), ...vals]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy người này' });
    res.json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.delete('/:id/members/:mid', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const mid = toId(req.params.mid);
    const m = (await db.query('SELECT * FROM group_members WHERE group_id = $1 AND id = $2', [g.id, mid])).rows[0];
    if (!m) return res.status(404).json({ error: 'Không tìm thấy người này' });
    if (m.is_me) return res.status(400).json({ error: 'Không xoá được chính mình khỏi nhóm' });
    const used = await db.query(
      `SELECT 1 FROM group_expenses WHERE paid_by = $1
       UNION ALL SELECT 1 FROM group_expense_shares WHERE member_id = $1
       UNION ALL SELECT 1 FROM group_settlements WHERE from_member = $1 OR to_member = $1 LIMIT 1`, [mid]);
    if (used.rows[0]) return res.status(400).json({ error: 'Người này đã có trong khoản chi, xoá khoản chi trước' });
    await db.query('DELETE FROM group_members WHERE id = $1', [mid]);
    res.json(await groupDetail(g));
  } catch (e) { next(e); }
});

// { title, amount, paid_by, split_mode, shares: [{ member_id, value }], date }
groups.post('/:id/expenses', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const b = req.body || {};
    const title = cleanText(b.title, 80);
    if (!title) return res.status(400).json({ error: 'Nhập nội dung khoản chi' });
    const err = validateAmount(b.amount);
    if (err) return res.status(400).json({ error: err });
    const amount = parseVnd(b.amount);
    if (!MODES.includes(b.split_mode)) return res.status(400).json({ error: 'Cách chia phải là đều, theo số tiền hoặc theo tỉ lệ' });
    const date = b.date || nowInTimezone().date;
    if (validateDate(date)) return res.status(400).json({ error: 'Ngày không hợp lệ' });
    const memberIds = new Set((await db.query('SELECT id FROM group_members WHERE group_id = $1', [g.id])).rows.map(r => Number(r.id)));
    const paidBy = toId(b.paid_by);
    if (!memberIds.has(paidBy)) return res.status(400).json({ error: 'Người trả không có trong nhóm' });
    if (!Array.isArray(b.shares) || !b.shares.length) return res.status(400).json({ error: 'Chọn người cùng chia' });
    const shares = [];
    const seen = new Set();
    for (const s of b.shares) {
      const mid = toId(s && s.member_id);
      if (!memberIds.has(mid) || seen.has(mid)) return res.status(400).json({ error: 'Người cùng chia không hợp lệ' });
      seen.add(mid);
      let value = 1;
      if (b.split_mode === 'amount') {
        value = parseVnd(s.value);
        if (value === null) return res.status(400).json({ error: 'Số tiền từng người không hợp lệ' });
      } else if (b.split_mode === 'ratio') {
        value = Number(s.value);
        if (!Number.isInteger(value) || value < 0 || value > 1000) return res.status(400).json({ error: 'Tỉ lệ là số nguyên từ 0 đến 1000' });
      }
      shares.push({ member_id: mid, value });
    }
    try {
      split.expenseShares({ amount, paid_by: paidBy, split_mode: b.split_mode, shares });
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM group_expenses WHERE group_id = $1', [g.id]);
    if (cnt.rows[0].n >= MAX_EXPENSES) return res.status(400).json({ error: `Tối đa ${MAX_EXPENSES} khoản mỗi nhóm` });
    await db.withTransaction(async (client) => {
      const e = await client.query(
        'INSERT INTO group_expenses (group_id, title, amount, paid_by, split_mode, occurred_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [g.id, title, amount, paidBy, b.split_mode, date]);
      await client.query(
        'INSERT INTO group_expense_shares (expense_id, member_id, value) SELECT $1, * FROM unnest($2::bigint[], $3::bigint[])',
        [e.rows[0].id, shares.map(s => s.member_id), shares.map(s => s.value)]);
    });
    res.status(201).json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.delete('/:id/expenses/:eid', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const r = await db.query('DELETE FROM group_expenses WHERE group_id = $1 AND id = $2 RETURNING id', [g.id, toId(req.params.eid)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy khoản chi' });
    res.json(await groupDetail(g));
  } catch (e) { next(e); }
});

// Đánh dấu đã trả: { from_member, to_member, amount }
groups.post('/:id/settlements', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const b = req.body || {};
    const err = validateAmount(b.amount);
    if (err) return res.status(400).json({ error: err });
    const from = toId(b.from_member), to = toId(b.to_member);
    const ok = await db.query('SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1 AND id = ANY($2::bigint[])', [g.id, [from, to]]);
    if (!from || !to || from === to || ok.rows[0].n !== 2) return res.status(400).json({ error: 'Người trả / người nhận không hợp lệ' });
    await db.query('INSERT INTO group_settlements (group_id, from_member, to_member, amount) VALUES ($1, $2, $3, $4)', [g.id, from, to, parseVnd(b.amount)]);
    res.status(201).json(await groupDetail(g));
  } catch (e) { next(e); }
});

groups.delete('/:id/settlements/:sid', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const r = await db.query('DELETE FROM group_settlements WHERE group_id = $1 AND id = $2 RETURNING id', [g.id, toId(req.params.sid)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy lần trả' });
    res.json(await groupDetail(g));
  } catch (e) { next(e); }
});

// Ghi phần của mình (phần chưa ghi) vào sổ cá nhân: { wallet_id, category_id? }
groups.post('/:id/record', async (req, res, next) => {
  try {
    const g = await loadGroup(req, res);
    if (!g) return;
    const d = await groupDetail(g);
    if (d.unrecorded <= 0) return res.status(400).json({ error: 'Phần của bạn đã ghi vào sổ rồi' });
    const b = req.body || {};
    const w = await helpers.usableWallet(req.personalBookId, toId(b.wallet_id));
    if (!w) return res.status(400).json({ error: 'Chọn ví trong sổ của tôi' });
    let catId = null;
    if (b.category_id !== undefined && b.category_id !== null && b.category_id !== '') {
      const c = await helpers.usableCategory(req.personalBookId, toId(b.category_id), 'expense');
      if (!c) return res.status(400).json({ error: 'Danh mục không hợp lệ' });
      catId = Number(c.id);
    }
    const tx = await db.withTransaction(async (client) => {
      // Khoá nhóm để 2 lần bấm cùng lúc không ghi 2 lần
      const cur = await client.query('SELECT recorded_amount FROM groups WHERE id = $1 FOR UPDATE', [g.id]);
      const amount = d.my_share - Number(cur.rows[0].recorded_amount);
      if (amount <= 0) return null;
      const ins = await client.query(
        `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source)
         VALUES ($1, $2, $3, $4, 'expense', $5, NOW(), $6, 'manual') RETURNING id`,
        [req.personalBookId, req.user.id, w.id, catId, amount, `Chia tiền: ${g.name}`.slice(0, 200)]);
      await client.query('UPDATE groups SET recorded_amount = recorded_amount + $2 WHERE id = $1', [g.id, amount]);
      return { id: Number(ins.rows[0].id), amount };
    });
    if (!tx) return res.status(400).json({ error: 'Phần của bạn đã ghi vào sổ rồi' });
    const fresh = (await db.query('SELECT * FROM groups WHERE id = $1', [g.id])).rows[0];
    res.status(201).json({ transaction_id: tx.id, amount: tx.amount, ...(await groupDetail(fresh)) });
  } catch (e) { next(e); }
});

// ================= SỔ NỢ =================
function publicDebt(d, today, payments) {
  return {
    id: Number(d.id), direction: d.direction, person: d.person, amount: Number(d.amount),
    wallet_id: d.wallet_id ? Number(d.wallet_id) : null, start_date: d.start_date, due_date: d.due_date, note: d.note,
    ...debtsSvc.debtStatus(d, today),
    payments
  };
}

async function loadDebt(req, res) {
  const id = toId(req.params.id);
  const r = id && await db.query(`${debtsSvc.SELECT_DEBTS} WHERE d.id = $1 AND d.book_id = $2`, [id, req.bookId]);
  if (!r || !r.rows[0]) { res.status(404).json({ error: 'Không tìm thấy khoản nợ' }); return null; }
  return r.rows[0];
}

async function paymentsOf(ids) {
  if (!ids.length) return {};
  const r = await db.query(
    'SELECT id, debt_id, amount::text AS amount, paid_on::text AS paid_on, wallet_id FROM debt_payments WHERE debt_id = ANY($1::bigint[]) ORDER BY paid_on, id', [ids]);
  const out = {};
  r.rows.forEach(p => { (out[p.debt_id] = out[p.debt_id] || []).push({ id: Number(p.id), amount: Number(p.amount), paid_on: p.paid_on, wallet_id: p.wallet_id ? Number(p.wallet_id) : null }); });
  return out;
}

// Giao dịch nguồn 'debt': cho mượn / trả nợ = tiền ra; đi vay / được trả = tiền vào
async function debtTx(client, req, walletId, kind, amount, date, note) {
  const when = resolveOccurredAt({ date });
  const r = await client.query(
    `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'debt') RETURNING id`,
    [req.bookId, req.user.id, walletId, kind, amount, when.at, note.slice(0, 200)]);
  return Number(r.rows[0].id);
}

debts.get('/', async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    const rows = await debtsSvc.listDebts(req.bookId);
    const pays = await paymentsOf(rows.map(d => d.id));
    const list = rows.map(d => publicDebt(d, today, pays[d.id] || []));
    // Còn nợ trước (quá hạn lên đầu), đã xong xuống cuối
    list.sort((a, b) => (a.closed - b.closed) || (b.overdue_days - a.overdue_days) || 0);
    res.json({ debts: list, totals: await debtsSvc.totals(req.bookId, today) });
  } catch (e) { next(e); }
});

// { direction: lend|borrow, person, amount, date?, due_date?, note?, wallet_id? }
debts.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!['lend', 'borrow'].includes(b.direction)) return res.status(400).json({ error: 'Chọn cho mượn hoặc đi vay' });
    const person = cleanText(b.person, 60);
    if (!person) return res.status(400).json({ error: 'Nhập tên người (tối đa 60 ký tự)' });
    const err = validateAmount(b.amount);
    if (err) return res.status(400).json({ error: err });
    const amount = parseVnd(b.amount);
    const today = nowInTimezone().date;
    const date = b.date || today;
    const when = resolveOccurredAt({ date });
    if (when.error) return res.status(400).json({ error: when.error });
    const due = b.due_date || null;
    if (due && (validateDate(due) || due < date)) return res.status(400).json({ error: 'Hạn trả phải là ngày hợp lệ, sau ngày mượn' });
    const note = cleanText(b.note, 200);
    if (note === null) return res.status(400).json({ error: 'Ghi chú tối đa 200 ký tự' });
    let wallet = null;
    if (b.wallet_id !== undefined && b.wallet_id !== null && b.wallet_id !== '') {
      wallet = await helpers.usableWallet(req.bookId, toId(b.wallet_id));
      if (!wallet) return res.status(400).json({ error: 'Ví không hợp lệ' });
    }
    const id = await db.withTransaction(async (client) => {
      const txId = wallet ? await debtTx(client, req, wallet.id, b.direction === 'lend' ? 'expense' : 'income', amount, date,
        b.direction === 'lend' ? `Cho ${person} mượn` : `Vay ${person}`) : null;
      const r = await client.query(
        `INSERT INTO debts (book_id, user_id, direction, person, amount, wallet_id, transaction_id, start_date, due_date, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [req.bookId, req.user.id, b.direction, person, amount, wallet ? wallet.id : null, txId, date, due, note]);
      return Number(r.rows[0].id);
    });
    req.params.id = String(id);
    const d = await loadDebt(req, res);
    res.status(201).json({ debt: publicDebt(d, today, []) });
  } catch (e) { next(e); }
});

// Sửa thông tin (người, hạn, ghi chú). Số tiền/ví: xoá rồi ghi lại.
debts.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const d = await loadDebt(req, res);
    if (!d) return;
    const b = req.body || {};
    const sets = [], vals = [];
    if ('person' in b) {
      const person = cleanText(b.person, 60);
      if (!person) return res.status(400).json({ error: 'Nhập tên người (tối đa 60 ký tự)' });
      vals.push(person); sets.push(`person = $${vals.length + 1}`);
    }
    if ('due_date' in b) {
      const due = b.due_date || null;
      if (due && (validateDate(due) || due < d.start_date)) return res.status(400).json({ error: 'Hạn trả phải là ngày hợp lệ, sau ngày mượn' });
      vals.push(due); sets.push(`due_date = $${vals.length + 1}`);
      // Đổi hạn thì nhắc lại theo hạn mới
      await db.query('DELETE FROM debt_reminders WHERE debt_id = $1', [d.id]);
    }
    if ('note' in b) {
      const note = cleanText(b.note, 200);
      if (note === null) return res.status(400).json({ error: 'Ghi chú tối đa 200 ký tự' });
      vals.push(note); sets.push(`note = $${vals.length + 1}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    await db.query(`UPDATE debts SET ${sets.join(', ')} WHERE id = $1`, [d.id, ...vals]);
    const fresh = await loadDebt(req, res);
    res.json({ debt: publicDebt(fresh, nowInTimezone().date, (await paymentsOf([d.id]))[d.id] || []) });
  } catch (e) { next(e); }
});

// Xoá khoản nợ: xoá luôn các giao dịch ví đã ghi (số dư ví trở lại như trước)
debts.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const d = await loadDebt(req, res);
    if (!d) return;
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE transactions SET deleted_at = NOW(), updated_at = NOW()
         WHERE book_id = $1 AND source = 'debt' AND deleted_at IS NULL AND id IN (
           SELECT transaction_id FROM debts WHERE id = $2 UNION SELECT transaction_id FROM debt_payments WHERE debt_id = $2)`,
        [req.bookId, d.id]);
      await client.query('DELETE FROM debts WHERE id = $1', [d.id]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Trả từng phần: { amount, date?, wallet_id? } — không vượt số còn lại
debts.post('/:id/payments', canWrite, async (req, res, next) => {
  try {
    const d = await loadDebt(req, res);
    if (!d) return;
    const b = req.body || {};
    const err = validateAmount(b.amount);
    if (err) return res.status(400).json({ error: err });
    const amount = parseVnd(b.amount);
    const date = b.date || nowInTimezone().date;
    const when = resolveOccurredAt({ date });
    if (when.error) return res.status(400).json({ error: when.error });
    if (date < d.start_date) return res.status(400).json({ error: 'Ngày trả phải sau ngày mượn' });
    let wallet = null;
    if (b.wallet_id !== undefined && b.wallet_id !== null && b.wallet_id !== '') {
      wallet = await helpers.usableWallet(req.bookId, toId(b.wallet_id));
      if (!wallet) return res.status(400).json({ error: 'Ví không hợp lệ' });
    }
    const result = await db.withTransaction(async (client) => {
      // Khoá khoản nợ: 2 lần trả cùng lúc không vượt số còn lại
      const cur = await client.query(
        `SELECT d.amount - COALESCE((SELECT SUM(amount) FROM debt_payments WHERE debt_id = d.id), 0) AS remaining
         FROM debts d WHERE d.id = $1 FOR UPDATE`, [d.id]);
      const remaining = Number(cur.rows[0].remaining);
      if (amount > remaining) return { error: `Còn lại ${remaining.toLocaleString('vi-VN')} ₫, không trả quá số này` };
      const txId = wallet ? await debtTx(client, req, wallet.id, d.direction === 'lend' ? 'income' : 'expense', amount, date,
        d.direction === 'lend' ? `${d.person} trả nợ` : `Trả nợ ${d.person}`) : null;
      await client.query('INSERT INTO debt_payments (debt_id, amount, paid_on, wallet_id, transaction_id) VALUES ($1, $2, $3, $4, $5)',
        [d.id, amount, date, wallet ? wallet.id : null, txId]);
      if (amount === remaining) await client.query('UPDATE debts SET closed_at = NOW() WHERE id = $1', [d.id]);
      return { ok: true };
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const fresh = await loadDebt(req, res);
    res.status(201).json({ debt: publicDebt(fresh, nowInTimezone().date, (await paymentsOf([d.id]))[d.id] || []) });
  } catch (e) { next(e); }
});

debts.delete('/:id/payments/:pid', canWrite, async (req, res, next) => {
  try {
    const d = await loadDebt(req, res);
    if (!d) return;
    const ok = await db.withTransaction(async (client) => {
      const p = await client.query('DELETE FROM debt_payments WHERE debt_id = $1 AND id = $2 RETURNING transaction_id', [d.id, toId(req.params.pid)]);
      if (!p.rows[0]) return false;
      if (p.rows[0].transaction_id) {
        await client.query("UPDATE transactions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND book_id = $2 AND source = 'debt'", [p.rows[0].transaction_id, req.bookId]);
      }
      await client.query('UPDATE debts SET closed_at = NULL WHERE id = $1', [d.id]);
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy lần trả' });
    const fresh = await loadDebt(req, res);
    res.json({ debt: publicDebt(fresh, nowInTimezone().date, (await paymentsOf([d.id]))[d.id] || []) });
  } catch (e) { next(e); }
});

module.exports = { groups, debts };
