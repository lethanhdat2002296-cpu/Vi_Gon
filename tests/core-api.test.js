import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');

describe.skipIf(!TEST_DB)('API ví, danh mục, giao dịch (Postgres thật)', () => {
  let app, call;
  let seq = 0;

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

  async function user() {
    const r = await call('POST', '/api/auth/register', { email: `u${++seq}@vigon.vn`, password: 'Matkhau@123' });
    expect(r.status).toBe(201);
    return r.body.token;
  }
  const wallet = async (token, body) => (await call('POST', '/api/wallets', { name: 'Tiền mặt', type: 'cash', ...body }, token)).body.wallet;
  const cats = async (token, kind) => (await call('GET', `/api/categories?kind=${kind}`, null, token)).body.categories;
  const catByName = async (token, name, kind = 'expense') => (await cats(token, kind)).find(c => c.name === name);
  const spend = (token, body) => call('POST', '/api/transactions', { kind: 'expense', ...body }, token);
  const walletById = async (token, id) => (await call('GET', '/api/wallets?include_archived=1', null, token)).body.wallets.find(w => w.id === id);

  describe('danh mục mặc định (F06)', () => {
    it('đăng ký xong có 11 danh mục chi + 6 danh mục thu cấp 1, kèm mục con', async () => {
      const t = await user();
      const ex = await cats(t, 'expense');
      const inc = await cats(t, 'income');
      expect(ex.filter(c => !c.parent_id).map(c => c.name)).toEqual([
        'Ăn uống', 'Đi lại', 'Nhà ở', 'Mua sắm', 'Sức khoẻ', 'Học tập', 'Giải trí', 'Hiếu hỉ', 'Gửi bố mẹ', 'Con cái', 'Khác'
      ]);
      expect(inc.filter(c => !c.parent_id).map(c => c.name)).toEqual(['Lương', 'Thưởng', 'Kinh doanh', 'Được cho', 'Lãi tiết kiệm', 'Khác']);
      const nha = ex.find(c => c.name === 'Nhà ở');
      expect(ex.filter(c => c.parent_id === nha.id).map(c => c.name)).toEqual(['Thuê nhà', 'Điện', 'Nước', 'Mạng']);
    });
    it('gọi song song lần đầu vẫn chỉ tạo 1 sổ, không nhân đôi danh mục', async () => {
      const t = await user();
      await sql('DELETE FROM books');
      await Promise.all([1, 2, 3, 4].map(() => call('GET', '/api/wallets', null, t)));
      expect((await sql('SELECT COUNT(*)::int AS n FROM books')).rows[0].n).toBe(1);
      expect((await cats(t, 'income')).length).toBe(6);
    });
  });

  describe('ví (F05)', () => {
    it('tạo ví, số dư = số dư đầu, tổng tài sản đúng', async () => {
      const t = await user();
      const w = await wallet(t, { opening_balance: 1_250_000 });
      expect(w).toMatchObject({ name: 'Tiền mặt', type: 'cash', balance: 1_250_000 });
      await wallet(t, { name: 'Thẻ VPBank', type: 'credit', opening_balance: -4_340_000, credit_limit: 20_000_000, due_day: 15 });
      await wallet(t, { name: 'Quỹ khác', type: 'savings', opening_balance: 100, exclude_from_total: true });
      const r = await call('GET', '/api/wallets', null, t);
      expect(r.body.wallets).toHaveLength(3);
      expect(r.body.total).toBe(1_250_000 - 4_340_000);
    });
    it('chặn dữ liệu sai', async () => {
      const t = await user();
      expect((await call('POST', '/api/wallets', { name: '', type: 'cash' }, t)).status).toBe(400);
      expect((await call('POST', '/api/wallets', { name: 'A', type: 'vang' }, t)).status).toBe(400);
      expect((await call('POST', '/api/wallets', { name: 'A', type: 'cash', opening_balance: 1.5 }, t)).status).toBe(400);
      expect((await call('POST', '/api/wallets', { name: 'A', type: 'cash', opening_balance: 1e13 }, t)).status).toBe(400);
      expect((await call('POST', '/api/wallets', { name: 'A', type: 'cash', due_day: 32 }, t)).status).toBe(400);
    });
    it('điều chỉnh số dư tạo khoản "Điều chỉnh" bằng phần chênh', async () => {
      const t = await user();
      const w = await wallet(t, { opening_balance: 500_000 });
      await spend(t, { amount: 45_000, wallet_id: w.id });
      const r = await call('POST', `/api/wallets/${w.id}/adjust`, { actual_balance: 400_000 }, t);
      expect(r.status).toBe(200);
      expect(r.body.adjustment).toMatchObject({ kind: 'expense', amount: 55_000 });
      expect(r.body.wallet.balance).toBe(400_000);
      const up = await call('POST', `/api/wallets/${w.id}/adjust`, { actual_balance: 410_000 }, t);
      expect(up.body.adjustment).toMatchObject({ kind: 'income', amount: 10_000 });
      const same = await call('POST', `/api/wallets/${w.id}/adjust`, { actual_balance: 410_000 }, t);
      expect(same.body.adjustment).toBeNull();
    });
    it('không cho sửa số dư đầu qua PATCH', async () => {
      const t = await user();
      const w = await wallet(t, {});
      expect((await call('PATCH', `/api/wallets/${w.id}`, { opening_balance: 5 }, t)).status).toBe(400);
      const r = await call('PATCH', `/api/wallets/${w.id}`, { name: 'Ví mới', color: '#5E6FB8' }, t);
      expect(r.body.wallet).toMatchObject({ name: 'Ví mới', color: '#5E6FB8' });
    });
    it('ví đã có giao dịch chỉ ẩn được, không xoá; ví trống xoá được', async () => {
      const t = await user();
      const used = await wallet(t, {});
      const empty = await wallet(t, { name: 'Trống' });
      await spend(t, { amount: 1000, wallet_id: used.id });
      expect((await call('DELETE', `/api/wallets/${used.id}`, null, t)).status).toBe(409);
      expect((await call('DELETE', `/api/wallets/${empty.id}`, null, t)).status).toBe(200);
      const a = await call('POST', `/api/wallets/${used.id}/archive`, {}, t);
      expect(a.body.wallet.archived).toBe(true);
      expect((await call('GET', '/api/wallets', null, t)).body.wallets).toHaveLength(0);
      expect((await spend(t, { amount: 1000, wallet_id: used.id })).status).toBe(400);
      const back = await call('POST', `/api/wallets/${used.id}/archive`, { archived: false }, t);
      expect(back.body.wallet.archived).toBe(false);
    });
  });

  describe('giao dịch (F03)', () => {
    it('nghiệm thu: 45.000 Ăn uống → khoản chi 45.000 ₫ hôm nay ở ví vừa dùng', async () => {
      const t = await user();
      const w = await wallet(t, { opening_balance: 1_000_000 });
      const an = await catByName(t, 'Ăn uống');
      const r = await spend(t, { amount: '45.000', wallet_id: w.id, category_id: an.id });
      expect(r.status).toBe(201);
      expect(r.body.transaction).toMatchObject({ kind: 'expense', amount: 45_000, wallet_id: w.id, category_name: 'Ăn uống' });
      expect(Math.abs(new Date(r.body.transaction.occurred_at) - Date.now())).toBeLessThan(60_000);
      expect((await walletById(t, w.id)).balance).toBe(955_000);
      const qa = await call('GET', '/api/quickadd', null, t);
      expect(qa.body.last_wallet_id).toBe(w.id);
      expect(qa.body.top_categories.expense[0].name).toBe('Ăn uống');
      expect(qa.body.top_categories.expense).toHaveLength(9);
    });
    it('số tiền phải nguyên dương, ≤ 999.999.999.999', async () => {
      const t = await user();
      const w = await wallet(t, {});
      for (const amount of [0, -5, 1.5, '45.5', 1_000_000_000_000, 'abc', null]) {
        expect((await spend(t, { amount, wallet_id: w.id })).status).toBe(400);
      }
      expect((await spend(t, { amount: 999_999_999_999, wallet_id: w.id })).status).toBe(201);
    });
    it('ngày quá khứ được, tương lai bị chặn', async () => {
      const t = await user();
      const w = await wallet(t, {});
      const past = await spend(t, { amount: 1000, wallet_id: w.id, date: '2026-01-15' });
      expect(past.status).toBe(201);
      expect(new Date(past.body.transaction.occurred_at).toISOString()).toBe('2026-01-15T05:00:00.000Z');
      expect((await spend(t, { amount: 1000, wallet_id: w.id, date: '2999-01-01' })).status).toBe(400);
    });
    it('danh mục phải đúng loại thu/chi', async () => {
      const t = await user();
      const w = await wallet(t, {});
      const luong = await catByName(t, 'Lương', 'income');
      expect((await spend(t, { amount: 1000, wallet_id: w.id, category_id: luong.id })).status).toBe(400);
      expect((await call('POST', '/api/transactions', { kind: 'income', amount: 1000, wallet_id: w.id, category_id: luong.id }, t)).status).toBe(201);
    });
    it('chi vượt số dư vẫn lưu nhưng có cảnh báo; thẻ tín dụng thì không cảnh báo', async () => {
      const t = await user();
      const w = await wallet(t, { opening_balance: 10_000 });
      const ok = await spend(t, { amount: 5000, wallet_id: w.id });
      expect(ok.body.warning).toBeNull();
      const over = await spend(t, { amount: 20_000, wallet_id: w.id });
      expect(over.status).toBe(201);
      expect(over.body.warning).toContain('15.000');
      const card = await wallet(t, { name: 'Thẻ', type: 'credit' });
      expect((await spend(t, { amount: 20_000, wallet_id: card.id })).body.warning).toBeNull();
    });
    it('sửa số tiền, danh mục, ví, ghi chú', async () => {
      const t = await user();
      const a = await wallet(t, { opening_balance: 100_000 });
      const b = await wallet(t, { name: 'MoMo', type: 'ewallet' });
      const tx = (await spend(t, { amount: 10_000, wallet_id: a.id })).body.transaction;
      const diLai = await catByName(t, 'Đi lại');
      const r = await call('PATCH', `/api/transactions/${tx.id}`, { amount: 30_000, wallet_id: b.id, category_id: diLai.id, note: 'Grab' }, t);
      expect(r.status).toBe(200);
      expect(r.body.transaction).toMatchObject({ amount: 30_000, wallet_id: b.id, category_name: 'Đi lại', note: 'Grab' });
      expect((await walletById(t, a.id)).balance).toBe(100_000);
      expect((await walletById(t, b.id)).balance).toBe(-30_000);
    });
    it('xoá rồi hoàn tác', async () => {
      const t = await user();
      const w = await wallet(t, { opening_balance: 100_000 });
      const tx = (await spend(t, { amount: 10_000, wallet_id: w.id })).body.transaction;
      expect((await call('DELETE', `/api/transactions/${tx.id}`, null, t)).body.ids).toEqual([tx.id]);
      expect((await walletById(t, w.id)).balance).toBe(100_000);
      expect((await call('GET', '/api/transactions', null, t)).body.transactions).toHaveLength(0);
      expect((await call('POST', `/api/transactions/${tx.id}/restore`, null, t)).body.ids).toEqual([tx.id]);
      expect((await walletById(t, w.id)).balance).toBe(90_000);
    });
    it('danh sách mới nhất trước, phân trang theo con trỏ không trùng không sót', async () => {
      const t = await user();
      const w = await wallet(t, {});
      for (let i = 1; i <= 7; i++) await spend(t, { amount: i * 1000, wallet_id: w.id, date: `2026-01-0${i}` });
      const p1 = await call('GET', '/api/transactions?limit=3', null, t);
      expect(p1.body.transactions.map(x => x.amount)).toEqual([7000, 6000, 5000]);
      const p2 = await call('GET', `/api/transactions?limit=3&cursor=${encodeURIComponent(p1.body.next_cursor)}`, null, t);
      expect(p2.body.transactions.map(x => x.amount)).toEqual([4000, 3000, 2000]);
      const p3 = await call('GET', `/api/transactions?limit=3&cursor=${encodeURIComponent(p2.body.next_cursor)}`, null, t);
      expect(p3.body.transactions.map(x => x.amount)).toEqual([1000]);
      expect(p3.body.next_cursor).toBeNull();
    });
    it('gợi ý theo ghi chú quen thuộc: danh mục + số tiền lần trước', async () => {
      const t = await user();
      const w = await wallet(t, {});
      const cafe = await catByName(t, 'Cà phê');
      await spend(t, { amount: 30_000, wallet_id: w.id, category_id: cafe.id, note: 'Highlands', date: '2026-01-01' });
      await spend(t, { amount: 35_000, wallet_id: w.id, category_id: cafe.id, note: 'Highlands' });
      const r = await call('GET', '/api/quickadd/suggest?q=high', null, t);
      expect(r.body.suggestions).toEqual([{ note: 'Highlands', kind: 'expense', amount: 35_000, category_id: cafe.id }]);
      expect((await call('GET', '/api/quickadd/suggest?q=%25', null, t)).body.suggestions).toEqual([]);
    });
  });

  describe('chuyển giữa ví (F05)', () => {
    it('nghiệm thu: chuyển 2.000.000 Techcombank → Tiết kiệm: nguồn giảm, đích tăng, tổng không đổi', async () => {
      const t = await user();
      const tcb = await wallet(t, { name: 'Techcombank', type: 'bank', opening_balance: 12_870_000 });
      const tk = await wallet(t, { name: 'Tiết kiệm', type: 'savings', opening_balance: 8_000_000 });
      const before = (await call('GET', '/api/wallets', null, t)).body.total;
      const r = await call('POST', '/api/transfers', { from_wallet_id: tcb.id, to_wallet_id: tk.id, amount: 2_000_000 }, t);
      expect(r.status).toBe(201);
      expect(r.body.transactions.map(x => [x.wallet_id, x.kind, x.amount])).toEqual([
        [tcb.id, 'expense', 2_000_000], [tk.id, 'income', 2_000_000]
      ]);
      expect(r.body.transactions[0].counterpart_wallet_name).toBe('Tiết kiệm');
      expect((await walletById(t, tcb.id)).balance).toBe(10_870_000);
      expect((await walletById(t, tk.id)).balance).toBe(10_000_000);
      expect((await call('GET', '/api/wallets', null, t)).body.total).toBe(before);
      const rows = (await sql("SELECT DISTINCT transfer_group, source, category_id FROM transactions")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'transfer', category_id: null });
    });
    it('nguồn phải khác đích', async () => {
      const t = await user();
      const w = await wallet(t, {});
      expect((await call('POST', '/api/transfers', { from_wallet_id: w.id, to_wallet_id: w.id, amount: 1000 }, t)).status).toBe(400);
    });
    it('xoá một bút toán là xoá cả cặp; hoàn tác cũng cả cặp; sửa số tiền áp cho cả hai', async () => {
      const t = await user();
      const a = await wallet(t, { opening_balance: 100_000 });
      const b = await wallet(t, { name: 'B', opening_balance: 0 });
      const [out, inn] = (await call('POST', '/api/transfers', { from_wallet_id: a.id, to_wallet_id: b.id, amount: 30_000 }, t)).body.transactions;
      const p = await call('PATCH', `/api/transactions/${inn.id}`, { amount: 40_000 }, t);
      expect(p.status).toBe(200);
      expect((await walletById(t, a.id)).balance).toBe(60_000);
      expect((await walletById(t, b.id)).balance).toBe(40_000);
      expect((await call('PATCH', `/api/transactions/${out.id}`, { wallet_id: b.id }, t)).status).toBe(400);
      const d = await call('DELETE', `/api/transactions/${inn.id}`, null, t);
      expect(d.body.ids.sort()).toEqual([out.id, inn.id].sort());
      expect((await walletById(t, a.id)).balance).toBe(100_000);
      expect((await walletById(t, b.id)).balance).toBe(0);
      await call('POST', `/api/transactions/${out.id}/restore`, null, t);
      expect((await walletById(t, b.id)).balance).toBe(40_000);
    });
  });

  describe('danh mục: sửa, sắp xếp, gộp, xoá (F06)', () => {
    it('nghiệm thu: gộp "Cà phê" vào "Ăn uống": giao dịch chuyển hết', async () => {
      const t = await user();
      const w = await wallet(t, {});
      const cafe = await catByName(t, 'Cà phê');
      const an = await catByName(t, 'Ăn uống');
      for (const amount of [30_000, 25_000]) await spend(t, { amount, wallet_id: w.id, category_id: cafe.id });
      const r = await call('POST', `/api/categories/${cafe.id}/merge`, { into: an.id }, t);
      expect(r.body.moved_transactions).toBe(2);
      expect(await catByName(t, 'Cà phê')).toBeUndefined();
      const list = (await call('GET', '/api/transactions', null, t)).body.transactions;
      expect(list.every(x => x.category_id === an.id)).toBe(true);
    });
    it('gộp danh mục có mục con: mục con chuyển sang dưới danh mục nhận', async () => {
      const t = await user();
      const nha = await catByName(t, 'Nhà ở');
      const khac = await catByName(t, 'Khác');
      await call('POST', `/api/categories/${nha.id}/merge`, { into: khac.id }, t);
      const dien = await catByName(t, 'Điện');
      expect(dien.parent_id).toBe(khac.id);
    });
    it('không gộp khác loại / vào chính nó / vào mục con của nó', async () => {
      const t = await user();
      const an = await catByName(t, 'Ăn uống');
      const cafe = await catByName(t, 'Cà phê');
      const luong = await catByName(t, 'Lương', 'income');
      expect((await call('POST', `/api/categories/${an.id}/merge`, { into: luong.id }, t)).status).toBe(400);
      expect((await call('POST', `/api/categories/${an.id}/merge`, { into: an.id }, t)).status).toBe(400);
      expect((await call('POST', `/api/categories/${an.id}/merge`, { into: cafe.id }, t)).status).toBe(400);
    });
    it('xoá danh mục có giao dịch phải chọn danh mục nhận', async () => {
      const t = await user();
      const w = await wallet(t, {});
      const giaiTri = await catByName(t, 'Giải trí');
      const khac = await catByName(t, 'Khác');
      await spend(t, { amount: 1000, wallet_id: w.id, category_id: giaiTri.id });
      const no = await call('DELETE', `/api/categories/${giaiTri.id}`, null, t);
      expect(no.status).toBe(409);
      expect(no.body.tx_count).toBe(1);
      const yes = await call('DELETE', `/api/categories/${giaiTri.id}?move_to=${khac.id}`, null, t);
      expect(yes.status).toBe(200);
      expect((await call('GET', '/api/transactions', null, t)).body.transactions[0].category_id).toBe(khac.id);
      // Chỉ còn giao dịch đã xoá → xoá được luôn, không bắt chọn nơi nhận
      const conCai = await catByName(t, 'Con cái');
      const gone = (await spend(t, { amount: 1000, wallet_id: w.id, category_id: conCai.id })).body.transaction;
      await call('DELETE', `/api/transactions/${gone.id}`, null, t);
      expect((await call('DELETE', `/api/categories/${conCai.id}`, null, t)).status).toBe(200);
      const hocTap = await catByName(t, 'Học tập');
      expect((await call('DELETE', `/api/categories/${hocTap.id}`, null, t)).status).toBe(200);
    });
    it('thêm mục con 1 cấp; không cho cấp 2; đổi tên/biểu tượng; sắp xếp', async () => {
      const t = await user();
      const an = await catByName(t, 'Ăn uống');
      const tra = await call('POST', '/api/categories', { name: 'Trà sữa', kind: 'expense', parent_id: an.id }, t);
      expect(tra.status).toBe(201);
      expect(tra.body.category.parent_id).toBe(an.id);
      expect((await call('POST', '/api/categories', { name: 'X', kind: 'expense', parent_id: tra.body.category.id }, t)).status).toBe(400);
      const luong = await catByName(t, 'Lương', 'income');
      expect((await call('POST', '/api/categories', { name: 'X', kind: 'expense', parent_id: luong.id }, t)).status).toBe(400);
      const p = await call('PATCH', `/api/categories/${an.id}`, { name: 'Ăn & uống', icon: '🍲' }, t);
      expect(p.body.category).toMatchObject({ name: 'Ăn & uống', icon: '🍲' });
      const top = (await cats(t, 'income')).filter(c => !c.parent_id).map(c => c.id).reverse();
      expect((await call('POST', '/api/categories/reorder', { ids: top }, t)).status).toBe(200);
      expect((await cats(t, 'income')).map(c => c.id)).toEqual(top);
    });
  });

  describe('làm quen (F01)', () => {
    it('phải có ví mới hoàn tất được; bộ "gọn" bỏ mục con', async () => {
      const t = await user();
      expect((await call('POST', '/api/onboarding/complete', {}, t)).status).toBe(400);
      await wallet(t, { opening_balance: 1_250_000 });
      const r = await call('POST', '/api/onboarding/complete', { category_preset: 'basic' }, t);
      expect(r.status).toBe(200);
      expect(r.body.user.onboarded).toBe(true);
      expect((await cats(t, 'expense')).every(c => !c.parent_id)).toBe(true);
      expect((await call('GET', '/api/wallets', null, t)).body.total).toBe(1_250_000);
    });
  });

  describe('chống đọc / sửa chéo giữa hai người dùng', () => {
    it('user B không thấy, không sửa, không xoá được ví, danh mục, giao dịch của user A', async () => {
      const a = await user();
      const b = await user();
      const wa = await wallet(a, { opening_balance: 1_000_000 });
      const ca = await catByName(a, 'Ăn uống');
      const tx = (await spend(a, { amount: 45_000, wallet_id: wa.id, category_id: ca.id, note: 'bí mật' })).body.transaction;
      const wb = await wallet(b, {});
      const cb = await catByName(b, 'Ăn uống');

      // Đọc
      expect((await call('GET', '/api/wallets', null, b)).body.wallets.map(w => w.id)).toEqual([wb.id]);
      expect((await call('GET', '/api/transactions', null, b)).body.transactions).toEqual([]);
      expect((await call('GET', `/api/transactions/${tx.id}`, null, b)).status).toBe(404);
      expect((await cats(b, 'expense')).some(c => c.id === ca.id)).toBe(false);
      expect((await call('GET', '/api/quickadd/suggest?q=bí', null, b)).body.suggestions).toEqual([]);
      expect((await call('GET', `/api/transactions?wallet=${wa.id}`, null, b)).body.transactions).toEqual([]);

      // Sửa / xoá thứ của A
      expect((await call('PATCH', `/api/wallets/${wa.id}`, { name: 'hack' }, b)).status).toBe(404);
      expect((await call('POST', `/api/wallets/${wa.id}/adjust`, { actual_balance: 0 }, b)).status).toBe(404);
      expect((await call('POST', `/api/wallets/${wa.id}/archive`, {}, b)).status).toBe(404);
      expect((await call('DELETE', `/api/wallets/${wa.id}`, null, b)).status).toBe(404);
      expect((await call('PATCH', `/api/transactions/${tx.id}`, { amount: 1 }, b)).status).toBe(404);
      expect((await call('DELETE', `/api/transactions/${tx.id}`, null, b)).status).toBe(404);
      expect((await call('POST', `/api/transactions/${tx.id}/restore`, null, b)).status).toBe(404);
      expect((await call('PATCH', `/api/categories/${ca.id}`, { name: 'hack' }, b)).status).toBe(404);
      expect((await call('DELETE', `/api/categories/${ca.id}`, null, b)).status).toBe(404);
      expect((await call('POST', `/api/categories/${ca.id}/merge`, { into: cb.id }, b)).status).toBe(404);
      expect((await call('POST', '/api/categories/reorder', { ids: [ca.id] }, b)).status).toBe(404);

      // Dùng id của A trong dữ liệu của B
      expect((await spend(b, { amount: 1000, wallet_id: wa.id })).status).toBe(400);
      expect((await spend(b, { amount: 1000, wallet_id: wb.id, category_id: ca.id })).status).toBe(400);
      expect((await call('POST', '/api/transfers', { from_wallet_id: wb.id, to_wallet_id: wa.id, amount: 1000 }, b)).status).toBe(400);
      expect((await call('POST', '/api/categories', { name: 'X', kind: 'expense', parent_id: ca.id }, b)).status).toBe(400);
      expect((await call('POST', `/api/categories/${cb.id}/merge`, { into: ca.id }, b)).status).toBe(400);
      const bt = (await spend(b, { amount: 1000, wallet_id: wb.id })).body.transaction;
      expect((await call('PATCH', `/api/transactions/${bt.id}`, { wallet_id: wa.id }, b)).status).toBe(400);
      expect((await call('PATCH', `/api/transactions/${bt.id}`, { category_id: ca.id }, b)).status).toBe(400);
      expect((await call('DELETE', `/api/categories/${cb.id}?move_to=${ca.id}`, null, b)).status).toBe(200);

      // Dữ liệu A vẫn nguyên
      const after = (await call('GET', `/api/transactions/${tx.id}`, null, a)).body.transaction;
      expect(after).toMatchObject({ amount: 45_000, category_id: ca.id, deleted: false, note: 'bí mật' });
      expect((await walletById(a, wa.id))).toMatchObject({ name: 'Tiền mặt', balance: 955_000, archived: false });
      expect((await catByName(a, 'Ăn uống')).id).toBe(ca.id);
    });
    it('chưa đăng nhập → 401 ở mọi API dữ liệu', async () => {
      for (const p of ['/api/wallets', '/api/categories', '/api/transactions', '/api/quickadd']) {
        expect((await call('GET', p)).status).toBe(401);
      }
      expect((await call('POST', '/api/transfers', {})).status).toBe(401);
    });
  });
});
