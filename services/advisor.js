// Trợ lý AI (chạy trên máy người dùng): máy chủ chỉ gom số liệu tóm tắt của sổ để đưa vào lời nhắc.
// Không gọi dịch vụ AI nào; mô hình chạy trong trình duyệt (public/js/ai.js).
const db = require('../lib/db');
const balance = require('./balance');
const debts = require('./debts');
const { buildFilter, monthBounds } = require('./filters');
const { currentMonth, addMonths, nowInTimezone } = require('../utils/time');

const n = v => Number(v || 0);
const MONTHS = 3;

// Chi theo danh mục cấp 1 (cộng mục con) trong khoảng ngày, chỉ tính chi thật (không chuyển ví, điều chỉnh, sổ nợ)
async function spendByTopCategory(bookId, from, to) {
  const f = buildFilter(bookId, { from, to, kind: 'expense' }, { forReport: true });
  const r = await db.query(
    `SELECT COALESCE(p.name, c.name, 'Chưa phân loại') AS name, SUM(t.amount)::text AS amount
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
     WHERE ${f.where.join(' AND ')} GROUP BY 1`,
    f.vals
  );
  return r.rows.map(x => ({ name: x.name, amount: n(x.amount) }));
}

async function incomeExpense(bookId, from, to) {
  const f = buildFilter(bookId, { from, to }, { forReport: true });
  const r = await db.query(
    `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::text AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::text AS expense
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE ${f.where.join(' AND ')}`,
    f.vals
  );
  return { income: n(r.rows[0].income), expense: n(r.rows[0].expense) };
}

async function buildContext(bookId) {
  const plan = require('../routes/planning');
  const today = nowInTimezone().date;
  const month = currentMonth();
  const mb = monthBounds(month);
  // 3 tháng đã trọn (không gồm tháng đang chạy)
  const first = monthBounds(addMonths(month, -MONTHS)).from;
  const last = monthBounds(addMonths(month, -1)).to;
  const [wallets, thisMonth, past, pastCats, budgets, goals, debtTotals, cats] = await Promise.all([
    balance.walletsWithBalance(bookId),
    incomeExpense(bookId, mb.from, today),
    incomeExpense(bookId, first, last),
    spendByTopCategory(bookId, first, last),
    plan.budgetsStatus(bookId, month),
    plan.goalsList(bookId, false),
    debts.totals(bookId, today),
    db.query(`SELECT name FROM categories WHERE book_id = $1 AND kind = 'expense' AND parent_id IS NULL AND archived_at IS NULL ORDER BY sort_order, id`, [bookId])
  ]);
  // Số tháng đã có dữ liệu trong 3 tháng trước (người mới dùng: chia ít tháng hơn cho đúng trung bình)
  const used = await db.query(
    `SELECT COUNT(DISTINCT to_char(occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM'))::int AS m
     FROM transactions WHERE book_id = $1 AND deleted_at IS NULL AND occurred_at >= $2::date AND occurred_at < ($3::date + 1)`,
    [bookId, first, last]
  );
  const months = Math.max(1, used.rows[0].m);
  const avg = x => Math.round(x / months / 1000) * 1000;
  const day = Number(today.slice(8));
  const lastDay = Number(mb.to.slice(8));
  return {
    today,
    month,
    days_left: lastDay - day + 1,
    total_balance: Number(balance.totalBalance(wallets)),
    wallets: wallets.filter(w => !w.exclude_from_total).map(w => ({ name: w.name, type: w.type, balance: Number(w.balance) })),
    this_month: thisMonth,
    history_months: used.rows[0].m,
    avg_month: { income: avg(past.income), expense: avg(past.expense) },
    avg_by_category: pastCats.map(c => ({ name: c.name, amount: avg(c.amount) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 10),
    budgets: budgets.map(b => ({ name: b.name, limit: b.limit, spent: b.spent })),
    goals: goals.map(g => ({ name: g.name, target: g.target_amount, saved: g.saved, deadline: g.deadline_month, monthly_needed: g.monthly_needed })),
    debts: { lent: debtTotals.lent, borrowed: debtTotals.borrowed },
    expense_categories: cats.rows.map(c => c.name)
  };
}

module.exports = { buildContext };
