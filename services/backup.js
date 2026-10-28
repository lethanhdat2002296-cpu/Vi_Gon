// Sao lưu / khôi phục dữ liệu của 1 sổ (F08).
//   exportBook(bookId)          → object JSON (định dạng 'vi-gon-backup' v1)
//   importBackup(bookId, ...)   → thêm ví, danh mục, giao dịch từ bản sao lưu (1 transaction SQL)
//   importRows(bookId, ...)     → thêm giao dịch từ các dòng Excel mẫu
// Tiền luôn là số nguyên VND; mọi dữ liệu nhập được kiểm như khi nhập tay.
const crypto = require('crypto');
const db = require('../lib/db');
const { MAX_VND } = require('../utils/money');

const FORMAT = 'vi-gon-backup';
const VERSION = 1;
const MAX_TX = 50000;
const WALLET_TYPES = ['cash', 'bank', 'ewallet', 'credit', 'savings'];
const SOURCES = ['manual', 'adjust', 'transfer', 'bank', 'recurring', 'import'];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// So khớp tên không phân biệt hoa thường và dấu (giống vn_fold trong SQL)
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();
}

async function exportBook(bookId) {
  const [w, c, t] = await Promise.all([
    db.query('SELECT * FROM wallets WHERE book_id = $1 ORDER BY sort_order, id', [bookId]),
    db.query('SELECT * FROM categories WHERE book_id = $1 ORDER BY (parent_id IS NOT NULL), kind, sort_order, id', [bookId]),
    db.query('SELECT * FROM transactions WHERE book_id = $1 AND deleted_at IS NULL ORDER BY occurred_at, id', [bookId])
  ]);
  return {
    format: FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    wallets: w.rows.map(x => ({
      ref: String(x.id), name: x.name, type: x.type, color: x.color,
      opening_balance: Number(x.opening_balance), exclude_from_total: x.exclude_from_total,
      credit_limit: x.credit_limit === null ? null : Number(x.credit_limit), due_day: x.due_day,
      sort_order: x.sort_order, archived: !!x.archived_at
    })),
    categories: c.rows.map(x => ({
      ref: String(x.id), name: x.name, kind: x.kind, parent_ref: x.parent_id === null ? null : String(x.parent_id),
      color: x.color, icon: x.icon, sort_order: x.sort_order
    })),
    transactions: t.rows.map(x => ({
      wallet_ref: String(x.wallet_id), category_ref: x.category_id === null ? null : String(x.category_id),
      kind: x.kind, amount: Number(x.amount), occurred_at: new Date(x.occurred_at).toISOString(),
      note: x.note, source: x.source, transfer_ref: x.transfer_group || null
    }))
  };
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const isInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

// Kiểm toàn bộ bản sao lưu trước khi ghi gì vào DB
function validateBackup(data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw bad('File không phải bản sao lưu Ví Gọn');
  if (data.version !== VERSION) throw bad('Phiên bản sao lưu không hỗ trợ');
  const { wallets, categories, transactions } = data;
  if (!Array.isArray(wallets) || !Array.isArray(categories) || !Array.isArray(transactions)) throw bad('Bản sao lưu thiếu dữ liệu');
  if (wallets.length > 500 || categories.length > 2000 || transactions.length > MAX_TX) throw bad('Bản sao lưu quá lớn');

  const wRefs = new Set();
  wallets.forEach((w, i) => {
    const where = `Ví #${i + 1}`;
    if (!w || typeof w.ref !== 'string' || wRefs.has(w.ref)) throw bad(`${where}: mã ví không hợp lệ`);
    if (!str(w.name, 60)) throw bad(`${where}: tên ví không hợp lệ`);
    if (!WALLET_TYPES.includes(w.type)) throw bad(`${where}: loại ví không hợp lệ`);
    if (!isInt(w.opening_balance, -MAX_VND, MAX_VND)) throw bad(`${where}: số dư đầu không hợp lệ`);
    if (w.credit_limit !== null && w.credit_limit !== undefined && !isInt(w.credit_limit, 0, MAX_VND)) throw bad(`${where}: hạn mức không hợp lệ`);
    if (w.due_day !== null && w.due_day !== undefined && !isInt(w.due_day, 1, 31)) throw bad(`${where}: ngày đến hạn không hợp lệ`);
    wRefs.add(w.ref);
  });
  const cRefs = new Map();
  categories.forEach((c, i) => {
    const where = `Danh mục #${i + 1}`;
    if (!c || typeof c.ref !== 'string' || cRefs.has(c.ref)) throw bad(`${where}: mã danh mục không hợp lệ`);
    if (!str(c.name, 40)) throw bad(`${where}: tên không hợp lệ`);
    if (!['expense', 'income'].includes(c.kind)) throw bad(`${where}: loại không hợp lệ`);
    cRefs.set(c.ref, c);
  });
  for (const c of categories) {
    if (c.parent_ref === null || c.parent_ref === undefined) continue;
    const p = cRefs.get(c.parent_ref);
    if (!p || p.parent_ref || p.kind !== c.kind) throw bad(`Danh mục "${c.name}": danh mục cha không hợp lệ`);
  }
  const groups = new Map();
  transactions.forEach((t, i) => {
    const where = `Giao dịch #${i + 1}`;
    if (!t || !wRefs.has(t.wallet_ref)) throw bad(`${where}: ví không tồn tại trong bản sao lưu`);
    if (!['expense', 'income'].includes(t.kind)) throw bad(`${where}: loại không hợp lệ`);
    if (!isInt(t.amount, 1, MAX_VND)) throw bad(`${where}: số tiền không hợp lệ`);
    if (typeof t.occurred_at !== 'string' || isNaN(new Date(t.occurred_at))) throw bad(`${where}: thời điểm không hợp lệ`);
    if (t.note !== undefined && t.note !== null && (typeof t.note !== 'string' || t.note.length > 200)) throw bad(`${where}: ghi chú không hợp lệ`);
    if (t.source !== undefined && !SOURCES.includes(t.source)) throw bad(`${where}: nguồn không hợp lệ`);
    if (t.category_ref !== null && t.category_ref !== undefined) {
      const c = cRefs.get(t.category_ref);
      if (!c || c.kind !== t.kind) throw bad(`${where}: danh mục không hợp lệ`);
    }
    if (t.transfer_ref) {
      const g = groups.get(t.transfer_ref) || [];
      g.push(t);
      groups.set(t.transfer_ref, g);
    }
  });
  // Mỗi khoản chuyển tiền phải đủ cặp: 1 chi + 1 thu cùng số tiền
  for (const [ref, g] of groups) {
    const kinds = g.map(x => x.kind).sort().join(',');
    if (g.length !== 2 || kinds !== 'expense,income' || g[0].amount !== g[1].amount) throw bad(`Khoản chuyển tiền ${ref.slice(0, 8)} không đủ cặp`);
  }
}

// Ghép danh mục nhập vào danh mục đang có (cùng loại + tên, không dấu); thiếu thì tạo mới.
async function mapCategories(client, bookId, categories) {
  const existing = (await client.query('SELECT id, name, kind, parent_id FROM categories WHERE book_id = $1', [bookId])).rows;
  const key = (kind, parentId, name) => `${kind}|${parentId || ''}|${fold(name)}`;
  const index = new Map(existing.map(c => [key(c.kind, c.parent_id && String(c.parent_id), c.name), Number(c.id)]));
  const map = new Map();
  let created = 0;
  // Cấp 1 trước rồi mới tới mục con
  const ordered = categories.filter(c => !c.parent_ref).concat(categories.filter(c => c.parent_ref));
  for (const c of ordered) {
    const parentId = c.parent_ref ? map.get(c.parent_ref) : null;
    const k = key(c.kind, parentId && String(parentId), c.name);
    let id = index.get(k);
    if (!id) {
      const r = await client.query(
        `INSERT INTO categories (book_id, name, kind, parent_id, color, icon, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [bookId, c.name.trim(), c.kind, parentId, COLOR_RE.test(c.color) ? c.color : '#9AA79F',
          typeof c.icon === 'string' ? c.icon.slice(0, 8) : '', Number.isInteger(c.sort_order) ? c.sort_order : 0]
      );
      id = Number(r.rows[0].id);
      index.set(k, id);
      created++;
    }
    map.set(c.ref, id);
  }
  return { map, created };
}

// Ghi nhiều giao dịch 1 lần (unnest) — nhanh với hàng chục nghìn dòng
async function insertTransactions(client, bookId, userId, rows) {
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await client.query(
      `INSERT INTO transactions (book_id, user_id, wallet_id, category_id, kind, amount, occurred_at, note, source, transfer_group)
       SELECT $1, $2, w, c, k, a, o, n, s, g
       FROM unnest($3::bigint[], $4::bigint[], $5::text[], $6::bigint[], $7::timestamptz[], $8::text[], $9::text[], $10::uuid[])
         AS x(w, c, k, a, o, n, s, g)`,
      [bookId, userId, part.map(r => r.wallet_id), part.map(r => r.category_id), part.map(r => r.kind),
        part.map(r => r.amount), part.map(r => r.occurred_at), part.map(r => r.note || ''), part.map(r => r.source || 'manual'),
        part.map(r => r.transfer_group || null)]
    );
  }
}

async function importBackup(bookId, userId, data) {
  validateBackup(data);
  return db.withTransaction(async (client) => {
    const existingNames = new Set((await client.query('SELECT name FROM wallets WHERE book_id = $1', [bookId])).rows.map(r => fold(r.name)));
    const walletMap = new Map();
    for (const w of data.wallets) {
      // Trùng tên ví đang có → thêm "(nhập)" để không lẫn
      let name = w.name.trim();
      if (existingNames.has(fold(name))) name = `${name.slice(0, 52)} (nhập)`;
      existingNames.add(fold(name));
      const r = await client.query(
        `INSERT INTO wallets (book_id, name, type, color, opening_balance, exclude_from_total, credit_limit, due_day, sort_order, archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [bookId, name, w.type, COLOR_RE.test(w.color) ? w.color : '#0D6B5E', w.opening_balance, !!w.exclude_from_total,
          w.credit_limit === undefined ? null : w.credit_limit, w.due_day === undefined ? null : w.due_day,
          Number.isInteger(w.sort_order) ? w.sort_order : 0, w.archived ? new Date() : null]
      );
      walletMap.set(w.ref, Number(r.rows[0].id));
    }
    const cats = await mapCategories(client, bookId, data.categories);
    // Mã chuyển tiền mới cho từng cặp (không đụng cặp trong sổ khác)
    const groupMap = new Map();
    const rows = data.transactions.map(t => {
      let g = null;
      if (t.transfer_ref) {
        if (!groupMap.has(t.transfer_ref)) groupMap.set(t.transfer_ref, crypto.randomUUID());
        g = groupMap.get(t.transfer_ref);
      }
      return {
        wallet_id: walletMap.get(t.wallet_ref),
        category_id: t.transfer_ref ? null : (t.category_ref ? cats.map.get(t.category_ref) : null),
        kind: t.kind, amount: t.amount, occurred_at: new Date(t.occurred_at), note: t.note || '',
        source: t.transfer_ref ? 'transfer' : (t.source || 'manual'), transfer_group: g
      };
    });
    await insertTransactions(client, bookId, userId, rows);
    return { wallets: data.wallets.length, categories_created: cats.created, transactions: rows.length };
  });
}

module.exports = { FORMAT, VERSION, MAX_TX, fold, exportBook, validateBackup, importBackup, insertTransactions };
