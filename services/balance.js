// Số dư ví = số dư đầu + Σ thu − Σ chi (gồm cả chuyển tiền và điều chỉnh), chỉ tính bản ghi chưa xoá.
// Không lưu cứng số dư ở đâu cả.
const db = require('../lib/db');

// Bản thuần để test: txs = [{ kind, amount, deleted_at }]
function computeBalance(openingBalance, txs) {
  let bal = BigInt(openingBalance || 0);
  for (const t of txs) {
    if (t.deleted_at) continue;
    const amt = BigInt(t.amount);
    if (t.kind === 'income') bal += amt;
    else if (t.kind === 'expense') bal -= amt;
  }
  return bal;
}

// Tổng tài sản: cộng các ví chưa ẩn và không đánh dấu "không tính vào tổng"
function totalBalance(wallets) {
  return wallets
    .filter(w => !w.archived_at && !w.exclude_from_total)
    .reduce((s, w) => s + BigInt(w.balance), 0n);
}

const BALANCE_SQL = `
  w.opening_balance + COALESCE((
    SELECT SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE -t.amount END)
    FROM transactions t WHERE t.wallet_id = w.id AND t.deleted_at IS NULL
  ), 0)`;

// Danh sách ví của sổ kèm số dư (BIGINT → chuỗi, client tự định dạng)
async function walletsWithBalance(bookId, { includeArchived = false, q = db } = {}) {
  const r = await q.query(
    `SELECT w.*, (${BALANCE_SQL})::text AS balance,
            EXISTS (SELECT 1 FROM transactions t WHERE t.wallet_id = w.id) AS has_transactions
     FROM wallets w
     WHERE w.book_id = $1 ${includeArchived ? '' : 'AND w.archived_at IS NULL'}
     ORDER BY w.archived_at NULLS FIRST, w.sort_order, w.id`,
    [bookId]
  );
  return r.rows;
}

async function walletBalance(walletId, q = db) {
  const r = await q.query(`SELECT (${BALANCE_SQL})::text AS balance FROM wallets w WHERE w.id = $1`, [walletId]);
  return r.rows[0] ? BigInt(r.rows[0].balance) : null;
}

module.exports = { computeBalance, totalBalance, walletsWithBalance, walletBalance };
