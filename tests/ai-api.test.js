import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const time = require('../utils/time.js');

describe.skipIf(!TEST_DB)('Trợ lý AI: số liệu tóm tắt (Postgres thật)', () => {
  let app, call, seq = 0;
  beforeAll(async () => { await setupDb(); app = await startApp(); call = app.call; });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => { await resetData(); vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true }); });

  it('gom số dư, thu chi tháng này, trung bình các tháng trước theo danh mục, mục tiêu; chỉ của sổ mình', async () => {
    const r = await call('POST', '/api/auth/register', { email: `ai${++seq}@vigon.vn`, password: 'matkhau123' });
    const t = r.body.token;
    const w = (await call('POST', '/api/wallets', { name: 'Techcombank', type: 'bank', opening_balance: 20_000_000 }, t)).body.wallet;
    const cats = (await call('GET', '/api/categories', null, t)).body.categories;
    const cat = n => cats.find(c => c.name === n).id;
    const month = time.currentMonth();
    const prev = time.addMonths(month, -1);
    // Tháng trước: chi Đi chợ (mục con của Ăn uống) 3.000.000, Xăng 500.000; lương 15.000.000
    const at = (m, d) => new Date(`${m}-${d}T12:00:00+07:00`).toISOString();
    await sql(`INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, source) SELECT w.book_id, $1, w.id, $3, 'expense', 3000000, $4, 'manual' FROM wallets w WHERE w.id = $2`, [r.body.user.id, w.id, cat('Đi chợ'), at(prev, '10')]);
    await sql(`INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, source) SELECT w.book_id, $1, w.id, $3, 'expense', 500000, $4, 'manual' FROM wallets w WHERE w.id = $2`, [r.body.user.id, w.id, cat('Xăng'), at(prev, '12')]);
    await sql(`INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, source) SELECT w.book_id, $1, w.id, $3, 'income', 15000000, $4, 'manual' FROM wallets w WHERE w.id = $2`, [r.body.user.id, w.id, cat('Lương'), at(prev, '05')]);
    await call('POST', '/api/transactions', { kind: 'expense', amount: 200_000, wallet_id: w.id, category_id: cat('Ăn uống') }, t);
    // Người khác không lọt vào
    const o = await call('POST', '/api/auth/register', { email: `khac${++seq}@vigon.vn`, password: 'matkhau123' });
    await call('POST', '/api/wallets', { name: 'Khác', type: 'cash', opening_balance: 99_000_000 }, o.body.token);

    const res = await call('GET', '/api/ai/context', null, t);
    expect(res.status).toBe(200);
    const c = res.body.context;
    expect(c.total_balance).toBe(20_000_000 - 3_500_000 + 15_000_000 - 200_000);
    expect(c.this_month).toEqual({ income: 0, expense: 200_000 });
    expect(c.history_months).toBe(1);
    expect(c.avg_month).toEqual({ income: 15_000_000, expense: 3_500_000 });
    expect(c.avg_by_category).toEqual([{ name: 'Ăn uống', amount: 3_000_000 }, { name: 'Đi lại', amount: 500_000 }]);
    expect(c.expense_categories).toContain('Ăn uống');
    expect(c.wallets).toEqual([{ name: 'Techcombank', type: 'bank', balance: c.total_balance }]);
    expect(res.body.context.days_left).toBeGreaterThan(0);
  });

  it('cần đăng nhập', async () => {
    expect((await call('GET', '/api/ai/context')).status).toBe(401);
  });
});
