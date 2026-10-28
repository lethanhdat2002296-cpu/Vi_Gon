import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const config = require('../config.js');
const time = require('../utils/time.js');

describe.skipIf(!TEST_DB)('Dùng chung F14–F16 (Postgres thật)', () => {
  let app, call;
  let seq = 0;
  const today = time.nowInTimezone().date;

  beforeAll(async () => { await setupDb(); app = await startApp(); call = app.call; });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => {
    await resetData();
    vi.restoreAllMocks();
    vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true });
    config.CRON_SECRET = 'bi-mat-cron-test-0123456789';
  });

  async function user(name) {
    const r = await call('POST', '/api/auth/register', { email: `${name.toLowerCase()}${++seq}@vigon.vn`, password: 'matkhau123', full_name: name });
    expect(r.status).toBe(201);
    await sql('UPDATE users SET email_verified_at = NOW(), full_name = $2 WHERE id = $1', [r.body.user.id, name]);
    return { t: r.body.token, id: r.body.user.id, email: r.body.user.email };
  }
  async function familyBook() {
    const chong = await user('Dat');
    const vo = await user('Ha');
    const b = await call('POST', '/api/books', { name: 'Sổ gia đình' }, chong.t);
    expect(b.status).toBe(201);
    const book = b.body.book.id;
    const inv = await call('POST', `/api/books/${book}/invites`, { role: 'editor' }, chong.t);
    expect(inv.status).toBe(201);
    const token = inv.body.link.split('/join/')[1];
    expect((await call('POST', `/api/invites/${token}/accept`, {}, vo.t)).status).toBe(200);
    return { chong, vo, book, as: u => ({ token: u.t, book }) };
  }

  describe('F14 sổ chung', () => {
    it('nghiệm thu: vợ ghi khoản chi, chồng mở app thấy ngay, tổng sổ tăng đúng', async () => {
      const f = await familyBook();
      const w = (await call('POST', '/api/wallets', { name: 'Quỹ chung', type: 'cash', opening_balance: 5_000_000 }, f.as(f.chong))).body.wallet;
      const cats = (await call('GET', '/api/categories', null, f.as(f.vo))).body.categories;
      const an = cats.find(c => c.name === 'Ăn uống' && c.kind === 'expense');
      const before = (await call('GET', '/api/summary', null, f.as(f.chong))).body;
      expect(before.total_balance).toBe(5_000_000);
      const tx = await call('POST', '/api/transactions', { kind: 'expense', amount: 350_000, wallet_id: w.id, category_id: an.id, note: 'Đi chợ' }, f.as(f.vo));
      expect(tx.status).toBe(201);
      const after = (await call('GET', '/api/summary', null, f.as(f.chong))).body;
      expect(after.total_balance).toBe(4_650_000);
      expect(after.expense).toBe(before.expense + 350_000);
      expect(after.book).toMatchObject({ id: f.book, kind: 'shared', role: 'owner' });
      // Hiện ai ghi
      const list = (await call('GET', '/api/transactions', null, f.as(f.chong))).body.transactions;
      expect(list[0].recorded_by).toBe('Ha');
      // Sổ cá nhân của chồng không bị ảnh hưởng
      expect((await call('GET', '/api/summary', null, f.chong.t)).body.total_balance).toBe(0);
      // Báo cáo theo người
      const bm = (await call('GET', '/api/reports/by-member', null, f.as(f.chong))).body.members;
      expect(bm).toEqual([expect.objectContaining({ name: 'Ha', expense: 350_000 })]);
    });

    it('chỉ người ghi hoặc chủ sổ sửa/xoá được', async () => {
      const f = await familyBook();
      const w = (await call('POST', '/api/wallets', { name: 'Quỹ', type: 'cash' }, f.as(f.chong))).body.wallet;
      const own = (await call('POST', '/api/transactions', { kind: 'expense', amount: 10_000, wallet_id: w.id }, f.as(f.chong))).body.transaction;
      const hers = (await call('POST', '/api/transactions', { kind: 'expense', amount: 20_000, wallet_id: w.id }, f.as(f.vo))).body.transaction;
      expect((await call('PATCH', `/api/transactions/${own.id}`, { amount: 1000 }, f.as(f.vo))).status).toBe(403);
      expect((await call('DELETE', `/api/transactions/${own.id}`, null, f.as(f.vo))).status).toBe(403);
      expect((await call('PATCH', `/api/transactions/${hers.id}`, { amount: 25_000 }, f.as(f.vo))).status).toBe(200);
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
      expect((await call('PUT', `/api/transactions/${own.id}/receipt`, { data: png }, f.as(f.vo))).status).toBe(403);
      expect((await call('PUT', `/api/transactions/${hers.id}/receipt`, { data: png }, f.as(f.vo))).status).toBe(200);
      expect((await call('DELETE', `/api/transactions/${hers.id}`, null, f.as(f.chong))).status).toBe(200);
    });

    it('nghiệm thu: người xem không gọi được API ghi', async () => {
      const f = await familyBook();
      const xem = await user('Ba');
      const inv = await call('POST', `/api/books/${f.book}/invites`, { role: 'viewer', email: xem.email }, f.chong.t);
      await call('POST', `/api/invites/${inv.body.link.split('/join/')[1]}/accept`, {}, xem.t);
      const w = (await call('POST', '/api/wallets', { name: 'Quỹ', type: 'cash' }, f.as(f.chong))).body.wallet;
      const as = { token: xem.t, book: f.book };
      expect((await call('GET', '/api/summary', null, as)).body.book.role).toBe('viewer');
      expect((await call('GET', '/api/transactions', null, as)).status).toBe(200);
      for (const [m, p, body] of [
        ['POST', '/api/transactions', { kind: 'expense', amount: 1000, wallet_id: w.id }],
        ['POST', '/api/wallets', { name: 'X', type: 'cash' }],
        ['POST', '/api/categories', { name: 'X', kind: 'expense' }],
        ['POST', '/api/transfers', { from_wallet_id: w.id, to_wallet_id: w.id, amount: 1000 }],
        ['POST', '/api/budgets', { limit: 100000 }],
        ['POST', '/api/debts', { direction: 'lend', person: 'Nam', amount: 1000 }],
        ['POST', '/api/data/import.json', {}]
      ]) {
        expect((await call(m, p, body, as)).status, `${m} ${p}`).toBe(403);
      }
    });

    it('không phải thành viên thì không mở được sổ', async () => {
      const f = await familyBook();
      const la = await user('La');
      expect((await call('GET', '/api/transactions', null, { token: la.t, book: f.book })).status).toBe(403);
      expect((await call('GET', '/api/summary', null, { token: la.t, book: 'abc' })).status).toBe(400);
      expect((await call('GET', `/api/books/${f.book}/members`, null, la.t)).status).toBe(404);
    });

    it('lời mời: dùng 1 lần, hết hạn 7 ngày, mời qua email chỉ đúng người nhận được', async () => {
      const f = await familyBook();
      const a = await user('A'), b = await user('B');
      const sent = vi.spyOn(email, 'sendInvite').mockResolvedValue({ ok: true });
      const inv = await call('POST', `/api/books/${f.book}/invites`, { email: a.email }, f.chong.t);
      expect(inv.body.emailed).toBe(true);
      expect(sent).toHaveBeenCalledWith(a.email, 'Dat', 'Sổ gia đình', inv.body.link);
      const tk = inv.body.link.split('/join/')[1];
      expect((await call('POST', `/api/invites/${tk}/accept`, {}, b.t)).status).toBe(410);
      expect((await call('GET', `/api/invites/${tk}`, null, a.t)).body.book_name).toBe('Sổ gia đình');
      expect((await call('POST', `/api/invites/${tk}/accept`, {}, a.t)).status).toBe(200);
      expect((await call('POST', `/api/invites/${tk}/accept`, {}, a.t)).status).toBe(410);
      // Hết hạn
      const inv2 = await call('POST', `/api/books/${f.book}/invites`, {}, f.chong.t);
      await sql("UPDATE invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [inv2.body.invite.id]);
      expect((await call('POST', `/api/invites/${inv2.body.link.split('/join/')[1]}/accept`, {}, b.t)).status).toBe(410);
      expect((await call('GET', '/api/invites/khong-ton-tai-token-0123456789', null, b.t)).status).toBe(404);
      // Thành viên không mời được, sổ cá nhân không mời được
      expect((await call('POST', `/api/books/${f.book}/invites`, {}, f.vo.t)).status).toBe(403);
      const personal = (await call('GET', '/api/books', null, f.chong.t)).body.books.find(x => x.kind === 'personal');
      expect((await call('POST', `/api/books/${personal.id}/invites`, {}, f.chong.t)).status).toBe(400);
    });

    it('rời sổ: giao dịch ở lại, hiện "Thành viên cũ"', async () => {
      const f = await familyBook();
      const w = (await call('POST', '/api/wallets', { name: 'Quỹ', type: 'cash' }, f.as(f.chong))).body.wallet;
      await call('POST', '/api/transactions', { kind: 'expense', amount: 99_000, wallet_id: w.id }, f.as(f.vo));
      expect((await call('DELETE', `/api/books/${f.book}/members/${f.chong.id}`, null, f.chong.t)).status).toBe(400);
      expect((await call('DELETE', `/api/books/${f.book}/members/${f.vo.id}`, null, f.vo.t)).status).toBe(200);
      expect((await call('GET', '/api/transactions', null, f.as(f.vo))).status).toBe(403);
      const list = (await call('GET', '/api/transactions', null, f.as(f.chong))).body.transactions;
      expect(list[0]).toMatchObject({ amount: 99_000, recorded_by: 'Thành viên cũ' });
      const bm = (await call('GET', '/api/reports/by-member', null, f.as(f.chong))).body.members;
      expect(bm[0]).toMatchObject({ name: 'Thành viên cũ', user_id: null });
    });

    it('danh sách sổ, đổi quyền, xoá sổ cần mật khẩu', async () => {
      const f = await familyBook();
      const list = (await call('GET', '/api/books', null, f.vo.t)).body.books;
      expect(list.map(b => [b.name, b.role])).toEqual([['Sổ của tôi', 'owner'], ['Sổ gia đình', 'editor']]);
      expect((await call('PATCH', `/api/books/${f.book}/members/${f.vo.id}`, { role: 'viewer' }, f.chong.t)).status).toBe(200);
      expect((await call('GET', '/api/summary', null, f.as(f.vo))).body.book.role).toBe('viewer');
      expect((await call('DELETE', `/api/books/${f.book}`, null, f.chong.t)).status).toBe(403);
      expect((await call('DELETE', `/api/books/${f.book}`, null, { token: f.chong.t, password: 'matkhau123' })).status).toBe(200);
      expect((await call('GET', '/api/books', null, f.vo.t)).body.books).toHaveLength(1);
    });
  });

  describe('F15 chia tiền nhóm', () => {
    it('nghiệm thu: Đà Lạt 4 người, Minh và Tú mỗi người trả 1.500.000 ₫, ≤ 3 lần chuyển; ghi phần của mình', async () => {
      const u = await user('Dat');
      const g = await call('POST', '/api/groups', { name: 'Đà Lạt 3N2Đ', me_name: 'Đạt', members: ['Hà', 'Minh', 'Tú'] }, u.t);
      expect(g.status).toBe(201);
      const id = g.body.group.id;
      const m = n => g.body.members.find(x => x.name === n).id;
      const all = ['Đạt', 'Hà', 'Minh', 'Tú'].map(n => ({ member_id: m(n) }));
      await call('PATCH', `/api/groups/${id}/members/${m('Đạt')}`, { bank_code: 'TCB', account_no: '19036662019', account_name: 'Nguyễn Văn Đạt' }, u.t);
      await call('POST', `/api/groups/${id}/expenses`, { title: 'Khách sạn', amount: 3_300_000, paid_by: m('Đạt'), split_mode: 'equal', shares: all }, u.t);
      const d = (await call('POST', `/api/groups/${id}/expenses`, { title: 'Ăn uống', amount: '2.700.000', paid_by: m('Hà'), split_mode: 'equal', shares: all }, u.t)).body;
      expect(d.total).toBe(6_000_000);
      expect(d.plan.length).toBeLessThanOrEqual(3);
      const pays = n => d.plan.filter(p => p.from_name === n).reduce((s, p) => s + p.amount, 0);
      expect(pays('Minh')).toBe(1_500_000);
      expect(pays('Tú')).toBe(1_500_000);
      const toDat = d.plan.find(p => p.to_name === 'Đạt');
      expect(toDat.qr).toContain('https://img.vietqr.io/image/TCB-19036662019-compact2.png?amount=');
      expect(toDat.qr).toContain('accountName=NGUYEN%20VAN%20DAT');
      // Đánh dấu đã trả
      const after = (await call('POST', `/api/groups/${id}/settlements`, { from_member: toDat.from, to_member: toDat.to, amount: toDat.amount }, u.t)).body;
      expect(after.plan.length).toBe(d.plan.length - 1);
      // Phần của mình (1.500.000) ghi vào sổ cá nhân
      const w = (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 2_000_000 }, u.t)).body.wallet;
      const rec = await call('POST', `/api/groups/${id}/record`, { wallet_id: w.id }, u.t);
      expect(rec.status).toBe(201);
      expect(rec.body.amount).toBe(1_500_000);
      expect(rec.body).toMatchObject({ unrecorded: 0, group: { recorded_amount: 1_500_000 } });
      expect((await call('POST', `/api/groups/${id}/record`, { wallet_id: w.id }, u.t)).status).toBe(400);
      expect((await call('GET', '/api/summary', null, u.t)).body.expense).toBe(1_500_000);
    });

    it('chia theo số tiền phải cộng đúng; nhóm của người khác không xem được', async () => {
      const u = await user('Dat'), x = await user('X');
      const g = (await call('POST', '/api/groups', { name: 'Ăn trưa', members: ['Hà'] }, u.t)).body;
      const [me, ha] = g.members.map(mm => mm.id);
      const bad = await call('POST', `/api/groups/${g.group.id}/expenses`, { title: 'Bún', amount: 100_000, paid_by: me, split_mode: 'amount', shares: [{ member_id: me, value: 30_000 }, { member_id: ha, value: 30_000 }] }, u.t);
      expect(bad.status).toBe(400);
      expect((await call('GET', `/api/groups/${g.group.id}`, null, x.t)).status).toBe(404);
      expect((await call('POST', `/api/groups/${g.group.id}/expenses`, { title: 'X', amount: 1000, paid_by: me, split_mode: 'equal', shares: [{ member_id: me }] }, x.t)).status).toBe(404);
      expect((await call('POST', '/api/groups', { name: 'Trùng', me_name: 'Hà', members: ['hà'] }, u.t)).status).toBe(400);
    });
  });

  describe('F16 sổ nợ', () => {
    it('nghiệm thu: cho Nam mượn 2.000.000, Nam trả 500.000 → còn 1.500.000, báo cáo chi tháng không đổi', async () => {
      const u = await user('Dat');
      const w = (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', opening_balance: 5_000_000 }, u.t)).body.wallet;
      const before = (await call('GET', '/api/summary', null, u.t)).body;
      const d = await call('POST', '/api/debts', { direction: 'lend', person: 'Nam', amount: 2_000_000, wallet_id: w.id, due_date: time.addDays(today, 10) }, u.t);
      expect(d.status).toBe(201);
      const p = await call('POST', `/api/debts/${d.body.debt.id}/payments`, { amount: 500_000, wallet_id: w.id }, u.t);
      expect(p.status).toBe(201);
      expect(p.body.debt).toMatchObject({ remaining: 1_500_000, paid: 500_000, closed: false, days_left: 10 });
      const after = (await call('GET', '/api/summary', null, u.t)).body;
      expect(after.expense).toBe(before.expense);
      expect(after.income).toBe(before.income);
      expect(after.total_balance).toBe(3_500_000);
      expect(after.debts).toMatchObject({ lent: 1_500_000, borrowed: 0 });
      // Cột chi 7 ngày ở Tổng quan: 7 ngày, hôm nay cuối, cho mượn không tính là chi
      expect(after.last7).toHaveLength(7);
      expect(after.last7[6]).toEqual({ date: today, expense: 0 });
      const cat = (await call('GET', '/api/reports/by-category', null, u.t)).body;
      expect(cat.total).toBe(0);
      // Không trả quá số còn lại; sửa giao dịch nợ ở Sổ ghi chép bị chặn
      expect((await call('POST', `/api/debts/${d.body.debt.id}/payments`, { amount: 1_600_000 }, u.t)).status).toBe(400);
      const tx = (await call('GET', '/api/transactions', null, u.t)).body.transactions.find(t => t.source === 'debt');
      expect((await call('DELETE', `/api/transactions/${tx.id}`, null, u.t)).status).toBe(403);
      // Trả hết → đóng
      const done = await call('POST', `/api/debts/${d.body.debt.id}/payments`, { amount: 1_500_000 }, u.t);
      expect(done.body.debt.closed).toBe(true);
      // Xoá khoản nợ → ví về như cũ
      expect((await call('DELETE', `/api/debts/${d.body.debt.id}`, null, u.t)).status).toBe(200);
      expect((await call('GET', '/api/summary', null, u.t)).body.total_balance).toBe(5_000_000);
    });

    it('đi vay, quá hạn, tổng "Mình nợ"', async () => {
      const u = await user('Dat');
      await call('POST', '/api/debts', { direction: 'borrow', person: 'Chị Lan', amount: 3_000_000, date: time.addDays(today, -20), due_date: time.addDays(today, -12) }, u.t);
      await call('POST', '/api/debts', { direction: 'lend', person: 'Tuấn', amount: 200_000 }, u.t);
      const r = (await call('GET', '/api/debts', null, u.t)).body;
      expect(r.totals).toMatchObject({ lent: 200_000, borrowed: 3_000_000, overdue: 1 });
      expect(r.debts[0]).toMatchObject({ person: 'Chị Lan', overdue_days: 12 });
      expect((await call('GET', '/api/summary', null, u.t)).body.alerts.some(a => a.kind === 'debt_overdue')).toBe(true);
      expect((await call('POST', '/api/debts', { direction: 'lend', person: 'X', amount: 1000, date: today, due_date: time.addDays(today, -1) }, u.t)).status).toBe(400);
    });

    it('cron nhắc trước hạn 3 ngày và đúng hạn, mỗi mốc 1 lần', async () => {
      const u = await user('Dat');
      const sent = vi.spyOn(email, 'sendDebtReminder').mockResolvedValue({ ok: true });
      await call('POST', '/api/debts', { direction: 'lend', person: 'Nam', amount: 2_000_000, due_date: time.addDays(today, 3) }, u.t);
      await call('POST', '/api/debts', { direction: 'borrow', person: 'Lan', amount: 1_000_000, due_date: today }, u.t);
      await call('POST', '/api/debts', { direction: 'lend', person: 'Xa', amount: 1_000_000, due_date: time.addDays(today, 5) }, u.t);
      const cron = () => fetch(`${app.base}/api/cron/daily`, { headers: { Authorization: `Bearer ${config.CRON_SECRET}` } }).then(r => r.json());
      expect((await cron()).debt_emails).toBe(2);
      expect(sent.mock.calls.map(c => [c[2].person, c[2].kind]).sort()).toEqual([['Lan', 'due'], ['Nam', 'before3']]);
      expect((await cron()).debt_emails).toBe(0);
    });
  });
});
