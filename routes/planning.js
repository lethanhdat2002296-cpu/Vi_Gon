// Kế hoạch: /api/budgets (F09), /api/goals (F10), /api/recurring (F11). Mọi truy vấn lọc theo book_id.
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const balance = require('../services/balance');
const planning = require('../services/planning');
const recurring = require('../services/recurring');
const { buildFilter, monthBounds } = require('../services/filters');
const { toId, cleanText } = require('../utils/params');
const { parseVnd } = require('../utils/money');
const { validateAmount } = require('../utils/validators');
const { currentMonth, addMonths, nowInTimezone, resolveOccurredAt } = require('../utils/time');
const { helpers: tx, publicTx } = require('./transactions');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Ngày có thật (chặn 30/02, 31/04…)
function realDate(d) {
  if (!DATE_RE.test(String(d || ''))) return false;
  const x = new Date(`${d}T12:00:00Z`);
  return !isNaN(x) && x.toISOString().slice(0, 10) === d;
}
const n = v => Number(v || 0);
const todayVN = () => nowInTimezone().date;

// Chi theo từng danh mục trong 1 tháng (không tính chuyển tiền, điều chỉnh) → { [category_id|'none']: số tiền }
async function spendByCategory(bookId, month) {
  const f = buildFilter(bookId, { ...monthBounds(month), kind: 'expense' }, { forReport: true });
  const r = await db.query(
    `SELECT t.category_id, SUM(t.amount)::text AS amount
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${f.where.join(' AND ')} GROUP BY 1`,
    f.vals
  );
  const out = {};
  r.rows.forEach(x => { out[x.category_id || 'none'] = n(x.amount); });
  return out;
}

// Đã chi của 1 ngân sách: danh mục + mục con; ngân sách tổng = mọi khoản chi
function spentFor(budget, spend, children) {
  if (!budget.category_id) return Object.values(spend).reduce((s, x) => s + x, 0);
  const ids = [String(budget.category_id)].concat(children[budget.category_id] || []);
  return ids.reduce((s, id) => s + (spend[id] || 0), 0);
}

// Trạng thái mọi ngân sách của 1 tháng (dùng cho API, Tổng quan, cron nhắc)
async function budgetsStatus(bookId, month) {
  const b = await db.query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.book_id = $1 AND b.start_month <= $2
     ORDER BY (b.category_id IS NOT NULL), c.sort_order, b.id`,
    [bookId, month]
  );
  if (!b.rows.length) return [];
  const cats = await db.query('SELECT id, parent_id FROM categories WHERE book_id = $1 AND parent_id IS NOT NULL', [bookId]);
  const children = {};
  cats.rows.forEach(c => { (children[c.parent_id] = children[c.parent_id] || []).push(String(c.id)); });
  const spend = await spendByCategory(bookId, month);
  const prevMonth = addMonths(month, -1);
  const needPrev = b.rows.some(x => x.rollover && x.start_month <= prevMonth);
  const prevSpend = needPrev ? await spendByCategory(bookId, prevMonth) : {};
  const today = todayVN();
  return b.rows.map(x => {
    const amount = n(x.amount);
    const carry = x.rollover && x.start_month <= prevMonth ? planning.carryOver(amount, spentFor(x, prevSpend, children)) : 0;
    const st = planning.budgetStatus({ limit: amount + carry, spent: spentFor(x, spend, children) }, month, today);
    return {
      id: Number(x.id),
      category_id: x.category_id === null ? null : Number(x.category_id),
      name: x.category_id ? x.category_name : 'Tổng chi tiêu',
      icon: x.category_id ? x.category_icon : '',
      color: x.category_id ? x.category_color : '#0D6B5E',
      amount, rollover: x.rollover, carry, start_month: x.start_month,
      ...st
    };
  });
}

// ============ NGÂN SÁCH ============
const budgets = express.Router();
budgets.use(authRequired, bookRequired);

budgets.get('/status', async (req, res, next) => {
  try {
    const month = req.query.month || currentMonth();
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Tháng không hợp lệ' });
    const list = await budgetsStatus(req.bookId, month);
    const [y, m] = month.split('-').map(Number);
    const today = todayVN();
    res.json({
      month, is_current: month === currentMonth(),
      days_left: month === currentMonth() ? planning.lastDayOfMonth(y, m) - Number(today.slice(8)) + 1 : null,
      budgets: list
    });
  } catch (e) { next(e); }
});

// Gợi ý hạn mức = trung bình chi 3 tháng trước (gồm mục con)
budgets.get('/suggest', async (req, res, next) => {
  try {
    const cat = req.query.category_id ? toId(req.query.category_id) : null;
    if (req.query.category_id && !cat) return res.status(400).json({ error: 'Danh mục không hợp lệ' });
    const months = [1, 2, 3].map(k => addMonths(currentMonth(), -k));
    const cats = await db.query('SELECT id, parent_id FROM categories WHERE book_id = $1 AND parent_id IS NOT NULL', [req.bookId]);
    const children = {};
    cats.rows.forEach(c => { (children[c.parent_id] = children[c.parent_id] || []).push(String(c.id)); });
    const spends = [];
    for (const m of months) spends.push(spentFor({ category_id: cat }, await spendByCategory(req.bookId, m), children));
    res.json({ months, spends, suggested: planning.suggestLimit(spends) });
  } catch (e) { next(e); }
});

async function readBudget(req, b, partial) {
  const v = {};
  if (!partial) {
    if (b.category_id !== null && b.category_id !== undefined) {
      const c = await db.query("SELECT id FROM categories WHERE id = $1 AND book_id = $2 AND kind = 'expense'", [toId(b.category_id), req.bookId]);
      if (!c.rows[0]) return { error: 'Chọn danh mục chi' };
      v.category_id = Number(c.rows[0].id);
    } else v.category_id = null;
  }
  if (!partial || 'amount' in b) {
    const err = validateAmount(b.amount);
    if (err) return { error: err };
    v.amount = parseVnd(b.amount);
  }
  if ('rollover' in b) {
    if (typeof b.rollover !== 'boolean') return { error: 'rollover phải là true/false' };
    v.rollover = b.rollover;
  }
  return { values: v };
}

budgets.post('/', canWrite, async (req, res, next) => {
  try {
    const r = await readBudget(req, req.body || {}, false);
    if (r.error) return res.status(400).json({ error: r.error });
    const ins = await db.query(
      `INSERT INTO budgets (book_id, category_id, amount, rollover, start_month) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (book_id, COALESCE(category_id, 0)) DO NOTHING RETURNING id`,
      [req.bookId, r.values.category_id, r.values.amount, !!r.values.rollover, currentMonth()]
    );
    if (!ins.rows[0]) return res.status(409).json({ error: 'Danh mục này đã có ngân sách, hãy sửa ngân sách đang có' });
    const list = await budgetsStatus(req.bookId, currentMonth());
    res.status(201).json({ budget: list.find(x => x.id === Number(ins.rows[0].id)) });
  } catch (e) { next(e); }
});

budgets.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const r = await readBudget(req, req.body || {}, true);
    if (r.error) return res.status(400).json({ error: r.error });
    const cols = Object.keys(r.values);
    if (!cols.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    const u = await db.query(
      `UPDATE budgets SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW() WHERE id = $1 AND book_id = $2 RETURNING id`,
      [id, req.bookId, ...cols.map(c => r.values[c])]
    );
    if (!u.rows[0]) return res.status(404).json({ error: 'Không tìm thấy ngân sách' });
    const list = await budgetsStatus(req.bookId, currentMonth());
    res.json({ budget: list.find(x => x.id === id) });
  } catch (e) { next(e); }
});

budgets.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM budgets WHERE id = $1 AND book_id = $2 RETURNING id', [toId(req.params.id), req.bookId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy ngân sách' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============ MỤC TIÊU ============
const goals = express.Router();
goals.use(authRequired, bookRequired);

async function goalsList(bookId, includeArchived) {
  const r = await db.query(
    `SELECT g.*, w.name AS wallet_name, w.archived_at AS wallet_archived FROM goals g JOIN wallets w ON w.id = g.wallet_id
     WHERE g.book_id = $1 ${includeArchived ? '' : 'AND g.archived_at IS NULL'} ORDER BY g.archived_at NULLS FIRST, g.deadline_month, g.id`,
    [bookId]
  );
  const month = currentMonth();
  const out = [];
  for (const g of r.rows) {
    const saved = Number(await balance.walletBalance(g.wallet_id));
    out.push({
      id: Number(g.id), name: g.name, target_amount: n(g.target_amount), deadline_month: g.deadline_month,
      wallet_id: Number(g.wallet_id), wallet_name: g.wallet_name, start_month: g.start_month, saved,
      archived: !!g.archived_at,
      ...planning.goalStatus({ target: n(g.target_amount), saved, startMonth: g.start_month, startAmount: n(g.start_amount), deadline: g.deadline_month }, month)
    });
  }
  return out;
}

goals.get('/', async (req, res, next) => {
  try { res.json({ goals: await goalsList(req.bookId, req.query.include_archived === '1') }); } catch (e) { next(e); }
});

goals.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    if (!name) return res.status(400).json({ error: 'Tên mục tiêu từ 1 đến 60 ký tự' });
    const err = validateAmount(b.target_amount);
    if (err) return res.status(400).json({ error: err });
    if (!MONTH_RE.test(String(b.deadline_month || '')) || b.deadline_month < currentMonth()) return res.status(400).json({ error: 'Hạn phải từ tháng này trở đi' });
    let walletId = toId(b.wallet_id);
    if (b.new_wallet_name) {
      // Tạo luôn ví tiết kiệm riêng cho mục tiêu
      const wn = cleanText(b.new_wallet_name, 60);
      if (!wn) return res.status(400).json({ error: 'Tên ví không hợp lệ' });
      const w = await db.query(`INSERT INTO wallets (book_id, name, type, color) VALUES ($1, $2, 'savings', '#1C7C45') RETURNING id`, [req.bookId, wn]);
      walletId = Number(w.rows[0].id);
    } else if (!(await tx.usableWallet(req.bookId, walletId))) {
      return res.status(400).json({ error: 'Chọn ví giữ tiền' });
    }
    const startAmount = Math.max(0, Number(await balance.walletBalance(walletId)));
    const r = await db.query(
      `INSERT INTO goals (book_id, name, target_amount, deadline_month, wallet_id, start_month, start_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.bookId, name, parseVnd(b.target_amount), b.deadline_month, walletId, currentMonth(), startAmount]
    );
    const list = await goalsList(req.bookId, true);
    res.status(201).json({ goal: list.find(g => g.id === Number(r.rows[0].id)) });
  } catch (e) { next(e); }
});

goals.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const b = req.body || {};
    const sets = [], vals = [id, req.bookId];
    const add = (c, v) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
    if ('name' in b) { const nm = cleanText(b.name, 60); if (!nm) return res.status(400).json({ error: 'Tên không hợp lệ' }); add('name', nm); }
    if ('target_amount' in b) { const err = validateAmount(b.target_amount); if (err) return res.status(400).json({ error: err }); add('target_amount', parseVnd(b.target_amount)); }
    if ('deadline_month' in b) { if (!MONTH_RE.test(String(b.deadline_month))) return res.status(400).json({ error: 'Hạn không hợp lệ' }); add('deadline_month', b.deadline_month); }
    if ('archived' in b) { if (typeof b.archived !== 'boolean') return res.status(400).json({ error: 'archived phải là true/false' }); sets.push(`archived_at = ${b.archived ? 'COALESCE(archived_at, NOW())' : 'NULL'}`); }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    const r = await db.query(`UPDATE goals SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND book_id = $2 RETURNING id`, vals);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy mục tiêu' });
    res.json({ goal: (await goalsList(req.bookId, true)).find(g => g.id === id) });
  } catch (e) { next(e); }
});

goals.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM goals WHERE id = $1 AND book_id = $2 RETURNING id', [toId(req.params.id), req.bookId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy mục tiêu' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Góp thêm = chuyển từ ví khác vào ví mục tiêu (không phải khoản chi)
goals.post('/:id/contribute', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const g = await db.query('SELECT * FROM goals WHERE id = $1 AND book_id = $2', [id, req.bookId]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Không tìm thấy mục tiêu' });
    const b = req.body || {};
    const err = validateAmount(b.amount);
    if (err) return res.status(400).json({ error: err });
    const from = await tx.usableWallet(req.bookId, toId(b.from_wallet_id));
    if (!from) return res.status(400).json({ error: 'Chọn ví lấy tiền' });
    if (Number(from.id) === Number(g.rows[0].wallet_id)) return res.status(400).json({ error: 'Ví lấy tiền phải khác ví mục tiêu' });
    const when = resolveOccurredAt(b);
    if (when.error) return res.status(400).json({ error: when.error });
    const t = await tx.insertTransfer(req.bookId, req.user.id, from.id, g.rows[0].wallet_id, parseVnd(b.amount), when.at, `Góp mục tiêu: ${g.rows[0].name}`.slice(0, 200));
    res.status(201).json({
      transfer_group: t.group,
      goal: (await goalsList(req.bookId, true)).find(x => x.id === id),
      warning: await tx.overdraftWarning(from)
    });
  } catch (e) { next(e); }
});

// ============ ĐỊNH KỲ ============
const rules = express.Router();
rules.use(authRequired, bookRequired);

const RULE_SELECT = `
  SELECT r.*, r.anchor_date::text AS anchor_s, r.next_date::text AS next_s, r.end_date::text AS end_s,
         w.name AS wallet_name, c.name AS category_name, COALESCE(NULLIF(c.icon, ''), pc.icon) AS category_icon, c.color AS category_color
  FROM recurring_rules r JOIN wallets w ON w.id = r.wallet_id
  LEFT JOIN categories c ON c.id = r.category_id LEFT JOIN categories pc ON pc.id = c.parent_id`;

function publicRule(r) {
  return {
    id: Number(r.id), kind: r.kind, amount: n(r.amount), wallet_id: Number(r.wallet_id), wallet_name: r.wallet_name,
    category_id: r.category_id === null ? null : Number(r.category_id), category_name: r.category_name || null,
    category_icon: r.category_icon || '', category_color: r.category_color || '#9AA79F',
    note: r.note, frequency: r.frequency, anchor_date: r.anchor_s, next_date: r.next_s, end_date: r.end_s || null,
    mode: r.mode, active: r.active, schedule: planning.scheduleLabel(r.anchor_s, r.frequency)
  };
}

async function getRule(bookId, id) {
  if (!id) return null;
  const r = await db.query(`${RULE_SELECT} WHERE r.id = $1 AND r.book_id = $2`, [id, bookId]);
  return r.rows[0] || null;
}

// Danh sách + lần chờ xác nhận + sắp tới 7 ngày + dự kiến tháng sau
async function rulesOverview(bookId) {
  const list = (await db.query(`${RULE_SELECT} WHERE r.book_id = $1 ORDER BY r.active DESC, r.next_date, r.id`, [bookId])).rows.map(publicRule);
  const pending = await db.query(
    `SELECT o.rule_id, o.due_date::text AS due_date FROM recurring_occurrences o JOIN recurring_rules r ON r.id = o.rule_id
     WHERE r.book_id = $1 AND o.status = 'pending' ORDER BY o.due_date`,
    [bookId]
  );
  const byId = {};
  list.forEach(r => { byId[r.id] = r; });
  const today = todayVN();
  const in7 = new Date(`${today}T12:00:00Z`); in7.setUTCDate(in7.getUTCDate() + 7);
  const until = in7.toISOString().slice(0, 10);
  const upcoming = [];
  const nextMonth = addMonths(currentMonth(), 1);
  const nb = monthBounds(nextMonth);
  const projection = { month: nextMonth, income: 0, expense: 0 };
  for (const r of list.filter(x => x.active)) {
    for (const d of planning.occurrencesBetween(r.anchor_date, r.frequency, r.next_date > today ? r.next_date : today, until)) {
      if (!r.end_date || d <= r.end_date) upcoming.push({ rule_id: r.id, date: d, amount: r.amount, kind: r.kind, name: r.note || r.category_name || 'Định kỳ' });
    }
    for (const d of planning.occurrencesBetween(r.anchor_date, r.frequency, nb.from, nb.to)) {
      if (!r.end_date || d <= r.end_date) projection[r.kind] += r.amount;
    }
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    rules: list,
    pending: pending.rows.map(p => ({ rule_id: Number(p.rule_id), due_date: p.due_date, ...(byId[p.rule_id] ? { amount: byId[p.rule_id].amount, kind: byId[p.rule_id].kind, name: byId[p.rule_id].note || byId[p.rule_id].category_name || 'Định kỳ', wallet_name: byId[p.rule_id].wallet_name } : {}) })),
    upcoming,
    projection
  };
}

rules.get('/', async (req, res, next) => {
  try {
    // Dự phòng khi cron chưa chạy: ghi các lần đến hạn của sổ này trước khi trả danh sách
    await recurring.processDueRules(todayVN(), { bookId: req.bookId });
    res.json(await rulesOverview(req.bookId));
  } catch (e) { next(e); }
});

async function readRule(req, b, current) {
  const v = {};
  const kind = 'kind' in b ? b.kind : current && current.kind;
  if (!['expense', 'income'].includes(kind)) return { error: 'Loại phải là chi hoặc thu' };
  if (!current || 'kind' in b) v.kind = kind;
  if (!current || 'amount' in b) { const err = validateAmount(b.amount); if (err) return { error: err }; v.amount = parseVnd(b.amount); }
  if (!current || 'wallet_id' in b) {
    const w = await tx.usableWallet(req.bookId, toId(b.wallet_id));
    if (!w) return { error: 'Chọn ví' };
    v.wallet_id = Number(w.id);
  }
  if ('category_id' in b || (current && 'kind' in b && b.kind !== current.kind)) {
    if (b.category_id === null || b.category_id === undefined) v.category_id = null;
    else {
      const c = await tx.usableCategory(req.bookId, toId(b.category_id), kind);
      if (!c) return { error: 'Danh mục không hợp lệ' };
      v.category_id = Number(c.id);
    }
  }
  if ('note' in b) { const note = cleanText(b.note, 200); if (note === null) return { error: 'Ghi chú tối đa 200 ký tự' }; v.note = note; }
  if (!current || 'frequency' in b) { if (!['weekly', 'monthly', 'yearly'].includes(b.frequency)) return { error: 'Chu kỳ phải là tuần, tháng hoặc năm' }; v.frequency = b.frequency; }
  if (!current || 'start_date' in b) {
    if (!realDate(b.start_date)) return { error: 'Ngày bắt đầu không hợp lệ' };
    v.anchor_date = b.start_date;
  }
  if ('end_date' in b) {
    if (b.end_date !== null && b.end_date !== '' && !realDate(b.end_date)) return { error: 'Ngày kết thúc không hợp lệ' };
    v.end_date = b.end_date || null;
  }
  if ('mode' in b) { if (!['auto', 'confirm'].includes(b.mode)) return { error: 'Chế độ phải là tự ghi hoặc nhắc' }; v.mode = b.mode; }
  if ('active' in b) { if (typeof b.active !== 'boolean') return { error: 'active phải là true/false' }; v.active = b.active; }
  return { values: v };
}

// Lần đến hạn đầu tiên từ hôm nay trở đi (không ghi bù quá khứ khi mới tạo / đổi lịch)
function firstFromToday(anchor, frequency) {
  const today = todayVN();
  if (anchor >= today) return anchor;
  const prev = new Date(`${today}T12:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
  return planning.nextAfter(anchor, frequency, prev.toISOString().slice(0, 10));
}

rules.post('/', canWrite, async (req, res, next) => {
  try {
    const r = await readRule(req, req.body || {}, null);
    if (r.error) return res.status(400).json({ error: r.error });
    const v = r.values;
    if (v.end_date && v.end_date < v.anchor_date) return res.status(400).json({ error: 'Ngày kết thúc phải sau ngày bắt đầu' });
    const ins = await db.query(
      `INSERT INTO recurring_rules (book_id, user_id, kind, amount, wallet_id, category_id, note, frequency, anchor_date, next_date, end_date, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [req.bookId, req.user.id, v.kind, v.amount, v.wallet_id, v.category_id || null, v.note || '', v.frequency, v.anchor_date,
        firstFromToday(v.anchor_date, v.frequency), v.end_date || null, v.mode || 'auto']
    );
    const id = Number(ins.rows[0].id);
    // Đến hạn ngay hôm nay → ghi luôn, không chờ cron sáng mai
    await recurring.processRule(id, todayVN());
    res.status(201).json({ rule: publicRule(await getRule(req.bookId, id)) });
  } catch (e) { next(e); }
});

rules.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const cur = await getRule(req.bookId, toId(req.params.id));
    if (!cur) return res.status(404).json({ error: 'Không tìm thấy quy tắc' });
    const r = await readRule(req, req.body || {}, cur);
    if (r.error) return res.status(400).json({ error: r.error });
    const v = r.values;
    const anchor = v.anchor_date || cur.anchor_s;
    const freq = v.frequency || cur.frequency;
    if (v.anchor_date || v.frequency || (v.active === true && !cur.active)) v.next_date = firstFromToday(anchor, freq);
    const cols = Object.keys(v);
    if (!cols.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    await db.query(
      `UPDATE recurring_rules SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW() WHERE id = $1 AND book_id = $2`,
      [cur.id, req.bookId, ...cols.map(c => v[c])]
    );
    await recurring.processRule(Number(cur.id), todayVN());
    res.json({ rule: publicRule(await getRule(req.bookId, Number(cur.id))) });
  } catch (e) { next(e); }
});

rules.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM recurring_rules WHERE id = $1 AND book_id = $2 RETURNING id', [toId(req.params.id), req.bookId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy quy tắc' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Lần đến hạn đang chờ (chế độ "nhắc"): xác nhận (có thể sửa số tiền) hoặc bỏ qua
rules.post('/:id/pending/:date/confirm', canWrite, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!realDate(req.params.date)) return res.status(400).json({ error: 'Ngày không hợp lệ' });
    let amount = null;
    if ((req.body || {}).amount !== undefined) {
      const err = validateAmount(req.body.amount);
      if (err) return res.status(400).json({ error: err });
      amount = parseVnd(req.body.amount);
    }
    const txId = await recurring.confirmPending(req.bookId, id, req.params.date, amount);
    if (!txId) return res.status(404).json({ error: 'Không có khoản chờ xác nhận này' });
    res.json({ transaction: publicTx(await tx.getTx(req.bookId, txId)) });
  } catch (e) { next(e); }
});

rules.post('/:id/pending/:date/skip', canWrite, async (req, res, next) => {
  try {
    if (!realDate(req.params.date)) return res.status(400).json({ error: 'Ngày không hợp lệ' });
    const ok = await recurring.skipPending(req.bookId, toId(req.params.id), req.params.date);
    if (!ok) return res.status(404).json({ error: 'Không có khoản chờ xác nhận này' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = { budgets, goals, rules, budgetsStatus, rulesOverview };
