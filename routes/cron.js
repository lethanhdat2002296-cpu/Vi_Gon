// /api/cron/daily: Vercel Cron gọi mỗi sáng (vercel.json). Bảo vệ bằng header Authorization: Bearer CRON_SECRET.
// FAIL-CLOSED: chưa đặt CRON_SECRET hoặc sai → 401, không chạy gì.
//   1. Ghi giao dịch định kỳ đến hạn (không trùng khi chạy lại)
//   2. Gửi email ngân sách chạm 80% / 100% (mỗi mốc 1 lần/tháng)
const crypto = require('crypto');
const express = require('express');
const db = require('../lib/db');
const config = require('../config');
const recurring = require('../services/recurring');
const email = require('../utils/email');
const { budgetsStatus } = require('./planning');
const { currentMonth, nowInTimezone } = require('../utils/time');

const router = express.Router();

function authorized(req) {
  if (!config.CRON_SECRET) return false;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${config.CRON_SECRET}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

router.use((req, res, next) => {
  if (!authorized(req)) {
    if (!config.CRON_SECRET) console.error('CRON_SECRET chưa đặt: từ chối gọi cron');
    return res.status(401).json({ error: 'Không có quyền' });
  }
  next();
});

// Nhắc ngân sách: ghi mốc vào budget_alerts trước (ON CONFLICT) rồi mới gửi → không gửi lặp
async function budgetAlerts(month) {
  const books = await db.query(
    `SELECT DISTINCT b.book_id, u.email, u.full_name FROM budgets b
     JOIN books k ON k.id = b.book_id JOIN users u ON u.id = k.owner_id`
  );
  let sent = 0;
  for (const bk of books.rows) {
    const list = await budgetsStatus(Number(bk.book_id), month);
    for (const s of list) {
      const level = s.spent > s.limit ? 100 : s.pct >= 1 ? 100 : s.pct >= 0.8 ? 80 : 0;
      if (!level) continue;
      const ins = await db.query(
        'INSERT INTO budget_alerts (budget_id, month, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING budget_id',
        [s.id, month, level]
      );
      // Đã vượt 100% mà chưa báo 80% → chỉ báo mốc 100% (ghi luôn mốc 80% để khỏi báo sau)
      if (level === 100) await db.query('INSERT INTO budget_alerts (budget_id, month, level) VALUES ($1, $2, 80) ON CONFLICT DO NOTHING', [s.id, month]);
      if (!ins.rows[0]) continue;
      const r = await email.sendBudgetAlert(bk.email, bk.full_name, { ...s, month, level });
      if (r.ok) sent++;
    }
  }
  return sent;
}

router.get('/daily', async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    const rec = await recurring.processDueRules(today);
    const alerts = await budgetAlerts(currentMonth());
    console.log('[cron daily]', today, JSON.stringify({ ...rec, alerts }));
    res.json({ ok: true, today, recurring: rec, budget_emails: alerts });
  } catch (e) { next(e); }
});

module.exports = router;
