// Chạy giao dịch định kỳ đến hạn (F11) và nhắc ngân sách (F09). Gọi từ cron hằng ngày.
// Chạy lại bao nhiêu lần cũng không tạo trùng: mỗi (quy tắc, ngày đến hạn) chỉ có 1 dòng recurring_occurrences.
const db = require('../lib/db');
const planning = require('./planning');

const MAX_CATCHUP = 60; // cron nghỉ lâu thì bù tối đa 60 lần mỗi quy tắc

// Ngày (giờ VN) → thời điểm 07:00 sáng giờ VN
function morningOf(date) {
  return new Date(`${date}T07:00:00+07:00`);
}

// Tạo giao dịch từ mẫu của quy tắc cho 1 ngày đến hạn
async function createFromRule(client, rule, date, amount) {
  const r = await client.query(
    `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'recurring') RETURNING id`,
    [rule.book_id, rule.user_id, rule.wallet_id, rule.category_id, rule.kind, amount || rule.amount, morningOf(date), rule.note]
  );
  return Number(r.rows[0].id);
}

// Xử lý 1 quy tắc tới hết ngày `today`. Khoá dòng quy tắc để 2 lần chạy song song không đụng nhau.
async function processRule(ruleId, today) {
  return db.withTransaction(async (client) => {
    const r = await client.query(
      `SELECT *, anchor_date::text AS anchor_s, next_date::text AS next_s, end_date::text AS end_s
       FROM recurring_rules WHERE id = $1 AND active FOR UPDATE SKIP LOCKED`, [ruleId]);
    const rule = r.rows[0];
    if (!rule) return { created: 0, pending: 0 };
    // Đọc DATE dạng chữ 'YYYY-MM-DD' để không lệch múi giờ
    const anchor = rule.anchor_s;
    const end = rule.end_s || null;
    let next = rule.next_s;
    let created = 0, pending = 0, n = 0;
    while (next <= today && (!end || next <= end) && n < MAX_CATCHUP) {
      n++;
      const occ = await client.query(
        `INSERT INTO recurring_occurrences (rule_id, due_date, status) VALUES ($1, $2, $3)
         ON CONFLICT (rule_id, due_date) DO NOTHING RETURNING rule_id`,
        [rule.id, next, rule.mode === 'auto' ? 'created' : 'pending']
      );
      if (occ.rows[0]) {
        if (rule.mode === 'auto') {
          const txId = await createFromRule(client, rule, next);
          await client.query('UPDATE recurring_occurrences SET transaction_id = $3 WHERE rule_id = $1 AND due_date = $2', [rule.id, next, txId]);
          created++;
        } else {
          pending++;
        }
      }
      next = planning.nextAfter(anchor, rule.frequency, next);
    }
    const finished = end && next > end;
    await client.query('UPDATE recurring_rules SET next_date = $2, active = $3, updated_at = NOW() WHERE id = $1', [rule.id, next, !finished]);
    return { created, pending };
  });
}

async function processDueRules(today, { bookId } = {}) {
  const r = await db.query(
    `SELECT id FROM recurring_rules WHERE active AND next_date <= $1 ${bookId ? 'AND book_id = $2' : ''} ORDER BY id`,
    bookId ? [today, bookId] : [today]
  );
  let created = 0, pending = 0;
  for (const row of r.rows) {
    const x = await processRule(Number(row.id), today);
    created += x.created; pending += x.pending;
  }
  return { rules: r.rows.length, created, pending };
}

// Xác nhận 1 lần đến hạn đang chờ → tạo giao dịch (có thể sửa số tiền)
async function confirmPending(bookId, ruleId, date, amount) {
  return db.withTransaction(async (client) => {
    const r = await client.query(
      `SELECT r.* FROM recurring_occurrences o JOIN recurring_rules r ON r.id = o.rule_id
       WHERE o.rule_id = $1 AND o.due_date = $2 AND o.status = 'pending' AND r.book_id = $3 FOR UPDATE OF o`,
      [ruleId, date, bookId]
    );
    const rule = r.rows[0];
    if (!rule) return null;
    const txId = await createFromRule(client, rule, date, amount);
    await client.query(`UPDATE recurring_occurrences SET status = 'created', transaction_id = $3 WHERE rule_id = $1 AND due_date = $2`, [ruleId, date, txId]);
    return txId;
  });
}

async function skipPending(bookId, ruleId, date) {
  const r = await db.query(
    `UPDATE recurring_occurrences o SET status = 'skipped'
     FROM recurring_rules r
     WHERE o.rule_id = r.id AND o.rule_id = $1 AND o.due_date = $2 AND o.status = 'pending' AND r.book_id = $3
     RETURNING o.rule_id`,
    [ruleId, date, bookId]
  );
  return !!r.rows[0];
}

module.exports = { processRule, processDueRules, confirmPending, skipPending, morningOf };
