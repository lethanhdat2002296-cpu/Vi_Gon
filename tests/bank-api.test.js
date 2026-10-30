import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { TEST_DB, setupDb, resetData, teardownDb, sql, startApp } from './db.js';
const require = createRequire(import.meta.url);
const email = require('../utils/email.js');
const config = require('../config.js');
const time = require('../utils/time.js');

describe.skipIf(!TEST_DB)('Liên kết ngân hàng F12 + ảnh hoá đơn F13 (Postgres thật)', () => {
  let app, call;
  let seq = 0, sepayId = 1000;
  const today = time.nowInTimezone().date;

  beforeAll(async () => { await setupDb(); app = await startApp(); call = app.call; });
  afterAll(async () => { await app.close(); await teardownDb(); });
  beforeEach(async () => {
    await resetData();
    vi.spyOn(email, 'sendVerifyEmail').mockResolvedValue({ ok: true });
    config.CRON_SECRET = 'bi-mat-cron-test-0123456789';
  });

  async function setup({ verified = true } = {}) {
    const r = await call('POST', '/api/auth/register', { email: `b${++seq}@vigon.vn`, password: 'Matkhau@123' });
    const t = r.body.token;
    if (verified) await sql('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [r.body.user.id]);
    const cats = (await call('GET', '/api/categories', null, t)).body.categories;
    const cat = (n, k = 'expense') => cats.find(c => c.name === n && c.kind === k).id;
    const bankW = (await call('POST', '/api/wallets', { name: 'Techcombank', type: 'bank', opening_balance: 10_000_000 }, t)).body.wallet;
    return { t, cat, bankW, userId: r.body.user.id };
  }
  async function link(s, body = {}) {
    const r = await call('POST', '/api/bank/links', { wallet_id: s.bankW.id, account_last4: '2019', ...body }, s.t);
    expect(r.status).toBe(201);
    return { ...r.body.link, secret: r.body.secret, hookId: r.body.link.hook_url.split('/').pop() };
  }
  const payload = (over = {}) => ({
    id: ++sepayId, gateway: 'Techcombank', transactionDate: `${today} 08:12:00`, accountNumber: '19036662019', subAccount: '',
    code: null, content: 'GRAB*A-7Q2XK HCM', transferType: 'out', description: '', transferAmount: 56000, accumulated: 0, referenceCode: 'FT1', ...over
  });
  async function send(l, body, key = l.secret) {
    const res = await fetch(`${app.base}/api/hook/${l.hookId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Apikey ${key}` } : {}) }, body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  const pending = async t => (await call('GET', '/api/bank/pending', null, t)).body.pending;
  const balanceOf = async (t, id) => (await call('GET', '/api/wallets?include_archived=1', null, t)).body.wallets.find(w => w.id === id).balance;

  describe('liên kết', () => {
    it('chưa xác minh email thì không liên kết được', async () => {
      const s = await setup({ verified: false });
      const r = await call('POST', '/api/bank/links', { wallet_id: s.bankW.id }, s.t);
      expect(r.status).toBe(403);
      expect(r.body.need_verify).toBe(true);
    });
    it('mỗi liên kết có địa chỉ + mã bí mật riêng; mã chỉ trả 1 lần, DB chỉ lưu hash', async () => {
      const s = await setup();
      const a = await link(s);
      const b = await link(s);
      expect(a.hook_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/hook\/h_[A-Za-z0-9_-]+$/);
      expect(a.hook_url).not.toBe(b.hook_url);
      expect(a.secret).not.toBe(b.secret);
      const list = (await call('GET', '/api/bank/links', null, s.t)).body.links;
      expect(JSON.stringify(list)).not.toContain(a.secret);
      const row = (await sql('SELECT secret_hash FROM bank_links WHERE id = $1', [a.id])).rows[0];
      expect(row.secret_hash).not.toBe(a.secret);
      expect((await call('POST', '/api/bank/links', { wallet_id: s.bankW.id, account_last4: '12345' }, s.t)).status).toBe(400);
    });
  });

  describe('webhook', () => {
    it('nghiệm thu: khoản chuyển về → có trong Chờ xác nhận, đúng ví và số tiền, kèm gợi ý danh mục', async () => {
      const s = await setup();
      const l = await link(s);
      const r = await send(l, payload({ transferType: 'in', transferAmount: 10_000, content: 'NGUYEN VAN A chuyen tien thu' }));
      expect(r).toEqual({ status: 200, body: { success: true } });
      const p = await pending(s.t);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ wallet_id: s.bankW.id, kind: 'income', amount: 10_000, source: 'bank', status: 'pending' });
      expect(await balanceOf(s.t, s.bankW.id)).toBe(10_010_000);
      const grab = await send(l, payload());
      expect(grab.status).toBe(200);
      expect((await pending(s.t)).find(x => x.amount === 56_000).category_id).toBe(s.cat('Grab, taxi'));
    });
    it('nghiệm thu: gửi cùng dữ liệu 3 lần chỉ tạo 1 giao dịch', async () => {
      const s = await setup();
      const l = await link(s);
      const body = payload();
      for (let i = 0; i < 3; i++) expect((await send(l, body)).body).toEqual({ success: true });
      expect(await pending(s.t)).toHaveLength(1);
      const ev = (await call('GET', `/api/bank/links/${l.id}/events`, null, s.t)).body.events.map(e => e.result);
      expect(ev.filter(x => x === 'duplicate')).toHaveLength(2);
    });
    it('sai mã bí mật → bỏ qua, ghi nhật ký; liên kết tắt → 404', async () => {
      const s = await setup();
      const l = await link(s);
      expect((await send(l, payload(), 'sai-ma')).status).toBe(401);
      expect((await send(l, payload(), null)).status).toBe(401);
      expect(await pending(s.t)).toHaveLength(0);
      const ev = (await call('GET', `/api/bank/links/${l.id}/events`, null, s.t)).body.events;
      expect(ev[0]).toMatchObject({ result: 'rejected' });
      await call('PATCH', `/api/bank/links/${l.id}`, { active: false }, s.t);
      expect((await send(l, payload())).status).toBe(404);
      expect((await fetch(`${app.base}/api/hook/h_khongcoaaaaaaa`, { method: 'POST' })).status).toBe(404);
    });
    it('khác tài khoản đã liên kết → bỏ qua; dữ liệu sai → 400', async () => {
      const s = await setup();
      const l = await link(s);
      expect((await send(l, payload({ accountNumber: '0000001111' }))).body).toEqual({ success: true });
      expect((await send(l, payload({ transferAmount: -1 }))).status).toBe(400);
      expect(await pending(s.t)).toHaveLength(0);
    });
    it('đổi mã bí mật: mã cũ hết hiệu lực', async () => {
      const s = await setup();
      const l = await link(s);
      const r = await call('POST', `/api/bank/links/${l.id}/rotate`, null, s.t);
      expect((await send(l, payload())).status).toBe(401);
      expect((await send(l, payload(), r.body.secret)).status).toBe(200);
    });
    it('tự xác nhận khi đã quen (có gợi ý danh mục)', async () => {
      const s = await setup();
      const l = await link(s, { auto_confirm: true });
      await send(l, payload());
      await send(l, payload({ content: 'NGUYEN VAN B', transferAmount: 12_345 }));
      const all = (await call('GET', '/api/transactions?source=bank', null, s.t)).body.transactions;
      expect(all.find(x => x.amount === 56_000).status).toBe('confirmed');
      expect(all.find(x => x.amount === 12_345).status).toBe('pending');
    });
  });

  describe('Chờ xác nhận', () => {
    it('Đổi danh mục → học; lần sau cùng nội dung gợi ý theo lựa chọn của người dùng', async () => {
      const s = await setup();
      const l = await link(s);
      await send(l, payload({ content: 'HIGHLANDS COFFEE Q3', transferAmount: 45_000 }));
      const p = (await pending(s.t))[0];
      expect(p.category_id).toBe(s.cat('Cà phê'));
      const r = await call('POST', `/api/bank/pending/${p.id}/confirm`, { category_id: s.cat('Giải trí') }, s.t);
      expect(r.body).toMatchObject({ learned: 'highlands', transaction: { status: 'confirmed', category_id: s.cat('Giải trí') } });
      await send(l, payload({ content: 'HIGHLANDS COFFEE NGUYEN HUE', transferAmount: 55_000 }));
      expect((await pending(s.t))[0].category_id).toBe(s.cat('Giải trí'));
    });
    it('"THANH TOAN THE VPBANK" → gợi ý chuyển giữa ví; xác nhận thành cặp chuyển tiền, không tính chi', async () => {
      const s = await setup();
      const card = (await call('POST', '/api/wallets', { name: 'Thẻ VPBank', type: 'credit', opening_balance: -1_250_000 }, s.t)).body.wallet;
      const l = await link(s);
      await send(l, payload({ content: 'THANH TOAN THE VPBANK', transferAmount: 1_250_000 }));
      const p = (await pending(s.t))[0];
      expect(p).toMatchObject({ suggest_wallet_id: card.id, suggest_wallet_name: 'Thẻ VPBank', category_id: null });
      const before = (await call('GET', '/api/summary', null, s.t)).body;
      await call('POST', `/api/bank/pending/${p.id}/confirm`, { transfer_wallet_id: card.id }, s.t);
      expect(await balanceOf(s.t, card.id)).toBe(0);
      const after = (await call('GET', '/api/summary', null, s.t)).body;
      expect(after.expense).toBe(before.expense - 1_250_000);
      // Trả thẻ tín dụng không làm đổi tài sản ròng: về đúng 10.000.000 − 1.250.000 dư nợ ban đầu
      expect(after.total_balance).toBe(10_000_000 - 1_250_000);
      expect(before.total_balance).toBe(after.total_balance - 1_250_000);
      expect((await call('GET', '/api/transactions?kind=transfer', null, s.t)).body.transactions).toHaveLength(2);
    });
    it('trùng khoản ghi tay (cùng ví, số tiền, ngày) → hỏi gộp; gộp giữ khoản ngân hàng, lấy danh mục ghi tay', async () => {
      const s = await setup();
      const manual = (await call('POST', '/api/transactions', { kind: 'expense', amount: 56_000, wallet_id: s.bankW.id, category_id: s.cat('Ăn ngoài'), note: 'Ăn trưa' }, s.t)).body.transaction;
      const l = await link(s);
      await send(l, payload());
      const p = (await pending(s.t))[0];
      expect(p.duplicate).toMatchObject({ id: manual.id, category_name: 'Ăn ngoài' });
      const m = await call('POST', `/api/bank/pending/${p.id}/merge`, null, s.t);
      expect(m.body.transaction).toMatchObject({ status: 'confirmed', category_id: s.cat('Ăn ngoài'), note: 'Ăn trưa', source: 'bank' });
      expect(await balanceOf(s.t, s.bankW.id)).toBe(10_000_000 - 56_000);
      expect((await call('GET', '/api/transactions', null, s.t)).body.summary.count).toBe(1);
    });
    it('"Đúng hết" chỉ xác nhận khoản có gợi ý rõ ràng; không sửa được số tiền giao dịch tự động', async () => {
      const s = await setup();
      const l = await link(s);
      await send(l, payload());
      await send(l, payload({ content: 'NGUYEN VAN C', transferAmount: 70_000 }));
      expect((await call('POST', '/api/bank/pending/confirm-all', null, s.t)).body.confirmed).toBe(1);
      const left = await pending(s.t);
      expect(left).toHaveLength(1);
      expect((await call('PATCH', `/api/transactions/${left[0].id}`, { amount: 1 }, s.t)).status).toBe(400);
      expect((await call('PATCH', `/api/transactions/${left[0].id}`, { note: 'ok' }, s.t)).status).toBe(200);
      expect((await call('GET', '/api/summary', null, s.t)).body.alerts.map(a => a.kind)).toContain('bank_pending');
    });
  });

  describe('ảnh hoá đơn', () => {
    const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1000, 7)]);
    it('đính, xem, xoá ảnh; chặn file không phải ảnh / quá 200 KB', async () => {
      const s = await setup();
      const t1 = (await call('POST', '/api/transactions', { kind: 'expense', amount: 161_000, wallet_id: s.bankW.id }, s.t)).body.transaction;
      expect((await call('PUT', `/api/transactions/${t1.id}/receipt`, { data: jpeg.toString('base64') }, s.t)).status).toBe(200);
      expect((await call('GET', `/api/transactions/${t1.id}`, null, s.t)).body.transaction.has_receipt).toBe(true);
      const img = await fetch(`${app.base}/api/transactions/${t1.id}/receipt`, { headers: { Authorization: `Bearer ${s.t}` } });
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      expect(Buffer.from(await img.arrayBuffer()).equals(jpeg)).toBe(true);
      expect((await call('PUT', `/api/transactions/${t1.id}/receipt`, { data: Buffer.from('<svg>').toString('base64') }, s.t)).status).toBe(400);
      expect((await call('PUT', `/api/transactions/${t1.id}/receipt`, { data: Buffer.concat([jpeg, Buffer.alloc(210 * 1024)]).toString('base64') }, s.t)).status).toBe(400);
      expect((await call('DELETE', `/api/transactions/${t1.id}/receipt`, null, s.t)).status).toBe(200);
      expect((await fetch(`${app.base}/api/transactions/${t1.id}/receipt`, { headers: { Authorization: `Bearer ${s.t}` } })).status).toBe(404);
    });
    it('xoá giao dịch → quá thời gian hoàn tác, cron xoá hẳn giao dịch và ảnh', async () => {
      const s = await setup();
      const t1 = (await call('POST', '/api/transactions', { kind: 'expense', amount: 1000, wallet_id: s.bankW.id }, s.t)).body.transaction;
      await call('PUT', `/api/transactions/${t1.id}/receipt`, { data: jpeg.toString('base64') }, s.t);
      await call('DELETE', `/api/transactions/${t1.id}`, null, s.t);
      await sql("UPDATE transactions SET deleted_at = NOW() - INTERVAL '2 days' WHERE id = $1", [t1.id]);
      const c = await fetch(`${app.base}/api/cron/daily`, { headers: { Authorization: `Bearer ${config.CRON_SECRET}` } });
      expect((await c.json()).purged).toBe(1);
      expect((await sql('SELECT COUNT(*)::int AS n FROM transaction_receipts')).rows[0].n).toBe(0);
    });
  });

  describe('chống đọc / sửa chéo', () => {
    it('user B không thấy, không xác nhận, không sửa được liên kết / khoản chờ / ảnh của A; mã của A không gửi vào liên kết B được', async () => {
      const a = await setup();
      const b = await setup();
      const la = await link(a);
      const lb = await link(b);
      await send(la, payload());
      const pa = (await pending(a.t))[0];
      const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64');
      await call('PUT', `/api/transactions/${pa.id}/receipt`, { data: jpeg }, a.t);
      expect(await pending(b.t)).toEqual([]);
      expect((await call('GET', '/api/bank/links', null, b.t)).body.links.map(x => x.id)).toEqual([lb.id]);
      expect((await call('GET', `/api/bank/links/${la.id}/events`, null, b.t)).status).toBe(404);
      expect((await call('PATCH', `/api/bank/links/${la.id}`, { active: false }, b.t)).status).toBe(404);
      expect((await call('POST', `/api/bank/links/${la.id}/rotate`, null, b.t)).status).toBe(404);
      expect((await call('DELETE', `/api/bank/links/${la.id}`, null, b.t)).status).toBe(404);
      expect((await call('POST', `/api/bank/pending/${pa.id}/confirm`, {}, b.t)).status).toBe(404);
      expect((await call('POST', `/api/bank/pending/${pa.id}/merge`, null, b.t)).status).toBe(404);
      expect((await call('POST', '/api/bank/links', { wallet_id: a.bankW.id }, b.t)).status).toBe(400);
      expect((await fetch(`${app.base}/api/transactions/${pa.id}/receipt`, { headers: { Authorization: `Bearer ${b.t}` } })).status).toBe(404);
      expect((await call('PUT', `/api/transactions/${pa.id}/receipt`, { data: jpeg }, b.t)).status).toBe(404);
      // Mã bí mật của A không dùng được cho liên kết của B
      expect((await send(lb, payload(), la.secret)).status).toBe(401);
      expect((await call('POST', '/api/bank/pending/confirm-all', null, b.t)).body.confirmed).toBe(0);
      expect((await pending(a.t))[0].status).toBe('pending');
    });
  });
});
