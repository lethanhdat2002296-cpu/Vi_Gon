// Sổ nợ (F16): cho mượn / đi vay, trả từng phần, nhắc hạn.
// Tiền ra/vào ví ghi bằng giao dịch nguồn 'debt' → số dư ví đúng nhưng báo cáo không tính là thu/chi.
const db = require('../lib/db');
const { daysBetween } = require('../utils/time');

const diffDays = (from, to) => daysBetween(from, to) - 1;

// Trạng thái hiển thị: còn lại, quá hạn bao nhiêu ngày, còn bao nhiêu ngày tới hạn
function debtStatus(d, today) {
  const amount = Number(d.amount);
  const paid = Number(d.paid || 0);
  const remaining = Math.max(0, amount - paid);
  const out = { remaining, paid, progress: amount ? Math.min(1, paid / amount) : 0, overdue_days: 0, days_left: null, closed: remaining === 0 };
  if (remaining > 0 && d.due_date) {
    const left = diffDays(today, d.due_date);
    if (left < 0) out.overdue_days = -left;
    else out.days_left = left;
  }
  return out;
}

const SELECT_DEBTS = `
  SELECT d.id, d.direction, d.person, d.amount::text AS amount, d.wallet_id, d.start_date::text AS start_date,
         d.due_date::text AS due_date, d.note, d.user_id, d.created_at,
         COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id), 0)::text AS paid
  FROM debts d`;

async function listDebts(bookId, q = db) {
  const r = await q.query(`${SELECT_DEBTS} WHERE d.book_id = $1 ORDER BY d.start_date DESC, d.id DESC`, [bookId]);
  return r.rows;
}

// Tổng "Người ta nợ mình" / "Mình nợ" (phần còn lại) + số khoản quá hạn
async function totals(bookId, today) {
  const rows = await listDebts(bookId);
  const t = { lent: 0, borrowed: 0, overdue: 0, open: 0 };
  for (const d of rows) {
    const s = debtStatus(d, today);
    if (!s.remaining) continue;
    t.open++;
    if (d.direction === 'lend') t.lent += s.remaining; else t.borrowed += s.remaining;
    if (s.overdue_days) t.overdue++;
  }
  return t;
}

// Khoản cần nhắc hôm nay: còn nợ, hạn đúng hôm nay ('due') hoặc sau 3 ngày ('before3')
async function dueReminders(today) {
  const r = await db.query(
    `${SELECT_DEBTS.replace('FROM debts d', ', u.email, u.full_name, u.email_verified_at FROM debts d JOIN users u ON u.id = d.user_id')}
     WHERE d.due_date IN ($1::date, $1::date + 3)`,
    [today]
  );
  return r.rows
    .map(d => ({ ...d, ...debtStatus(d, today), kind: d.due_date === today ? 'due' : 'before3' }))
    .filter(d => d.remaining > 0 && d.email_verified_at);
}

module.exports = { debtStatus, listDebts, totals, dueReminders, SELECT_DEBTS };
