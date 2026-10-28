// /api/books + /api/invites: sổ chung gia đình (F14)
// Quyền: owner (chủ sổ) / editor (thành viên) / viewer (người xem). Sổ cá nhân không mời được ai.
// Lời mời: link chứa token ngẫu nhiên (chỉ lưu sha256), hạn 7 ngày, dùng 1 lần; mời qua email thì
// chỉ đúng email đó nhận được.
const crypto = require('crypto');
const express = require('express');
const db = require('../lib/db');
const { authRequired, passwordConfirmRequired } = require('../middleware/auth');
const books = require('../services/books');
const email = require('../utils/email');
const { toId, cleanText } = require('../utils/params');
const { validateEmail, normalizeEmail } = require('../utils/validators');
const { baseUrl } = require('../utils/url');

const router = express.Router();
router.use(authRequired);
const invites = express.Router();
invites.use(authRequired);

const ROLES = ['editor', 'viewer'];
const INVITE_DAYS = 7;
const MAX_MEMBERS = 20;
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function validName(v) {
  const name = cleanText(v, 60);
  return name ? name : null;
}

async function loadBook(req, res) {
  const id = toId(req.params.id);
  const info = id && await books.membership(id, req.user.id);
  if (!info) { res.status(404).json({ error: 'Không tìm thấy sổ' }); return null; }
  return { id, ...info };
}

router.get('/', async (req, res, next) => {
  try {
    await books.ensurePersonalBook(req.user.id);
    const r = await db.query(
      `SELECT b.id, b.name, b.kind, m.role, u.full_name AS owner_name,
              (SELECT COUNT(*) FROM book_members x WHERE x.book_id = b.id)::int AS members
       FROM book_members m JOIN books b ON b.id = m.book_id JOIN users u ON u.id = b.owner_id
       WHERE m.user_id = $1 ORDER BY (b.kind = 'personal') DESC, b.created_at`,
      [req.user.id]
    );
    res.json({ books: r.rows.map(b => ({ id: Number(b.id), name: b.kind === 'personal' ? 'Sổ của tôi' : b.name, kind: b.kind, role: b.role, owner_name: b.owner_name, members: b.members })) });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = validName((req.body || {}).name);
    if (!name) return res.status(400).json({ error: 'Nhập tên sổ (tối đa 60 ký tự)' });
    const n = await db.query("SELECT COUNT(*)::int AS n FROM books WHERE owner_id = $1 AND kind = 'shared'", [req.user.id]);
    if (n.rows[0].n >= 10) return res.status(400).json({ error: 'Tối đa 10 sổ chung' });
    const id = await books.createSharedBook(req.user.id, name);
    res.status(201).json({ book: { id, name, kind: 'shared', role: 'owner', members: 1 } });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    if (b.role !== 'owner' || b.kind !== 'shared') return res.status(403).json({ error: 'Chỉ chủ sổ chung đổi tên được' });
    const name = validName((req.body || {}).name);
    if (!name) return res.status(400).json({ error: 'Nhập tên sổ (tối đa 60 ký tự)' });
    await db.query('UPDATE books SET name = $2 WHERE id = $1', [b.id, name]);
    res.json({ ok: true, name });
  } catch (e) { next(e); }
});

// Xoá sổ chung (mất toàn bộ dữ liệu của sổ) — chủ sổ, nhập lại mật khẩu
router.delete('/:id', passwordConfirmRequired, async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    if (b.role !== 'owner' || b.kind !== 'shared') return res.status(403).json({ error: 'Chỉ chủ sổ chung xoá được sổ' });
    await db.query('DELETE FROM books WHERE id = $1', [b.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/members', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    const r = await db.query(
      `SELECT u.id, u.full_name, u.email, m.role, m.created_at FROM book_members m JOIN users u ON u.id = m.user_id
       WHERE m.book_id = $1 ORDER BY (m.role = 'owner') DESC, m.created_at`, [b.id]);
    const inv = b.role === 'owner' ? await db.query(
      `SELECT id, email, role, expires_at FROM invites WHERE book_id = $1 AND accepted_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`, [b.id]) : { rows: [] };
    res.json({
      members: r.rows.map(m => ({ id: Number(m.id), name: m.full_name || m.email.split('@')[0], email: b.role === 'owner' || Number(m.id) === req.user.id ? m.email : undefined, role: m.role, me: Number(m.id) === req.user.id })),
      invites: inv.rows.map(i => ({ id: Number(i.id), email: i.email, role: i.role, expires_at: i.expires_at })),
      role: b.role
    });
  } catch (e) { next(e); }
});

router.patch('/:id/members/:uid', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    if (b.role !== 'owner') return res.status(403).json({ error: 'Chỉ chủ sổ đổi quyền được' });
    const role = (req.body || {}).role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Quyền phải là thành viên hoặc người xem' });
    const r = await db.query(
      "UPDATE book_members SET role = $3 WHERE book_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING user_id",
      [b.id, toId(req.params.uid), role]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Chủ sổ mời ra, hoặc tự rời sổ. Giao dịch đã ghi ở lại sổ (hiện "Thành viên cũ").
router.delete('/:id/members/:uid', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    const uid = toId(req.params.uid);
    const self = uid === req.user.id;
    if (self && b.role === 'owner') return res.status(400).json({ error: 'Chủ sổ không rời được; hãy xoá sổ nếu không dùng nữa' });
    if (!self && b.role !== 'owner') return res.status(403).json({ error: 'Chỉ chủ sổ mời người khác ra được' });
    const r = await db.query("DELETE FROM book_members WHERE book_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING user_id", [b.id, uid]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/invites', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    if (b.kind !== 'shared') return res.status(400).json({ error: 'Sổ cá nhân không mời được; hãy tạo sổ chung' });
    if (b.role !== 'owner') return res.status(403).json({ error: 'Chỉ chủ sổ mời được' });
    const body = req.body || {};
    const role = body.role || 'editor';
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Quyền phải là thành viên hoặc người xem' });
    let addr = null;
    if (body.email) {
      const err = validateEmail(body.email);
      if (err) return res.status(400).json({ error: err });
      addr = normalizeEmail(body.email);
    }
    const cnt = await db.query(
      `SELECT (SELECT COUNT(*) FROM book_members WHERE book_id = $1)::int AS m,
              (SELECT COUNT(*) FROM invites WHERE book_id = $1 AND created_at > NOW() - INTERVAL '1 day')::int AS d`, [b.id]);
    if (cnt.rows[0].m >= MAX_MEMBERS) return res.status(400).json({ error: `Sổ tối đa ${MAX_MEMBERS} người` });
    if (cnt.rows[0].d >= 30) return res.status(429).json({ error: 'Đã tạo quá nhiều lời mời hôm nay' });
    const token = crypto.randomBytes(24).toString('base64url');
    const ins = await db.query(
      `INSERT INTO invites (book_id, token_hash, email, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${INVITE_DAYS} days') RETURNING id, expires_at`,
      [b.id, hashToken(token), addr, role, req.user.id]);
    const link = `${baseUrl(req)}/#/join/${token}`;
    let emailed = false;
    if (addr) {
      const info = await db.query(
        'SELECT k.name, u.full_name, u.email FROM books k JOIN users u ON u.id = $2 WHERE k.id = $1', [b.id, req.user.id]);
      const i = info.rows[0];
      emailed = (await email.sendInvite(addr, i.full_name || i.email, i.name, link)).ok;
    }
    res.status(201).json({ invite: { id: Number(ins.rows[0].id), email: addr, role, expires_at: ins.rows[0].expires_at }, link, emailed });
  } catch (e) { next(e); }
});

router.delete('/:id/invites/:iid', async (req, res, next) => {
  try {
    const b = await loadBook(req, res);
    if (!b) return;
    if (b.role !== 'owner') return res.status(403).json({ error: 'Chỉ chủ sổ huỷ lời mời được' });
    await db.query('DELETE FROM invites WHERE id = $1 AND book_id = $2', [toId(req.params.iid), b.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== Nhận lời mời =====
async function findInvite(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 64) return null;
  const r = await db.query(
    `SELECT i.*, k.name AS book_name, u.full_name AS inviter FROM invites i
     JOIN books k ON k.id = i.book_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.token_hash = $1`, [hashToken(token)]);
  return r.rows[0] || null;
}
function inviteProblem(inv, user) {
  if (!inv) return 'Lời mời không tồn tại';
  if (inv.accepted_at) return 'Lời mời đã được dùng';
  if (new Date(inv.expires_at) <= new Date()) return 'Lời mời đã hết hạn (7 ngày)';
  if (inv.email && inv.email !== String(user.email || '').toLowerCase()) return `Lời mời này dành cho ${inv.email}`;
  return null;
}
async function currentUser(id) {
  return (await db.query('SELECT id, email FROM users WHERE id = $1', [id])).rows[0];
}

invites.get('/:token', async (req, res, next) => {
  try {
    const inv = await findInvite(req.params.token);
    const problem = inviteProblem(inv, await currentUser(req.user.id));
    if (problem) return res.status(inv ? 410 : 404).json({ error: problem });
    const member = await books.membership(Number(inv.book_id), req.user.id);
    res.json({ book_id: Number(inv.book_id), book_name: inv.book_name, inviter: inv.inviter, role: inv.role, already_member: !!member });
  } catch (e) { next(e); }
});

invites.post('/:token/accept', async (req, res, next) => {
  try {
    const inv = await findInvite(req.params.token);
    const problem = inviteProblem(inv, await currentUser(req.user.id));
    if (problem) return res.status(inv ? 410 : 404).json({ error: problem });
    // Đánh dấu đã dùng trước (chống dùng 2 lần cùng lúc), rồi thêm thành viên
    const used = await db.withTransaction(async (client) => {
      const u = await client.query(
        'UPDATE invites SET accepted_at = NOW(), accepted_by = $2 WHERE id = $1 AND accepted_at IS NULL AND expires_at > NOW() RETURNING id',
        [inv.id, req.user.id]);
      if (!u.rows[0]) return false;
      await client.query(
        'INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (book_id, user_id) DO NOTHING',
        [inv.book_id, req.user.id, inv.role]);
      return true;
    });
    if (!used) return res.status(410).json({ error: 'Lời mời đã được dùng' });
    res.json({ ok: true, book: { id: Number(inv.book_id), name: inv.book_name } });
  } catch (e) { next(e); }
});

module.exports = { router, invites };
