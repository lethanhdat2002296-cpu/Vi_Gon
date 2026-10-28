// /api/summary (Tổng quan, F02) và /api/reports/* (Báo cáo, F07).
// Thu/chi không tính chuyển giữa ví và điều chỉnh số dư; kỳ tính theo giờ Việt Nam.
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const balance = require('../services/balance');
const { buildFilter, monthBounds, previousPeriod } = require('../services/filters');
const { currentMonth, addMonths, nowInTimezone } = require('../utils/time');
const { SELECT_TX, publicTx } = require('./transactions');
// Nạp muộn để tránh vòng require (planning → transactions → …)
const planningRoutes = () => require('./planning');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const n = v => Number(v || 0);

// Tổng thu, chi theo bộ lọc báo cáo
async function incomeExpense(bookId, query) {
  const f = buildFilter(bookId, query, { forReport: true });
  if (f.error) throw Object.assign(new Error(f.error), { status: 400 });
  const r = await db.query(
    `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::text AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::text AS expense
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${f.where.join(' AND ')}`,
    f.vals
  );
  return { income: n(r.rows[0].income), expense: n(r.rows[0].expense) };
}

// ============ TỔNG QUAN ============
const summary = express.Router();
summary.use(authRequired, bookRequired);
summary.get('/', async (req, res, next) => {
  try {
    const thisMonth = currentMonth();
    const month = req.query.month || thisMonth;
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Tháng không hợp lệ (YYYY-MM)' });
    if (month > thisMonth) return res.status(400).json({ error: 'Chưa tới tháng này' });

    const [wallets, ie, recent] = await Promise.all([
      balance.walletsWithBalance(req.bookId),
      incomeExpense(req.bookId, monthBounds(month)),
      db.query(`${SELECT_TX} WHERE t.book_id = $1 AND t.deleted_at IS NULL ORDER BY t.occurred_at DESC, t.id DESC LIMIT 5`, [req.bookId])
    ]);

    // Thẻ cảnh báo. Ngân sách, giao dịch tự động, định kỳ sẽ thêm ở giai đoạn 2–3.
    const alerts = [];
    const today = nowInTimezone();
    const day = Number(today.date.slice(8));
    for (const w of wallets) {
      const bal = Number(w.balance);
      if (w.type !== 'credit' && bal < 0) {
        alerts.push({ kind: 'overdraft', wallet_id: Number(w.id), text: `Ví "${w.name}" đang âm` });
      }
      if (w.type === 'credit' && w.due_day && bal < 0) {
        const daysLeft = w.due_day >= day ? w.due_day - day : null;
        if (daysLeft !== null && daysLeft <= 5) {
          alerts.push({ kind: 'credit_due', wallet_id: Number(w.id), text: daysLeft === 0 ? `Hôm nay đến hạn thanh toán thẻ "${w.name}"` : `Còn ${daysLeft} ngày đến hạn thanh toán thẻ "${w.name}"` });
        }
      }
    }

    // Ngân sách sắp vượt / đã vượt (tháng đang xem) + định kỳ chờ xác nhận + sắp tới 7 ngày
    const plan = planningRoutes();
    // Dự phòng khi cron chưa chạy (chưa đặt CRON_SECRET, cron trễ): mở app là ghi định kỳ đến hạn của sổ này
    await require('../services/recurring').processDueRules(nowInTimezone().date, { bookId: req.bookId });
    const [budgetList, rec] = await Promise.all([plan.budgetsStatus(req.bookId, month), plan.rulesOverview(req.bookId)]);
    for (const b of budgetList) {
      if (b.level === 'over') alerts.push({ kind: 'budget_over', budget_id: b.id, text: `Đã vượt ngân sách ${b.name} ${(b.spent - b.limit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫` });
      else if (b.level === 'warn') alerts.push({ kind: 'budget_warn', budget_id: b.id, text: `Ngân sách ${b.name} đã dùng ${b.percent}%` });
    }
    if (rec.pending.length) alerts.push({ kind: 'recurring_pending', text: `${rec.pending.length} khoản định kỳ chờ xác nhận` });

    res.json({
      upcoming: rec.upcoming.slice(0, 5),
      month,
      is_current: month === thisMonth,
      prev_month: addMonths(month, -1),
      next_month: month < thisMonth ? addMonths(month, 1) : null,
      total_balance: Number(balance.totalBalance(wallets)),
      wallet_count: wallets.length,
      income: ie.income,
      expense: ie.expense,
      net: ie.income - ie.expense,
      recent: recent.rows.map(publicTx),
      alerts
    });
  } catch (e) { next(e); }
});

// ============ BÁO CÁO ============
const reports = express.Router();
reports.use(authRequired, bookRequired);

// Chi (hoặc thu) theo danh mục cấp 1 (cộng mục con vào cha), so với kỳ liền trước
reports.get('/by-category', async (req, res, next) => {
  try {
    const kind = req.query.kind === 'income' ? 'income' : 'expense';
    const thisMonth = monthBounds(currentMonth());
    const from = req.query.from || thisMonth.from;
    const to = req.query.to || thisMonth.to;
    const prev = previousPeriod(from, to);

    async function byCat(range) {
      const f = buildFilter(req.bookId, { ...range, wallet: req.query.wallet, kind }, { forReport: true });
      if (f.error) throw Object.assign(new Error(f.error), { status: 400 });
      const r = await db.query(
        `SELECT COALESCE(c.parent_id, c.id) AS id, SUM(t.amount)::text AS amount, COUNT(*)::int AS count
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${f.where.join(' AND ')}
         GROUP BY 1`,
        f.vals
      );
      return r.rows;
    }
    const [cur, before] = await Promise.all([byCat({ from, to }), byCat(prev)]);
    const ids = [...new Set([...cur, ...before].map(r => r.id).filter(Boolean))];
    const cats = ids.length
      ? (await db.query('SELECT id, name, icon, color, sort_order FROM categories WHERE book_id = $1 AND id = ANY($2::bigint[])', [req.bookId, ids])).rows
      : [];
    const info = {};
    cats.forEach(c => { info[c.id] = c; });
    const prevMap = {};
    before.forEach(r => { prevMap[r.id || 'none'] = n(r.amount); });

    const total = cur.reduce((s, r) => s + n(r.amount), 0);
    const prevTotal = before.reduce((s, r) => s + n(r.amount), 0);
    const rows = cur.map(r => {
      const c = r.id ? info[r.id] : null;
      const amount = n(r.amount);
      const prevAmount = prevMap[r.id || 'none'] || 0;
      return {
        id: r.id ? Number(r.id) : null,
        name: c ? c.name : 'Chưa phân loại',
        icon: c ? c.icon : '',
        color: c ? c.color : '#9AA79F',
        amount,
        count: r.count,
        share: total ? Math.round((amount / total) * 10000) / 10000 : 0,
        prev_amount: prevAmount,
        change: amount - prevAmount
      };
    }).sort((a, b) => b.amount - a.amount);

    res.json({
      kind, from, to,
      partial: to >= nowInTimezone().date,
      prev,
      total,
      prev_total: prevTotal,
      categories: rows
    });
  } catch (e) { next(e); }
});

// Thu/chi từng tháng, N tháng gần nhất (gồm tháng đang chạy)
reports.get('/monthly', async (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
    const end = req.query.end && MONTH_RE.test(req.query.end) && req.query.end <= currentMonth() ? req.query.end : currentMonth();
    const start = addMonths(end, -(months - 1));
    const f = buildFilter(req.bookId, { from: monthBounds(start).from, to: monthBounds(end).to, wallet: req.query.wallet }, { forReport: true });
    if (f.error) return res.status(400).json({ error: f.error });
    const r = await db.query(
      `SELECT to_char(t.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS month,
              COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::text AS income,
              COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::text AS expense
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${f.where.join(' AND ')}
       GROUP BY 1`,
      f.vals
    );
    const byMonth = {};
    r.rows.forEach(x => { byMonth[x.month] = x; });
    const out = [];
    for (let i = 0; i < months; i++) {
      const m = addMonths(start, i);
      out.push({ month: m, income: n(byMonth[m] && byMonth[m].income), expense: n(byMonth[m] && byMonth[m].expense), partial: m === currentMonth() });
    }
    res.json({ months: out });
  } catch (e) { next(e); }
});

module.exports = { summary, reports, incomeExpense };
