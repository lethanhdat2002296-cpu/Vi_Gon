import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const config = require('../config.js');
const time = require('../utils/time.js');
const planning = require('../services/planning.js');

describe.skipIf(!TEST_DB)('Kế hoạch F09–F11 (Postgres thật)', () => {
  let app, call;
  let seq = 0;
  const today = time.nowInTimezone().date;
  const thisMonth = time.currentMonth();
  const lastMonth = time.addMonths(thisMonth, -1);
  const addDays = (d, k) => time.addDays(d, k);

  beforeAll(async () => { await setupDb(); app = await startApp(); call = app.call; });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => {
    await resetData();
    await sql('TRUNCATE budgets, budget_alerts, goals, recurring_rules, recurring_occurrences CASCADE');
    vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true });
    vi.spyOn(email, 'sendBudgetAlert').mockResolvedValue({ ok: true });
    config.CRON_SECRET = 'bi-mat-cron-test-0123456789';
  });

  async function setup() {
    const addr = `p${++seq}@vigon.vn`;
    const r = await call('POST', '/api/auth/register', { email: addr, password: 'matkhau123' });
    const t = r.body.token;
    const cats = (await call('GET', '/api/categories', null, t)).body.categories;
    const cat = (nm, k = 'expense') => cats.find(c => c.name === nm && c.kind === k).id;
    const cash = (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 20_000_000 }, t)).body.wallet;
    const spend = (amount, c, date) => call('POST', '/api/transactions', { kind: 'expense', amount, wallet_id: cash.id, category_id: c, date }, t);
    return { t, email: addr, cat, cash, spend };
  }
  const cron = (secret = config.CRON_SECRET) => fetch(app.base + '/api/cron/daily', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });

  describe('ngân sách (F09)', () => {
    it('trạng thái: tính cả mục con, % và màu, mức/ngày theo số ngày còn lại', async () => {
      const { t, cat, spend } = await setup();
      const r = await call('POST', '/api/budgets', { category_id: cat('Ăn uống'), amount: 4_000_000 }, t);
      expect(r.status).toBe(201);
      await spend(3_000_000, cat('Đi chợ'));
      await spend(440_000, cat('Cà phê'));
      await spend(999_000, cat('Mua sắm'));
      const s = (await call('GET', '/api/budgets/status', null, t)).body;
      const b = s.budgets[0];
      expect(b).toMatchObject({ name: 'Ăn uống', limit: 4_000_000, spent: 3_440_000, percent: 86, level: 'warn' });
      const [y, m] = thisMonth.split('-').map(Number);
      const daysLeft = planning.lastDayOfMonth(y, m) - Number(today.slice(8)) + 1;
      expect(b.days_left).toBe(daysLeft);
      expect(b.per_day).toBe(Math.floor(560_000 / daysLeft));
    });
    it('ngân sách tổng; mỗi danh mục 1 ngân sách; vượt → đỏ', async () => {
      const { t, cat, spend } = await setup();
      await call('POST', '/api/budgets', { category_id: null, amount: 1_000_000 }, t);
      expect((await call('POST', '/api/budgets', { amount: 2_000_000 }, t)).status).toBe(409);
      await spend(700_000, cat('Đi lại'));
      await spend(400_000, cat('Giải trí'));
      const b = (await call('GET', '/api/budgets/status', null, t)).body.budgets[0];
      expect(b).toMatchObject({ name: 'Tổng chi tiêu', spent: 1_100_000, level: 'over', per_day: 0 });
    });
    it('chuyển phần chưa tiêu tháng trước; gợi ý = trung bình 3 tháng', async () => {
      const { t, cat, spend } = await setup();
      const b = (await call('POST', '/api/budgets', { category_id: cat('Đi lại'), amount: 1_000_000, rollover: true }, t)).body.budget;
      await sql('UPDATE budgets SET start_month = $1 WHERE id = $2', [lastMonth, b.id]);
      await spend(600_000, cat('Xăng'), `${lastMonth}-10`);
      const s = (await call('GET', '/api/budgets/status', null, t)).body.budgets[0];
      expect(s).toMatchObject({ carry: 400_000, limit: 1_400_000 });
      const sug = (await call('GET', `/api/budgets/suggest?category_id=${cat('Đi lại')}`, null, t)).body;
      expect(sug.suggested).toBe(Math.ceil(600_000 / 3 / 10000) * 10000);
    });
    it('cron gửi email 80% và 100% mỗi mốc 1 lần/tháng', async () => {
      const { t, cat, spend } = await setup();
      await call('POST', '/api/budgets', { category_id: cat('Ăn uống'), amount: 1_000_000 }, t);
      await spend(850_000, cat('Ăn uống'));
      expect((await cron()).status).toBe(200);
      await cron();
      expect(email.sendBudgetAlert).toHaveBeenCalledTimes(1);
      expect(email.sendBudgetAlert.mock.calls[0][2]).toMatchObject({ level: 80, percent: 85 });
      await spend(200_000, cat('Ăn uống'));
      await cron(); await cron();
      expect(email.sendBudgetAlert).toHaveBeenCalledTimes(2);
      expect(email.sendBudgetAlert.mock.calls[1][2]).toMatchObject({ level: 100 });
      const s = (await call('GET', '/api/summary', null, t)).body;
      expect(s.alerts.map(a => a.kind)).toContain('budget_over');
    });
  });

  describe('mục tiêu (F10)', () => {
    it('tạo kèm ví tiết kiệm mới, góp thêm = chuyển tiền (không phải chi), tính lại tiến độ', async () => {
      const { t, cash } = await setup();
      const deadline = time.addMonths(thisMonth, 10);
      const g = (await call('POST', '/api/goals', { name: 'Mua xe máy', target_amount: 50_000_000, deadline_month: deadline, new_wallet_name: 'Quỹ xe' }, t)).body.goal;
      expect(g).toMatchObject({ saved: 0, percent: 0, months_left: 10, monthly_needed: 5_000_000, status: 'on_track' });
      const c = await call('POST', `/api/goals/${g.id}/contribute`, { from_wallet_id: cash.id, amount: 18_500_000 }, t);
      expect(c.status).toBe(201);
      expect(c.body.goal).toMatchObject({ saved: 18_500_000, percent: 37, monthly_needed: 3_150_000, status: 'on_track' });
      const s = (await call('GET', '/api/summary', null, t)).body;
      expect(s.expense).toBe(0);
      expect(s.total_balance).toBe(20_000_000);
      expect((await call('POST', `/api/goals/${g.id}/contribute`, { from_wallet_id: g.wallet_id, amount: 1 }, t)).status).toBe(400);
      // Ví đang dùng cho mục tiêu không xoá được
      expect((await call('DELETE', `/api/wallets/${g.wallet_id}`, null, t)).status).toBe(409);
    });
    it('hạn trong quá khứ bị chặn; sửa, ẩn, xoá', async () => {
      const { t, cash } = await setup();
      expect((await call('POST', '/api/goals', { name: 'X', target_amount: 1000, deadline_month: lastMonth, wallet_id: cash.id }, t)).status).toBe(400);
      const g = (await call('POST', '/api/goals', { name: 'Quỹ khẩn cấp', target_amount: 30_000_000, deadline_month: thisMonth, wallet_id: cash.id }, t)).body.goal;
      expect(g.start_month).toBe(thisMonth);
      expect((await call('PATCH', `/api/goals/${g.id}`, { target_amount: 10_000_000 }, t)).body.goal.status).toBe('achieved');
      expect((await call('PATCH', `/api/goals/${g.id}`, { archived: true }, t)).body.goal.archived).toBe(true);
      expect((await call('GET', '/api/goals', null, t)).body.goals).toEqual([]);
      expect((await call('DELETE', `/api/goals/${g.id}`, null, t)).status).toBe(200);
    });
  });

  describe('định kỳ (F11)', () => {
    it('nghiệm thu: tiền nhà 3.500.000 ngày đến hạn → có giao dịch đúng ví, đúng danh mục, buổi sáng', async () => {
      const { t, cat, cash } = await setup();
      const r = await call('POST', '/api/recurring', {
        kind: 'expense', amount: 3_500_000, wallet_id: cash.id, category_id: cat('Thuê nhà'), note: 'Tiền nhà',
        frequency: 'monthly', start_date: today, mode: 'auto'
      }, t);
      expect(r.status).toBe(201);
      expect(r.body.rule.next_date).toBe(planning.nextAfter(today, 'monthly', today));
      const list = (await call('GET', '/api/transactions?source=recurring', null, t)).body.transactions;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ amount: 3_500_000, wallet_id: cash.id, category_name: 'Thuê nhà', note: 'Tiền nhà' });
      expect(time.toLocalDateHour(list[0].occurred_at)).toEqual({ date: today, hour: 7 });
    });
    it('cron bù các lần bị lỡ, chạy lại không tạo trùng', async () => {
      const { t, cat, cash } = await setup();
      const anchor = addDays(today, -70);
      const rule = (await call('POST', '/api/recurring', { kind: 'expense', amount: 100_000, wallet_id: cash.id, category_id: cat('Mạng'), frequency: 'weekly', start_date: anchor }, t)).body.rule;
      // Tạo mới không ghi bù quá khứ: chỉ ghi lần rơi đúng hôm nay (nếu có)
      expect((await call('GET', '/api/transactions?source=recurring', null, t)).body.summary.count)
        .toBe(planning.occurrencesBetween(anchor, 'weekly', today, today).length);
      // Giả lập cron nghỉ 3 tuần
      const back = addDays(today, -21);
      await sql('UPDATE recurring_rules SET next_date = $1 WHERE id = $2', [planning.nextAfter(anchor, 'weekly', addDays(back, -1)), rule.id]);
      await sql('DELETE FROM recurring_occurrences');
      await sql("DELETE FROM transactions WHERE source = 'recurring'");
      const expected = planning.occurrencesBetween(anchor, 'weekly', back, today).length;
      expect((await cron()).status).toBe(200);
      expect((await call('GET', '/api/transactions?source=recurring', null, t)).body.summary.count).toBe(expected);
      await cron(); await cron();
      expect((await call('GET', '/api/transactions?source=recurring', null, t)).body.summary.count).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(3);
    });
    it('chế độ nhắc: chờ xác nhận → xác nhận (sửa số tiền) / bỏ qua', async () => {
      const { t, cat, cash } = await setup();
      const rule = (await call('POST', '/api/recurring', { kind: 'expense', amount: 260_000, wallet_id: cash.id, category_id: cat('Giải trí'), note: 'Netflix', frequency: 'monthly', start_date: today, mode: 'confirm' }, t)).body.rule;
      let ov = (await call('GET', '/api/recurring', null, t)).body;
      expect(ov.pending).toEqual([expect.objectContaining({ rule_id: rule.id, due_date: today, amount: 260_000 })]);
      expect((await call('GET', '/api/transactions?source=recurring', null, t)).body.summary.count).toBe(0);
      expect((await call('GET', '/api/summary', null, t)).body.alerts.map(a => a.kind)).toContain('recurring_pending');
      const c = await call('POST', `/api/recurring/${rule.id}/pending/${today}/confirm`, { amount: 270_000 }, t);
      expect(c.body.transaction).toMatchObject({ amount: 270_000, source: 'recurring' });
      expect((await call('POST', `/api/recurring/${rule.id}/pending/${today}/confirm`, {}, t)).status).toBe(404);
      ov = (await call('GET', '/api/recurring', null, t)).body;
      expect(ov.pending).toEqual([]);
      // Bỏ qua
      await sql('UPDATE recurring_rules SET next_date = $1 WHERE id = $2', [addDays(today, -1), rule.id]);
      await cron();
      expect((await call('POST', `/api/recurring/${rule.id}/pending/${addDays(today, -1)}/skip`, null, t)).status).toBe(200);
      expect((await call('GET', '/api/transactions?source=recurring', null, t)).body.summary.count).toBe(1);
    });
    it('tạm dừng, kết thúc, sắp tới 7 ngày, dự kiến tháng sau', async () => {
      const { t, cat, cash } = await setup();
      const tomorrow = addDays(today, 1);
      const rule = (await call('POST', '/api/recurring', { kind: 'income', amount: 15_000_000, wallet_id: cash.id, category_id: cat('Lương', 'income'), frequency: 'monthly', start_date: tomorrow }, t)).body.rule;
      const ov = (await call('GET', '/api/recurring', null, t)).body;
      expect(ov.upcoming[0]).toMatchObject({ rule_id: rule.id, date: tomorrow, amount: 15_000_000 });
      expect(ov.projection.income).toBe(15_000_000);
      expect((await call('GET', '/api/summary', null, t)).body.upcoming[0].date).toBe(tomorrow);
      expect((await call('PATCH', `/api/recurring/${rule.id}`, { active: false }, t)).body.rule.active).toBe(false);
      expect((await call('GET', '/api/recurring', null, t)).body.upcoming).toEqual([]);
      const ended = (await call('PATCH', `/api/recurring/${rule.id}`, { active: true, end_date: today }, t)).body.rule;
      expect(ended.end_date).toBe(today);
      await sql('UPDATE recurring_rules SET next_date = $1 WHERE id = $2', [today, rule.id]);
      await cron();
      const after = (await call('GET', '/api/recurring', null, t)).body.rules[0];
      expect(after.active).toBe(false);
      expect((await call('DELETE', `/api/recurring/${rule.id}`, null, t)).status).toBe(200);
    });
    it('dữ liệu sai bị chặn', async () => {
      const { t, cash, cat } = await setup();
      const base = { kind: 'expense', amount: 1000, wallet_id: cash.id, frequency: 'monthly', start_date: today };
      expect((await call('POST', '/api/recurring', { ...base, frequency: 'daily' }, t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { ...base, start_date: '2026-02-30' }, t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { ...base, start_date: '2026-13-45' }, t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { ...base, amount: 0 }, t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { ...base, category_id: cat('Lương', 'income') }, t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { ...base, end_date: addDays(today, -1) }, t)).status).toBe(400);
    });
  });

  describe('cron và quyền', () => {
    it('cron từ chối khi thiếu/sai CRON_SECRET, và khi chưa cấu hình CRON_SECRET', async () => {
      expect((await cron(null)).status).toBe(401);
      expect((await cron('sai')).status).toBe(401);
      const keep = config.CRON_SECRET;
      config.CRON_SECRET = '';
      expect((await cron('')).status).toBe(401);
      expect((await fetch(app.base + '/api/cron/daily', { headers: { Authorization: 'Bearer ' } })).status).toBe(401);
      config.CRON_SECRET = keep;
    });
    it('user B không đọc/sửa/xoá được ngân sách, mục tiêu, định kỳ của A', async () => {
      const a = await setup();
      const b = await setup();
      const bud = (await call('POST', '/api/budgets', { category_id: a.cat('Ăn uống'), amount: 1_000_000 }, a.t)).body.budget;
      const goal = (await call('POST', '/api/goals', { name: 'A', target_amount: 1000, deadline_month: thisMonth, wallet_id: a.cash.id }, a.t)).body.goal;
      const rule = (await call('POST', '/api/recurring', { kind: 'expense', amount: 1000, wallet_id: a.cash.id, frequency: 'monthly', start_date: addDays(today, 3), mode: 'confirm' }, a.t)).body.rule;
      expect((await call('GET', '/api/budgets/status', null, b.t)).body.budgets).toEqual([]);
      expect((await call('GET', '/api/goals', null, b.t)).body.goals).toEqual([]);
      expect((await call('GET', '/api/recurring', null, b.t)).body.rules).toEqual([]);
      expect((await call('PATCH', `/api/budgets/${bud.id}`, { amount: 1 }, b.t)).status).toBe(404);
      expect((await call('DELETE', `/api/budgets/${bud.id}`, null, b.t)).status).toBe(404);
      expect((await call('PATCH', `/api/goals/${goal.id}`, { name: 'x' }, b.t)).status).toBe(404);
      expect((await call('POST', `/api/goals/${goal.id}/contribute`, { from_wallet_id: b.cash.id, amount: 1 }, b.t)).status).toBe(404);
      expect((await call('DELETE', `/api/goals/${goal.id}`, null, b.t)).status).toBe(404);
      expect((await call('PATCH', `/api/recurring/${rule.id}`, { amount: 1 }, b.t)).status).toBe(404);
      expect((await call('DELETE', `/api/recurring/${rule.id}`, null, b.t)).status).toBe(404);
      expect((await call('POST', `/api/recurring/${rule.id}/pending/${today}/confirm`, {}, b.t)).status).toBe(404);
      // Dùng id của A trong dữ liệu của B
      expect((await call('POST', '/api/budgets', { category_id: a.cat('Ăn uống'), amount: 1 }, b.t)).status).toBe(400);
      expect((await call('POST', '/api/goals', { name: 'B', target_amount: 1, deadline_month: thisMonth, wallet_id: a.cash.id }, b.t)).status).toBe(400);
      expect((await call('POST', '/api/recurring', { kind: 'expense', amount: 1, wallet_id: a.cash.id, frequency: 'monthly', start_date: today }, b.t)).status).toBe(400);
      const g2 = (await call('POST', '/api/goals', { name: 'B', target_amount: 1000, deadline_month: thisMonth, wallet_id: b.cash.id }, b.t)).body.goal;
      expect((await call('POST', `/api/goals/${g2.id}/contribute`, { from_wallet_id: a.cash.id, amount: 1 }, b.t)).status).toBe(400);
    });
  });
});
