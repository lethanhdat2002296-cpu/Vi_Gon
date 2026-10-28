import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const time = require('../utils/time.js');
const { readSheet } = require('../utils/xlsx-read.js');

describe.skipIf(!TEST_DB)('Tổng quan, Sổ, Báo cáo, Excel (Postgres thật)', () => {
  let app, call;
  let seq = 0;
  const thisMonth = time.currentMonth();
  const today = time.nowInTimezone().date;
  const lastMonth = time.addMonths(thisMonth, -1);

  beforeAll(async () => {
    await setupDb();
    app = await startApp();
    call = app.call;
  });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => {
    await resetData();
    vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true });
  });

  async function setup() {
    const r = await call('POST', '/api/auth/register', { email: `r${++seq}@vigon.vn`, password: 'matkhau123' });
    const t = r.body.token;
    const cats = (await call('GET', '/api/categories', null, t)).body.categories;
    const cat = (name, kind = 'expense') => cats.find(c => c.name === name && c.kind === kind).id;
    const cash = (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 5_000_000 }, t)).body.wallet;
    const bank = (await call('POST', '/api/wallets', { name: 'Techcombank', type: 'bank', opening_balance: 10_000_000 }, t)).body.wallet;
    const add = (body) => call('POST', '/api/transactions', { kind: 'expense', wallet_id: cash.id, ...body }, t).then(x => { expect(x.status).toBe(201); return x.body.transaction; });
    return { t, cat, cash, bank, add };
  }

  async function download(path, token) {
    // fetch trực tiếp để lấy Buffer
    const res = await fetch(app.base + path, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  }

  describe('tìm kiếm không dấu (F04)', () => {
    it('nghiệm thu: gõ "grab" ra mọi giao dịch có Grab, không phân biệt hoa thường và dấu', async () => {
      const { t, add, cat } = await setup();
      await add({ amount: 35_000, note: 'Grab đi làm' });
      await add({ amount: 42_000, note: 'GRAB về nhà' });
      await add({ amount: 18_000, note: 'gráb bike' });
      await add({ amount: 50_000, note: 'Ăn sáng' });
      await add({ amount: 60_000, note: '', category_id: cat('Grab, taxi') });
      const r = await call('GET', '/api/transactions?q=grab', null, t);
      expect(r.body.transactions.map(x => x.amount).sort((a, b) => a - b)).toEqual([18_000, 35_000, 42_000, 60_000]);
      expect(r.body.summary.count).toBe(4);
    });
    it('gõ không dấu tìm được chữ có dấu (kể cả đ)', async () => {
      const { t, add } = await setup();
      await add({ amount: 1000, note: 'Đi chợ Bến Thành' });
      await add({ amount: 2000, note: 'Cà phê sữa đá' });
      expect((await call('GET', '/api/transactions?q=di%20cho', null, t)).body.transactions.map(x => x.amount)).toEqual([1000]);
      expect((await call('GET', '/api/transactions?q=SUA%20DA', null, t)).body.transactions.map(x => x.amount)).toEqual([2000]);
      expect((await call('GET', '/api/transactions?q=%25', null, t)).body.transactions).toEqual([]);
    });
    it('tìm theo số tiền (45k, 45.000, 45000)', async () => {
      const { t, add } = await setup();
      await add({ amount: 45_000, note: 'Bún bò' });
      await add({ amount: 450_000, note: 'Khác' });
      for (const q of ['45k', '45.000', '45000']) {
        expect((await call('GET', `/api/transactions?q=${encodeURIComponent(q)}`, null, t)).body.transactions.map(x => x.amount)).toEqual([45_000]);
      }
    });
  });

  describe('bộ lọc Sổ (F04)', () => {
    it('lọc theo thời gian, ví, danh mục (gồm mục con), loại, nguồn', async () => {
      const { t, add, cat, cash, bank } = await setup();
      await add({ amount: 1000, category_id: cat('Cà phê'), date: `${lastMonth}-15` });
      await add({ amount: 2000, category_id: cat('Ăn uống') });
      await add({ amount: 3000, category_id: cat('Đi lại'), wallet_id: bank.id });
      await call('POST', '/api/transactions', { kind: 'income', amount: 9000, wallet_id: bank.id, category_id: cat('Lương', 'income') }, t);
      await call('POST', '/api/transfers', { from_wallet_id: bank.id, to_wallet_id: cash.id, amount: 500 }, t);
      await call('POST', `/api/wallets/${cash.id}/adjust`, { actual_balance: 1 }, t);
      const get = async qs => (await call('GET', '/api/transactions?' + qs, null, t)).body;
      const amounts = b => b.transactions.map(x => x.amount).sort((a, b2) => a - b2);

      const mb = time.monthRange(thisMonth);
      expect(amounts(await get(`from=${lastMonth}-01&to=${lastMonth}-28`))).toEqual([1000]);
      expect((await get(`from=${mb.from}&to=${mb.to}`)).summary.count).toBe(6);
      expect(amounts(await get(`category=${cat('Ăn uống')}`))).toEqual([1000, 2000]);
      expect(amounts(await get(`wallet=${bank.id}&kind=expense`))).toEqual([3000]);
      expect(amounts(await get('kind=transfer'))).toEqual([500, 500]);
      expect(amounts(await get('kind=income'))).toEqual([9000]);
      expect((await get('source=adjust')).transactions).toHaveLength(1);
      const all = await get('');
      // Tổng thu/chi của Sổ không tính chuyển tiền (có tính điều chỉnh vì là giao dịch thật trong ví)
      expect(all.summary.count).toBe(7);
      expect(all.summary.income).toBe(9000);
      expect((await call('GET', '/api/transactions?kind=abc', null, t)).status).toBe(400);
    });
    it('phân trang 50 dòng/lần', async () => {
      const { t, cash } = await setup();
      const rows = Array.from({ length: 60 }, (_, i) => `(${'$1'}, ${'$2'}, 'expense', ${i + 1}, NOW() - INTERVAL '${i} minutes')`);
      const book = (await sql('SELECT book_id FROM wallets WHERE id = $1', [cash.id])).rows[0].book_id;
      await sql(`INSERT INTO transactions (book_id, wallet_id, kind, amount, occurred_at) VALUES ${rows.join(',')}`, [book, cash.id]);
      const p1 = await call('GET', '/api/transactions', null, t);
      expect(p1.body.transactions).toHaveLength(50);
      expect(p1.body.summary.count).toBe(60);
      const p2 = await call('GET', `/api/transactions?cursor=${encodeURIComponent(p1.body.next_cursor)}`, null, t);
      expect(p2.body.transactions).toHaveLength(10);
      expect(p2.body.next_cursor).toBeNull();
    });
  });

  describe('Tổng quan (F02)', () => {
    it('nghiệm thu: thêm chi 50.000 thì số dư, tổng chi, danh sách gần nhất cập nhật ngay', async () => {
      const { t, add, cat } = await setup();
      const before = (await call('GET', '/api/summary', null, t)).body;
      expect(before).toMatchObject({ month: thisMonth, is_current: true, next_month: null, total_balance: 15_000_000, expense: 0 });
      await add({ amount: 50_000, category_id: cat('Ăn uống') });
      const after = (await call('GET', '/api/summary', null, t)).body;
      expect(after.total_balance).toBe(14_950_000);
      expect(after.expense).toBe(50_000);
      expect(after.recent[0]).toMatchObject({ amount: 50_000, category_name: 'Ăn uống' });
    });
    it('chuyển giữa ví và điều chỉnh không tính là thu/chi; thẻ tín dụng âm cộng vào tổng; ví ẩn bị bỏ', async () => {
      const { t, cash, bank } = await setup();
      await call('POST', '/api/transfers', { from_wallet_id: bank.id, to_wallet_id: cash.id, amount: 2_000_000 }, t);
      await call('POST', `/api/wallets/${cash.id}/adjust`, { actual_balance: 6_000_000 }, t);
      const card = (await call('POST', '/api/wallets', { name: 'Thẻ', type: 'credit', opening_balance: -1_000_000 }, t)).body.wallet;
      const hidden = (await call('POST', '/api/wallets', { name: 'Ẩn', type: 'cash', opening_balance: 777 }, t)).body.wallet;
      await call('POST', `/api/wallets/${hidden.id}/archive`, {}, t);
      const s = (await call('GET', '/api/summary', null, t)).body;
      expect(s.income).toBe(0);
      expect(s.expense).toBe(0);
      expect(s.total_balance).toBe(6_000_000 + 8_000_000 - 1_000_000);
      void card;
    });
    it('đổi tháng: tháng trước có số riêng; không cho xem tháng tương lai', async () => {
      const { t, add } = await setup();
      await add({ amount: 10_000, date: `${lastMonth}-10` });
      await add({ amount: 20_000 });
      const prev = (await call('GET', `/api/summary?month=${lastMonth}`, null, t)).body;
      expect(prev).toMatchObject({ month: lastMonth, is_current: false, next_month: thisMonth, expense: 10_000 });
      expect((await call('GET', `/api/summary?month=${time.addMonths(thisMonth, 1)}`, null, t)).status).toBe(400);
      expect((await call('GET', '/api/summary?month=2026-13', null, t)).status).toBe(400);
    });
    it('cảnh báo ví âm', async () => {
      const { t, add } = await setup();
      await add({ amount: 6_000_000 });
      const s = (await call('GET', '/api/summary', null, t)).body;
      expect(s.alerts.map(a => a.kind)).toContain('overdraft');
    });
  });

  describe('Báo cáo (F07)', () => {
    it('nghiệm thu: tổng biểu đồ tròn = tổng chi trên Tổng quan cùng kỳ', async () => {
      const { t, add, cat, cash, bank } = await setup();
      await add({ amount: 120_000, category_id: cat('Đi chợ') });
      await add({ amount: 30_000, category_id: cat('Cà phê') });
      await add({ amount: 200_000, category_id: cat('Điện') });
      await add({ amount: 15_000 });
      await call('POST', '/api/transfers', { from_wallet_id: cash.id, to_wallet_id: bank.id, amount: 1_000_000 }, t);
      await call('POST', `/api/wallets/${bank.id}/adjust`, { actual_balance: 1 }, t);
      const s = (await call('GET', '/api/summary', null, t)).body;
      const r = (await call('GET', '/api/reports/by-category', null, t)).body;
      expect(r.total).toBe(s.expense);
      expect(r.total).toBe(365_000);
      expect(r.categories.reduce((x, c) => x + c.amount, 0)).toBe(r.total);
      // Mục con cộng vào cha
      expect(r.categories.map(c => [c.name, c.amount])).toEqual([['Nhà ở', 200_000], ['Ăn uống', 150_000], ['Chưa phân loại', 15_000]]);
      expect(r.partial).toBe(true);
      expect(r.categories[0].share).toBeCloseTo(200_000 / 365_000, 3);
    });
    it('nghiệm thu F06: gộp "Cà phê" vào "Ăn uống" → báo cáo tháng đúng', async () => {
      const { t, add, cat } = await setup();
      await add({ amount: 30_000, category_id: cat('Cà phê') });
      await add({ amount: 70_000, category_id: cat('Đi chợ') });
      const before = (await call('GET', '/api/reports/by-category', null, t)).body;
      await call('POST', `/api/categories/${cat('Cà phê')}/merge`, { into: cat('Ăn uống') }, t);
      const after = (await call('GET', '/api/reports/by-category', null, t)).body;
      expect(after.total).toBe(before.total);
      expect(after.categories).toEqual([expect.objectContaining({ name: 'Ăn uống', amount: 100_000 })]);
    });
    it('so với kỳ trước + lọc theo ví', async () => {
      const { t, add, cat, bank } = await setup();
      await add({ amount: 100_000, category_id: cat('Ăn uống'), date: `${lastMonth}-05` });
      await add({ amount: 150_000, category_id: cat('Ăn uống') });
      await add({ amount: 99_000, category_id: cat('Ăn uống'), wallet_id: bank.id });
      const r = (await call('GET', '/api/reports/by-category', null, t)).body;
      expect(r.categories[0]).toMatchObject({ name: 'Ăn uống', amount: 249_000, prev_amount: 100_000, change: 149_000 });
      expect(r.prev_total).toBe(100_000);
      const onlyBank = (await call('GET', `/api/reports/by-category?wallet=${bank.id}`, null, t)).body;
      expect(onlyBank.total).toBe(99_000);
    });
    it('thu/chi 6 tháng, tháng đang chạy đánh dấu partial', async () => {
      const { t, add, cat, bank } = await setup();
      await add({ amount: 10_000, date: `${lastMonth}-10` });
      await add({ amount: 20_000 });
      await call('POST', '/api/transactions', { kind: 'income', amount: 500_000, wallet_id: bank.id, category_id: cat('Lương', 'income') }, t);
      const r = (await call('GET', '/api/reports/monthly?months=6', null, t)).body.months;
      expect(r).toHaveLength(6);
      expect(r[5]).toMatchObject({ month: thisMonth, income: 500_000, expense: 20_000, partial: true });
      expect(r[4]).toMatchObject({ month: lastMonth, expense: 10_000, partial: false });
      expect(r[0].month).toBe(time.addMonths(thisMonth, -5));
    });
  });

  describe('xuất Excel (F04)', () => {
    it('nghiệm thu: file có đúng số dòng và tổng như trên màn hình (cùng bộ lọc)', async () => {
      const { t, add, cat, cash, bank } = await setup();
      await add({ amount: 35_000, note: 'Grab đi làm', category_id: cat('Grab, taxi') });
      await add({ amount: 42_000, note: 'GRAB về <nhà> & "quê"' });
      await add({ amount: 50_000, note: 'Ăn sáng' });
      await call('POST', '/api/transactions', { kind: 'income', amount: 1_000_000, wallet_id: bank.id, category_id: cat('Lương', 'income') }, t);
      await call('POST', '/api/transfers', { from_wallet_id: bank.id, to_wallet_id: cash.id, amount: 300_000 }, t);

      for (const qs of ['', 'q=grab', `wallet=${bank.id}`, `from=${today}&to=${today}`]) {
        const screen = (await call('GET', '/api/transactions?' + qs, null, t)).body.summary;
        const file = await download('/api/export.xlsx?' + qs, t);
        expect(file.status).toBe(200);
        expect(file.headers.get('content-type')).toContain('spreadsheetml');
        const rows = readSheet(file.buf);
        const data = rows.filter(r => r._r >= 2 && r._r <= screen.count + 1);
        expect(data).toHaveLength(screen.count);
        const footer = Object.fromEntries(rows.filter(r => r._r > screen.count + 1).map(r => [r.A, r.D]));
        expect(footer['Số giao dịch']).toBe(screen.count);
        expect(footer['Tổng thu']).toBe(screen.income);
        expect(footer['Tổng chi']).toBe(screen.expense ? -screen.expense : 0);
      }
      const grab = readSheet((await download('/api/export.xlsx?q=grab', t)).buf);
      expect(grab[0]).toMatchObject({ A: 'Ngày', D: 'Số tiền (₫)', I: 'Ghi chú' });
      expect(grab.map(r => r.I)).toContain('GRAB về <nhà> & "quê"');
      expect(grab.find(r => r.I === 'Grab đi làm')).toMatchObject({ C: 'Chi', D: -35_000, E: 'Grab, taxi', F: 'Đi lại', G: 'Tiền mặt' });
    });
    it('chưa đăng nhập không tải được; người khác không thấy dữ liệu', async () => {
      const a = await setup();
      await a.add({ amount: 1234, note: 'bí mật' });
      const b = await setup();
      expect((await download('/api/export.xlsx', 'sai')).status).toBe(401);
      const rows = readSheet((await download('/api/export.xlsx', b.t)).buf);
      expect(rows.some(r => r.I === 'bí mật')).toBe(false);
      expect((await call('GET', '/api/reports/by-category', null, b.t)).body.total).toBe(0);
      expect((await call('GET', '/api/summary', null, b.t)).body.recent).toEqual([]);
      expect((await call('GET', '/api/transactions?q=bi%20mat', null, b.t)).body.transactions).toEqual([]);
    });
  });
});
