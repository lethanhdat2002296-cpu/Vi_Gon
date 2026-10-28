// Liên kết ngân hàng (F12).
//   POST /api/hook/:hookId        công khai, SePay gọi khi có biến động số dư (kiểm mã bí mật mỗi lần)
//   /api/bank/links               quản lý liên kết (cần đăng nhập, đã xác minh email)
//   /api/bank/pending             hộp "Chờ xác nhận": Đúng / Đổi / Gộp / chuyển giữa ví
const crypto = require('crypto');
const express = require('express');
const db = require('../lib/db');
const config = require('../config');
const bank = require('../services/bank');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const { checkRateLimit } = require('../utils/ratelimit');
const { toId } = require('../utils/params');
const { SELECT_TX, publicTx, helpers: tx } = require('./transactions');

const ok = res => res.status(200).json({ success: true });

async function logEvent(linkId, result, detail) {
  try {
    await db.query('INSERT INTO bank_events (link_id, result, detail) VALUES ($1, $2, $3)', [linkId, result, String(detail || '').slice(0, 300)]);
    // Giữ 200 dòng gần nhất mỗi liên kết
    await db.query(
      `DELETE FROM bank_events WHERE link_id = $1 AND id NOT IN (SELECT id FROM bank_events WHERE link_id = $1 ORDER BY id DESC LIMIT 200)`,
      [linkId]
    );
  } catch (e) { console.error('Lỗi ghi nhật ký ngân hàng:', e.message); }
}

// ============ WEBHOOK CÔNG KHAI ============
const hook = express.Router();
hook.post('/:hookId', async (req, res, next) => {
  try {
    const hookId = String(req.params.hookId || '');
    if (!/^h_[A-Za-z0-9_-]{8,40}$/.test(hookId)) return res.status(404).json({ error: 'Không tìm thấy' });
    const rl = await checkRateLimit(`hook:${hookId}`, 120, 60 * 1000);
    if (!rl.allowed) return res.status(rl.error ? 503 : 429).json({ error: 'Quá nhiều yêu cầu' });
    const lr = await db.query('SELECT * FROM bank_links WHERE hook_id = $1 AND active', [hookId]);
    const link = lr.rows[0];
    if (!link) return res.status(404).json({ error: 'Không tìm thấy' });

    // Kiểm mã bí mật mọi lần nhận; sai thì bỏ qua và ghi nhật ký
    if (!bank.checkApiKey(req.headers.authorization, link.secret_hash)) {
      await logEvent(link.id, 'rejected', 'Sai hoặc thiếu mã bí mật (Authorization: Apikey …)');
      return res.status(401).json({ error: 'Sai mã bí mật' });
    }
    const p = bank.parseSepay(req.body);
    if (p.error) {
      await logEvent(link.id, 'ignored', 'Dữ liệu không hợp lệ: ' + p.error);
      return res.status(400).json({ error: p.error });
    }
    if (link.account_last4 && p.account_last4 && p.account_last4 !== link.account_last4) {
      await logEvent(link.id, 'ignored', `Tài khoản ···${p.account_last4} khác tài khoản đã liên kết ···${link.account_last4}`);
      return ok(res);
    }

    const bookId = Number(link.book_id);
    const [cats, learned, wallets] = await Promise.all([
      db.query('SELECT id, name, kind, parent_id FROM categories WHERE book_id = $1 AND archived_at IS NULL', [bookId]),
      db.query('SELECT keyword, kind, category_id, hits FROM category_rules WHERE book_id = $1', [bookId]),
      db.query('SELECT id, name FROM wallets WHERE book_id = $1 AND archived_at IS NULL', [bookId])
    ]);
    const sug = bank.suggestCategory(p.note, p.kind, cats.rows, learned.rows);
    const transferWallet = bank.suggestTransferWallet(p.note, wallets.rows, link.wallet_id);
    // Trùng với khoản ghi tay: cùng ví, cùng loại, cùng số tiền, cùng ngày (giờ VN)
    const dup = await db.query(
      `SELECT id FROM transactions
       WHERE book_id = $1 AND wallet_id = $2 AND kind = $3 AND amount = $4 AND deleted_at IS NULL AND source = 'manual'
         AND (occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ($5::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       ORDER BY occurred_at DESC LIMIT 1`,
      [bookId, link.wallet_id, p.kind, p.amount, p.occurred_at]
    );
    const dupId = dup.rows[0] ? Number(dup.rows[0].id) : null;
    const status = link.auto_confirm && !transferWallet && !dupId && sug ? 'confirmed' : 'pending';

    // Mã giao dịch ngân hàng là duy nhất trong sổ → gửi lại bao nhiêu lần cũng chỉ 1 giao dịch
    const ins = await db.query(
      `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source, external_ref, status, suggest_wallet_id, duplicate_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'bank', $9, $10, $11, $12)
       ON CONFLICT (book_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [bookId, link.user_id, link.wallet_id, transferWallet ? null : (sug ? sug.category_id : null), p.kind, p.amount, p.occurred_at,
        p.note, p.ref, status, transferWallet, dupId]
    );
    await db.query('UPDATE bank_links SET last_event_at = NOW() WHERE id = $1', [link.id]);
    if (ins.rows[0]) await logEvent(link.id, 'created', `${p.kind === 'income' ? '+' : '−'}${p.amount} · ${p.note.slice(0, 80)}`);
    else await logEvent(link.id, 'duplicate', `Đã có giao dịch ${p.ref}`);
    return ok(res);
  } catch (e) { next(e); }
});

// ============ QUẢN LÝ LIÊN KẾT ============
const router = express.Router();
router.use(authRequired, bookRequired);

// Địa chỉ gốc: APP_URL nếu đã đặt, không thì lấy theo tên miền đang truy cập (Vercel đặt x-forwarded-*)
function baseUrl(req) {
  if (process.env.APP_URL) return config.APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}
function publicLink(l, req) {
  return {
    id: Number(l.id), provider: l.provider, hook_url: `${baseUrl(req)}/api/hook/${l.hook_id}`, wallet_id: Number(l.wallet_id), wallet_name: l.wallet_name,
    account_last4: l.account_last4, auto_confirm: l.auto_confirm, active: l.active, last_event_at: l.last_event_at, created_at: l.created_at
  };
}
async function getLink(bookId, id) {
  if (!id) return null;
  const r = await db.query('SELECT l.*, w.name AS wallet_name FROM bank_links l JOIN wallets w ON w.id = l.wallet_id WHERE l.id = $1 AND l.book_id = $2', [id, bookId]);
  return r.rows[0] || null;
}

router.get('/links', async (req, res, next) => {
  try {
    const r = await db.query('SELECT l.*, w.name AS wallet_name FROM bank_links l JOIN wallets w ON w.id = l.wallet_id WHERE l.book_id = $1 ORDER BY l.id', [req.bookId]);
    res.json({ links: r.rows.map(l => publicLink(l, req)) });
  } catch (e) { next(e); }
});

// Tạo liên kết: trả mã bí mật DUY NHẤT 1 lần để dán vào SePay (ô API Key)
router.post('/links', canWrite, async (req, res, next) => {
  try {
    const u = await db.query('SELECT email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!u.rows[0] || !u.rows[0].email_verified_at) return res.status(403).json({ error: 'Cần xác minh email trước khi liên kết ngân hàng', need_verify: true });
    const b = req.body || {};
    const w = await tx.usableWallet(req.bookId, toId(b.wallet_id));
    if (!w) return res.status(400).json({ error: 'Chọn ví nhận giao dịch' });
    if (b.account_last4 !== undefined && b.account_last4 !== null && b.account_last4 !== '' && !/^\d{4}$/.test(String(b.account_last4))) {
      return res.status(400).json({ error: '4 số cuối tài khoản không hợp lệ' });
    }
    const secret = bank.newSecret();
    const r = await db.query(
      `INSERT INTO bank_links (book_id, user_id, hook_id, secret_hash, wallet_id, account_last4, auto_confirm)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.bookId, req.user.id, bank.newHookId(), bank.hashSecret(secret), w.id, b.account_last4 || null, b.auto_confirm === true]
    );
    res.status(201).json({ link: publicLink(await getLink(req.bookId, Number(r.rows[0].id)), req), secret });
  } catch (e) { next(e); }
});

router.post('/links/:id/rotate', canWrite, async (req, res, next) => {
  try {
    const l = await getLink(req.bookId, toId(req.params.id));
    if (!l) return res.status(404).json({ error: 'Không tìm thấy liên kết' });
    const secret = bank.newSecret();
    await db.query('UPDATE bank_links SET secret_hash = $2 WHERE id = $1', [l.id, bank.hashSecret(secret)]);
    res.json({ link: publicLink(l, req), secret });
  } catch (e) { next(e); }
});

router.patch('/links/:id', canWrite, async (req, res, next) => {
  try {
    const l = await getLink(req.bookId, toId(req.params.id));
    if (!l) return res.status(404).json({ error: 'Không tìm thấy liên kết' });
    const b = req.body || {};
    const sets = [], vals = [l.id];
    const add = (c, v) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
    for (const k of ['auto_confirm', 'active']) {
      if (k in b) { if (typeof b[k] !== 'boolean') return res.status(400).json({ error: `${k} phải là true/false` }); add(k, b[k]); }
    }
    if ('account_last4' in b) {
      if (b.account_last4 !== null && b.account_last4 !== '' && !/^\d{4}$/.test(String(b.account_last4))) return res.status(400).json({ error: '4 số cuối không hợp lệ' });
      add('account_last4', b.account_last4 || null);
    }
    if ('wallet_id' in b) {
      const w = await tx.usableWallet(req.bookId, toId(b.wallet_id));
      if (!w) return res.status(400).json({ error: 'Ví không hợp lệ' });
      add('wallet_id', Number(w.id));
    }
    if (!sets.length) return res.status(400).json({ error: 'Không có gì để cập nhật' });
    await db.query(`UPDATE bank_links SET ${sets.join(', ')} WHERE id = $1`, vals);
    res.json({ link: publicLink(await getLink(req.bookId, Number(l.id)), req) });
  } catch (e) { next(e); }
});

router.delete('/links/:id', canWrite, async (req, res, next) => {
  try {
    const r = await db.query('DELETE FROM bank_links WHERE id = $1 AND book_id = $2 RETURNING id', [toId(req.params.id), req.bookId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy liên kết' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/links/:id/events', async (req, res, next) => {
  try {
    const l = await getLink(req.bookId, toId(req.params.id));
    if (!l) return res.status(404).json({ error: 'Không tìm thấy liên kết' });
    const r = await db.query('SELECT received_at, result, detail FROM bank_events WHERE link_id = $1 ORDER BY id DESC LIMIT 30', [l.id]);
    res.json({ events: r.rows });
  } catch (e) { next(e); }
});

// ============ CHỜ XÁC NHẬN ============
router.get('/pending', async (req, res, next) => {
  try {
    const r = await db.query(
      `${SELECT_TX} WHERE t.book_id = $1 AND t.status = 'pending' AND t.deleted_at IS NULL ORDER BY t.occurred_at DESC, t.id DESC LIMIT 100`,
      [req.bookId]
    );
    const extra = await db.query(
      `SELECT t.id, sw.name AS suggest_wallet_name, d.note AS dup_note, d.occurred_at AS dup_at, dc.name AS dup_category
       FROM transactions t LEFT JOIN wallets sw ON sw.id = t.suggest_wallet_id
       LEFT JOIN transactions d ON d.id = t.duplicate_of AND d.deleted_at IS NULL LEFT JOIN categories dc ON dc.id = d.category_id
       WHERE t.book_id = $1 AND t.status = 'pending' AND t.deleted_at IS NULL`,
      [req.bookId]
    );
    const byId = {};
    extra.rows.forEach(x => { byId[x.id] = x; });
    res.json({
      pending: r.rows.map(t => {
        const x = byId[t.id] || {};
        return {
          ...publicTx(t),
          suggest_wallet_name: x.suggest_wallet_name || null,
          duplicate: t.duplicate_of && x.dup_at ? { id: Number(t.duplicate_of), note: x.dup_note, category_name: x.dup_category, occurred_at: x.dup_at } : null
        };
      })
    });
  } catch (e) { next(e); }
});

async function getPending(bookId, id) {
  if (!id) return null;
  const r = await db.query(`SELECT * FROM transactions WHERE id = $1 AND book_id = $2 AND status = 'pending' AND deleted_at IS NULL`, [id, bookId]);
  return r.rows[0] || null;
}

// Học: nội dung CK → danh mục người dùng chọn
async function learn(bookId, t, categoryId) {
  const kw = bank.learnKeyword(t.note);
  if (!kw) return null;
  await db.query(
    `INSERT INTO category_rules (book_id, keyword, kind, category_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (book_id, kind, keyword) DO UPDATE SET category_id = EXCLUDED.category_id,
       hits = CASE WHEN category_rules.category_id = EXCLUDED.category_id THEN category_rules.hits + 1 ELSE 1 END, updated_at = NOW()`,
    [bookId, kw, t.kind, categoryId]
  );
  return kw;
}

// Đúng (giữ gợi ý) / Đổi (category_id khác) / là chuyển giữa ví (transfer_wallet_id)
router.post('/pending/:id/confirm', canWrite, async (req, res, next) => {
  try {
    const t = await getPending(req.bookId, toId(req.params.id));
    if (!t) return res.status(404).json({ error: 'Không có giao dịch chờ này' });
    const b = req.body || {};
    if (b.transfer_wallet_id !== undefined && b.transfer_wallet_id !== null) {
      const other = await tx.usableWallet(req.bookId, toId(b.transfer_wallet_id));
      if (!other || Number(other.id) === Number(t.wallet_id)) return res.status(400).json({ error: 'Chọn ví còn lại của khoản chuyển' });
      const group = crypto.randomUUID();
      await db.withTransaction(async (client) => {
        await client.query(
          `UPDATE transactions SET transfer_group = $2, category_id = NULL, status = 'confirmed', suggest_wallet_id = NULL, duplicate_of = NULL, updated_at = NOW() WHERE id = $1`,
          [t.id, group]
        );
        await client.query(
          `INSERT INTO transactions (book_id, user_id, wallet_id, kind, amount, occurred_at, note, source, transfer_group)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'transfer', $8)`,
          [req.bookId, req.user.id, other.id, t.kind === 'expense' ? 'income' : 'expense', t.amount, t.occurred_at, t.note, group]
        );
      });
      return res.json({ transaction: publicTx(await tx.getTx(req.bookId, Number(t.id))) });
    }
    let categoryId = t.category_id === null ? null : Number(t.category_id);
    let learned = null;
    if (b.category_id !== undefined) {
      if (b.category_id === null) categoryId = null;
      else {
        const c = await tx.usableCategory(req.bookId, toId(b.category_id), t.kind);
        if (!c) return res.status(400).json({ error: 'Danh mục không hợp lệ' });
        // Người dùng sửa gợi ý → học để lần sau gợi ý đúng
        if (Number(c.id) !== categoryId) learned = await learn(req.bookId, t, Number(c.id));
        categoryId = Number(c.id);
      }
    }
    await db.query(
      `UPDATE transactions SET category_id = $2, status = 'confirmed', suggest_wallet_id = NULL, duplicate_of = NULL, updated_at = NOW() WHERE id = $1`,
      [t.id, categoryId]
    );
    res.json({ transaction: publicTx(await tx.getTx(req.bookId, Number(t.id))), learned });
  } catch (e) { next(e); }
});

// Gộp với khoản ghi tay trùng: giữ khoản ngân hàng (có mã), lấy danh mục + ghi chú của khoản ghi tay, xoá khoản ghi tay
router.post('/pending/:id/merge', canWrite, async (req, res, next) => {
  try {
    const t = await getPending(req.bookId, toId(req.params.id));
    if (!t || !t.duplicate_of) return res.status(404).json({ error: 'Không có khoản trùng để gộp' });
    const d = await db.query('SELECT * FROM transactions WHERE id = $1 AND book_id = $2 AND deleted_at IS NULL', [t.duplicate_of, req.bookId]);
    const m = d.rows[0];
    if (!m) return res.status(404).json({ error: 'Khoản ghi tay không còn' });
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE transactions SET category_id = COALESCE($2, category_id), note = CASE WHEN $3 <> '' THEN $3 ELSE note END,
           status = 'confirmed', duplicate_of = NULL, suggest_wallet_id = NULL, updated_at = NOW() WHERE id = $1`,
        [t.id, m.category_id, m.note]
      );
      await client.query('UPDATE transactions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [m.id]);
    });
    res.json({ transaction: publicTx(await tx.getTx(req.bookId, Number(t.id))), removed: Number(m.id) });
  } catch (e) { next(e); }
});

// "Đúng hết": xác nhận mọi khoản đã có gợi ý danh mục, không nghi trùng, không nghi chuyển ví
router.post('/pending/confirm-all', canWrite, async (req, res, next) => {
  try {
    const r = await db.query(
      `UPDATE transactions SET status = 'confirmed', updated_at = NOW()
       WHERE book_id = $1 AND status = 'pending' AND deleted_at IS NULL AND category_id IS NOT NULL AND suggest_wallet_id IS NULL AND duplicate_of IS NULL
       RETURNING id`,
      [req.bookId]
    );
    res.json({ confirmed: r.rowCount });
  } catch (e) { next(e); }
});

module.exports = { hook, router };
