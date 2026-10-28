import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const time = require('../utils/time.js');
const { buildXlsx } = require('../utils/xlsx.js');
const { readSheet } = require('../utils/xlsx-read.js');

describe.skipIf(!TEST_DB)('Bảo mật và dữ liệu F08 (Postgres thật)', () => {
  let app, call;
  let seq = 0;
  const today = time.nowInTimezone().date;
  const thisMonth = time.currentMonth();
  const m = k => time.addMonths(thisMonth, -k);

  beforeAll(async () => { await setupDb(); app = await startApp(); call = app.call; });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => {
    await resetData();
    vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true });
  });

  async function user(pw = 'matkhau123') {
    const addr = `d${++seq}@vigon.vn`;
    const r = await call('POST', '/api/auth/register', { email: addr, password: pw, full_name: 'Dữ liệu' });
    return { t: r.body.token, email: addr, id: r.body.user.id };
  }
  async function download(path, token) {
    const res = await fetch(app.base + path, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
  // Dữ liệu mẫu đủ loại: nhiều ví (có thẻ tín dụng, ví ẩn), mục con, chuyển tiền, điều chỉnh, giao dịch đã xoá
  async function seed(t) {
    const cats = (await call('GET', '/api/categories', null, t)).body.categories;
    const cat = (n, k = 'expense') => cats.find(c => c.name === n && c.kind === k).id;
    const custom = (await call('POST', '/api/categories', { name: 'Trà sữa', kind: 'expense', parent_id: cat('Ăn uống'), icon: '🧋' }, t)).body.category;
    const cash = (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 2_000_000 }, t)).body.wallet;
    const bank = (await call('POST', '/api/wallets', { name: 'Techcombank', type: 'bank', opening_balance: 10_000_000 }, t)).body.wallet;
    const card = (await call('POST', '/api/wallets', { name: 'Thẻ VPBank', type: 'credit', opening_balance: -500_000, credit_limit: 20_000_000, due_day: 15 }, t)).body.wallet;
    const old = (await call('POST', '/api/wallets', { name: 'Ví cũ', type: 'ewallet', opening_balance: 50_000 }, t)).body.wallet;
    const add = b => call('POST', '/api/transactions', { kind: 'expense', wallet_id: cash.id, ...b }, t).then(x => { expect(x.status).toBe(201); return x.body.transaction; });
    for (let k = 3; k >= 0; k--) {
      const d = k ? `${m(k)}-10` : today;
      await add({ kind: 'income', amount: 15_000_000, wallet_id: bank.id, category_id: cat('Lương', 'income'), date: d });
      await add({ amount: 120_000 + k, category_id: cat('Đi chợ'), date: d, note: 'Đi chợ' });
      await add({ amount: 45_000, category_id: custom.id, date: d, note: 'Trà sữa' });
      await add({ amount: 990_000, category_id: cat('Mua sắm'), wallet_id: card.id, date: d });
    }
    await add({ amount: 33_000 });
    await call('POST', '/api/transfers', { from_wallet_id: bank.id, to_wallet_id: cash.id, amount: 3_000_000, date: `${m(1)}-20` }, t);
    await call('POST', `/api/wallets/${cash.id}/adjust`, { actual_balance: 4_000_000 }, t);
    const gone = await add({ amount: 777_777, note: 'đã xoá' });
    await call('DELETE', `/api/transactions/${gone.id}`, null, t);
    await add({ amount: 10_000, wallet_id: old.id });
    await call('POST', `/api/wallets/${old.id}/archive`, {}, t);
    // Kế hoạch
    await call('POST', '/api/budgets', { category_id: cat('Ăn uống'), amount: 4_000_000, rollover: true }, t);
    await call('POST', '/api/budgets', { amount: 9_000_000 }, t);
    await call('POST', '/api/goals', { name: 'Mua xe', target_amount: 50_000_000, deadline_month: time.addMonths(thisMonth, 10), wallet_id: bank.id }, t);
    await call('POST', '/api/recurring', { kind: 'expense', amount: 3_500_000, wallet_id: bank.id, category_id: cat('Thuê nhà'), note: 'Tiền nhà', frequency: 'monthly', start_date: time.addDays(today, 2), mode: 'confirm' }, t);
  }
  // "Dấu vân tay" để so 2 tài khoản: số dư từng ví (theo tên) + thu/chi từng tháng + chi theo danh mục
  async function fingerprint(t) {
    const w = (await call('GET', '/api/wallets?include_archived=1', null, t)).body.wallets
      .map(x => [x.name, x.type, x.balance, x.archived]).sort();
    const monthly = (await call('GET', '/api/reports/monthly?months=6', null, t)).body.months;
    const byCat = [];
    for (let k = 0; k < 4; k++) {
      const r = time.monthRange(m(k));
      const b = (await call('GET', `/api/reports/by-category?from=${r.from}&to=${r.to}`, null, t)).body;
      byCat.push([m(k), b.total, b.categories.map(c => [c.name, c.amount])]);
    }
    const total = (await call('GET', '/api/summary', null, t)).body.total_balance;
    const budgets = (await call('GET', '/api/budgets/status', null, t)).body.budgets.map(b => [b.name, b.limit, b.spent, b.rollover]);
    const goals = (await call('GET', '/api/goals', null, t)).body.goals.map(g => [g.name, g.target_amount, g.saved, g.deadline_month, g.wallet_name, g.status]);
    const rules = (await call('GET', '/api/recurring', null, t)).body.rules.map(r => [r.note, r.amount, r.schedule, r.mode, r.next_date, r.category_name, r.wallet_name]);
    return { w, monthly, byCat, total, budgets, goals, rules };
  }

  describe('xuất / nhập JSON', () => {
    it('nghiệm thu: xuất JSON rồi nhập vào tài khoản mới → số dư từng ví và báo cáo từng tháng giống hệt', async () => {
      const a = await user();
      await seed(a.t);
      const file = await download('/api/data/export.json', a.t);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toContain('vi-gon-sao-luu');
      const backup = JSON.parse(file.buf.toString('utf8'));
      expect(backup).toMatchObject({ format: 'vi-gon-backup', version: 1 });
      expect(backup.transactions.some(x => x.note === 'đã xoá')).toBe(false);

      const b = await user();
      const r = await call('POST', '/api/data/import.json', { backup }, b.t);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ wallets: 4, transactions: backup.transactions.length, budgets: 2, goals: 1, recurring: 1 });
      expect(await fingerprint(b.t)).toEqual(await fingerprint(a.t));
      // Danh mục mặc định được ghép, không nhân đôi; mục con tự tạo được tạo
      const cats = (await call('GET', '/api/categories', null, b.t)).body.categories;
      expect(cats.filter(c => c.name === 'Ăn uống')).toHaveLength(1);
      expect(cats.find(c => c.name === 'Trà sữa').icon).toBe('🧋');
      expect(r.body.categories_created).toBe(1);
      // Chuyển tiền vẫn là 1 cặp, xoá 1 đầu là xoá cả 2
      const tr = (await call('GET', '/api/transactions?kind=transfer', null, b.t)).body.transactions;
      expect(tr).toHaveLength(2);
      expect((await call('DELETE', `/api/transactions/${tr[0].id}`, null, b.t)).body.ids).toHaveLength(2);
      expect((await call('GET', '/api/me', null, b.t)).body.user.onboarded).toBe(true);
    });
    it('nhập vào tài khoản đã có ví cùng tên → thêm hậu tố (nhập), không ghép nhầm số dư', async () => {
      const a = await user();
      await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 100 }, a.t);
      const backup = JSON.parse((await download('/api/data/export.json', a.t)).buf);
      await call('POST', '/api/data/import.json', { backup }, a.t);
      const names = (await call('GET', '/api/wallets', null, a.t)).body.wallets.map(w => w.name);
      expect(names).toEqual(['Tiền mặt', 'Tiền mặt (nhập)']);
    });
    it('bản sao lưu sai bị từ chối, không ghi gì', async () => {
      const a = await user();
      await seed(a.t);
      const good = JSON.parse((await download('/api/data/export.json', a.t)).buf);
      const b = await user();
      const cases = [
        null, { format: 'khac' }, { ...good, version: 9 },
        { ...good, transactions: [{ ...good.transactions[0], amount: 1.5 }] },
        { ...good, transactions: [{ ...good.transactions[0], amount: -5 }] },
        { ...good, transactions: [{ ...good.transactions[0], wallet_ref: 'khong-co' }] },
        { ...good, transactions: good.transactions.filter(x => !x.transfer_ref).concat(good.transactions.filter(x => x.transfer_ref).slice(0, 1)) },
        { ...good, wallets: [{ ...good.wallets[0], opening_balance: 1e13 }], transactions: [] }
      ];
      for (const backup of cases) {
        const r = await call('POST', '/api/data/import.json', { backup }, b.t);
        expect(r.status).toBe(400);
      }
      expect((await call('GET', '/api/wallets', null, b.t)).body.wallets).toEqual([]);
      expect((await call('GET', '/api/transactions', null, b.t)).body.summary.count).toBe(0);
    });
    it('xuất chỉ chứa dữ liệu của chính mình', async () => {
      const a = await user();
      await seed(a.t);
      const b = await user();
      const mine = JSON.parse((await download('/api/data/export.json', b.t)).buf);
      expect(mine.wallets).toEqual([]);
      expect(mine.transactions).toEqual([]);
    });
  });

  describe('nhập Excel theo file mẫu', () => {
    const cols = ['Ngày', 'Loại', 'Số tiền', 'Danh mục', 'Ví', 'Ghi chú'].map(header => ({ header }));
    const toB64 = rows => buildXlsx({ columns: cols, rows }).toString('base64');

    it('tải file mẫu: đúng cột, đọc lại được', async () => {
      const a = await user();
      const f = await download('/api/data/template.xlsx', a.t);
      expect(f.status).toBe(200);
      const rows = readSheet(f.buf);
      expect(rows[0]).toMatchObject({ A: 'Ngày', B: 'Loại', C: 'Số tiền', D: 'Danh mục', E: 'Ví', F: 'Ghi chú' });
      expect(rows).toHaveLength(3);
    });
    it('nhập: khớp ví/danh mục theo tên không dấu, tạo cái chưa có, ngày Excel dạng số và chữ', async () => {
      const a = await user();
      await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 1_000_000 }, a.t);
      const d1 = `01/${m(1).slice(5)}/${m(1).slice(0, 4)}`;
      const serial = (Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8))) / 86400000) + 25569;
      const r = await call('POST', '/api/data/import.xlsx', { file: toB64([
        [d1, 'Chi', 45000, 'an uong', 'TIEN MAT', 'Phở'],
        [serial, 'thu', '15.000.000', 'Lương', 'Tiền mặt', ''],
        [d1, '', -30000, 'Cà phê', 'MoMo', 'không có Loại, số âm → Chi'],
        [d1, 'Chi', 20000, 'Đồ chơi mèo', 'Tiền mặt', 'danh mục mới']
      ]) }, a.t);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ transactions: 4, created_wallets: ['MoMo'], created_categories: ['Đồ chơi mèo'] });
      const list = (await call('GET', '/api/transactions', null, a.t)).body.transactions;
      expect(list.map(x => [x.kind, x.amount, x.category_name, x.wallet_name, x.source]).sort()).toEqual([
        ['expense', 20000, 'Đồ chơi mèo', 'Tiền mặt', 'import'],
        ['expense', 30000, 'Cà phê', 'MoMo', 'import'],
        ['expense', 45000, 'Ăn uống', 'Tiền mặt', 'import'],
        ['income', 15000000, 'Lương', 'Tiền mặt', 'import']
      ].sort());
      expect(time.toLocalDateHour(list.find(x => x.kind === 'income').occurred_at).date).toBe(today);
    });
    it('có dòng lỗi → không nhập dòng nào, báo số dòng lỗi', async () => {
      const a = await user();
      const r = await call('POST', '/api/data/import.xlsx', { file: toB64([
        [today.split('-').reverse().join('/'), 'Chi', 45000, 'Ăn uống', 'Tiền mặt', 'đúng'],
        ['32/13/2026', 'Chi', 45000, '', 'Tiền mặt', ''],
        ['01/01/2999', 'Chi', 1000, '', 'Tiền mặt', ''],
        ['01/01/2026', 'Chuyển', 1000, '', 'Tiền mặt', ''],
        ['01/01/2026', 'Chi', 1.5, '', 'Tiền mặt', ''],
        ['01/01/2026', 'Chi', 1000, '', '', '']
      ]) }, a.t);
      expect(r.status).toBe(400);
      expect(r.body.errors.map(e => e.row)).toEqual([3, 4, 5, 6, 7]);
      expect((await call('GET', '/api/transactions', null, a.t)).body.summary.count).toBe(0);
      expect((await call('GET', '/api/wallets', null, a.t)).body.wallets).toEqual([]);
    });
    it('file không phải Excel / thiếu cột → báo lỗi dễ hiểu', async () => {
      const a = await user();
      expect((await call('POST', '/api/data/import.xlsx', { file: Buffer.from('xin chào').toString('base64') }, a.t)).status).toBe(400);
      const noWallet = buildXlsx({ columns: [{ header: 'Ngày' }, { header: 'Số tiền' }], rows: [['01/01/2026', 1000]] }).toString('base64');
      const r = await call('POST', '/api/data/import.xlsx', { file: noWallet }, a.t);
      expect(r.status).toBe(400);
      expect(r.body.errors[0].error).toContain('Ví');
    });
  });

  describe('PIN khoá app', () => {
    it('đặt PIN cần mật khẩu; PIN lưu dạng băm; mở khoá đúng/sai', async () => {
      const a = await user();
      expect((await call('POST', '/api/me/pin', { pin: '1234' }, a.t)).status).toBe(403);
      expect((await call('POST', '/api/me/pin', { pin: '12', password: 'matkhau123' }, a.t)).status).toBe(400);
      expect((await call('POST', '/api/me/pin', { pin: '1234567', password: 'matkhau123' }, a.t)).status).toBe(400);
      const set = await call('POST', '/api/me/pin', { pin: '2468', password: 'matkhau123' }, a.t);
      expect(set.body.user.has_pin).toBe(true);
      const { rows } = await sql('SELECT pin_hash FROM users WHERE id = $1', [a.id]);
      expect(rows[0].pin_hash).toMatch(/^\$2[aby]\$/);
      expect((await call('POST', '/api/me/pin/verify', { pin: '2468' }, a.t)).status).toBe(200);
      expect((await call('POST', '/api/me/pin/verify', { pin: '0000' }, a.t)).status).toBe(403);
    });
    it('sai PIN 5 lần → thu hồi mọi phiên, phải đăng nhập lại bằng mật khẩu', async () => {
      const a = await user();
      await call('POST', '/api/me/pin', { pin: '2468', password: 'matkhau123' }, a.t);
      for (let i = 0; i < 4; i++) expect((await call('POST', '/api/me/pin/verify', { pin: '1111' }, a.t)).status).toBe(403);
      const fifth = await call('POST', '/api/me/pin/verify', { pin: '1111' }, a.t);
      expect(fifth.status).toBe(401);
      expect(fifth.body.signed_out).toBe(true);
      expect((await call('GET', '/api/me', null, a.t)).status).toBe(401);
      const again = await call('POST', '/api/auth/login', { email: a.email, password: 'matkhau123' });
      expect(again.status).toBe(200);
      expect((await call('POST', '/api/me/pin/verify', { pin: '2468' }, again.body.token)).status).toBe(200);
    });
    it('gỡ PIN cần mật khẩu', async () => {
      const a = await user();
      await call('POST', '/api/me/pin', { pin: '2468', password: 'matkhau123' }, a.t);
      expect((await call('DELETE', '/api/me/pin', { password: 'sai' }, a.t)).status).toBe(403);
      expect((await call('DELETE', '/api/me/pin', { password: 'matkhau123' }, a.t)).body.user.has_pin).toBe(false);
    });
  });

  describe('đổi email, giao diện', () => {
    it('đổi email cần mật khẩu; email mới phải xác minh lại; không trùng tài khoản khác', async () => {
      const a = await user();
      const b = await user();
      expect((await call('POST', '/api/me/email', { email: 'moi@vigon.vn', password: 'sai' }, a.t)).status).toBe(403);
      expect((await call('POST', '/api/me/email', { email: b.email, password: 'matkhau123' }, a.t)).status).toBe(409);
      const r = await call('POST', '/api/me/email', { email: 'Moi@Vigon.vn', password: 'matkhau123' }, a.t);
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ email: 'moi@vigon.vn', email_verified: false });
      expect(email.sendVerifyEmail).toHaveBeenLastCalledWith('moi@vigon.vn', expect.any(String), 'Dữ liệu');
      expect((await call('POST', '/api/auth/login', { email: 'moi@vigon.vn', password: 'matkhau123' })).status).toBe(200);
    });
    it('chọn giao diện sáng / tối / theo máy', async () => {
      const a = await user();
      for (const theme of ['light', 'dark', 'system']) {
        expect((await call('PATCH', '/api/me', { theme }, a.t)).body.user.theme).toBe(theme);
      }
    });
  });

  describe('xoá tài khoản', () => {
    it('cần mật khẩu + gõ XOA; xoá cứng mọi bản ghi của người đó, người khác không ảnh hưởng', async () => {
      const a = await user();
      const b = await user();
      await seed(a.t);
      await seed(b.t);
      await call('POST', '/api/auth/login', { email: a.email, password: 'sai' });
      await call('POST', '/api/me/pin', { pin: '2468', password: 'matkhau123' }, a.t);
      await call('POST', '/api/me/pin/verify', { pin: '0000' }, a.t);
      expect((await call('DELETE', '/api/me', { password: 'sai', confirm: 'XOA' }, a.t)).status).toBe(403);
      expect((await call('DELETE', '/api/me', { password: 'matkhau123' }, a.t)).status).toBe(400);
      const before = await fingerprint(b.t);
      expect((await call('DELETE', '/api/me', { password: 'matkhau123', confirm: 'XOA' }, a.t)).status).toBe(200);

      // Không còn bản ghi nào của A ở mọi bảng
      const one = async (q, p) => (await sql(q, p)).rows[0].n;
      expect(await one('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [a.id])).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM books WHERE owner_id = $1', [a.id])).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM book_members WHERE user_id = $1', [a.id])).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM email_tokens WHERE user_id = $1', [a.id])).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1 OR book_id NOT IN (SELECT id FROM books)', [a.id])).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM wallets WHERE book_id NOT IN (SELECT id FROM books)')).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM categories WHERE book_id NOT IN (SELECT id FROM books)')).toBe(0);
      expect(await one('SELECT COUNT(*)::int AS n FROM login_attempts WHERE email = $1', [a.email])).toBe(0);
      expect(await one("SELECT COUNT(*)::int AS n FROM rate_limits WHERE key LIKE $1", [`%:${a.id}`])).toBe(0);

      expect((await call('GET', '/api/me', null, a.t)).status).toBe(401);
      expect((await call('POST', '/api/auth/login', { email: a.email, password: 'matkhau123' })).status).toBe(401);
      expect(await fingerprint(b.t)).toEqual(before);
      // Đăng ký lại được bằng email cũ, tài khoản trống
      const again = await call('POST', '/api/auth/register', { email: a.email, password: 'matkhau123' });
      expect(again.status).toBe(201);
      expect((await call('GET', '/api/wallets', null, again.body.token)).body.wallets).toEqual([]);
    });
  });
});
