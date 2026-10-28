// /api/data: xuất JSON toàn bộ, nhập lại JSON, file Excel mẫu, nhập giao dịch từ Excel mẫu (F08).
// Nhập là "tất cả hoặc không": có 1 dòng lỗi thì không ghi gì và trả danh sách lỗi.
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired, canWrite } = require('../middleware/book');
const backup = require('../services/backup');
const { buildXlsx } = require('../utils/xlsx');
const { readSheet, excelSerialToDate } = require('../utils/xlsx-read');
const { parseVnd, MAX_VND } = require('../utils/money');
const { nowInTimezone } = require('../utils/time');
const { checkRateLimit } = require('../utils/ratelimit');

const router = express.Router();
router.use(authRequired, bookRequired);

const MAX_ROWS = 5000;
const fold = backup.fold;

// Sau khi nhập có ví → coi như đã làm quen xong
async function markOnboarded(req) {
  await db.query(
    `UPDATE users SET onboarded_at = COALESCE(onboarded_at, NOW()) WHERE id = $1
       AND EXISTS (SELECT 1 FROM wallets WHERE book_id = $2)`,
    [req.user.id, req.bookId]
  );
}

async function importLimit(req, res) {
  const rl = await checkRateLimit(`import:${req.user.id}`, 20, 3600 * 1000);
  if (!rl.allowed) { res.status(rl.error ? 503 : 429).json({ error: 'Nhập dữ liệu quá nhiều lần, thử lại sau.' }); return false; }
  return true;
}

// ============ XUẤT JSON ============
router.get('/export.json', async (req, res, next) => {
  try {
    const data = await backup.exportBook(req.bookId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vi-gon-sao-luu-${nowInTimezone().date}.json"`);
    res.send(JSON.stringify(data, null, 1));
  } catch (e) { next(e); }
});

// ============ NHẬP JSON (thêm vào sổ đang dùng) ============
router.post('/import.json', canWrite, async (req, res, next) => {
  try {
    if (!(await importLimit(req, res))) return;
    const result = await backup.importBackup(req.bookId, req.user.id, (req.body || {}).backup);
    await markOnboarded(req);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

// ============ EXCEL MẪU ============
const TEMPLATE_COLUMNS = [
  { header: 'Ngày', width: 13 }, { header: 'Loại', width: 8 }, { header: 'Số tiền', width: 14, type: 'money' },
  { header: 'Danh mục', width: 18 }, { header: 'Ví', width: 16 }, { header: 'Ghi chú', width: 32 }
];
router.get('/template.xlsx', async (req, res, next) => {
  try {
    const today = nowInTimezone().date.split('-').reverse().join('/');
    const buf = buildXlsx({
      sheetName: 'Giao dịch',
      columns: TEMPLATE_COLUMNS,
      rows: [
        [today, 'Chi', 45000, 'Ăn uống', 'Tiền mặt', 'Phở bò (dòng ví dụ, xoá trước khi nhập)'],
        [today, 'Thu', 15000000, 'Lương', 'Tiền mặt', 'Lương tháng (dòng ví dụ, xoá trước khi nhập)']
      ]
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="vi-gon-mau-nhap.xlsx"');
    res.send(buf);
  } catch (e) { next(e); }
});

// Ngày trong ô Excel: số ngày kiểu Excel, "dd/mm/yyyy" hoặc "yyyy-mm-dd" → 'YYYY-MM-DD'
function cellDate(v) {
  if (typeof v === 'number') return excelSerialToDate(v);
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return { date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: s };
  return null;
}
function validDate(d) {
  const x = new Date(`${d}T12:00:00Z`);
  return !isNaN(x) && x.toISOString().slice(0, 10) === d;
}

// Đọc các dòng giao dịch từ file Excel mẫu. Trả { rows, errors }.
function parseTemplate(sheet, today) {
  const headerRow = sheet[0];
  if (!headerRow) return { rows: [], errors: [{ row: 1, error: 'File trống' }] };
  // Cột theo tên tiêu đề (không phân biệt dấu) → cho phép đổi thứ tự cột
  const want = { ngay: 'date', loai: 'kind', 'so tien': 'amount', 'danh muc': 'category', vi: 'wallet', 'ghi chu': 'note' };
  const col = {};
  Object.keys(headerRow).forEach(k => { if (k !== '_r' && want[fold(headerRow[k])]) col[want[fold(headerRow[k])]] = k; });
  const missing = ['date', 'amount', 'wallet'].filter(k => !col[k]);
  if (missing.length) {
    return { rows: [], errors: [{ row: headerRow._r, error: 'Thiếu cột: ' + missing.map(k => ({ date: 'Ngày', amount: 'Số tiền', wallet: 'Ví' })[k]).join(', ') + '. Hãy dùng file mẫu.' }] };
  }
  const rows = [], errors = [];
  for (const r of sheet.slice(1)) {
    const get = k => (col[k] ? r[col[k]] : undefined);
    if (['date', 'kind', 'amount', 'category', 'wallet', 'note'].every(k => get(k) === undefined || get(k) === '')) continue;
    const fail = msg => errors.push({ row: r._r, error: msg });
    const d = cellDate(get('date'));
    if (!d || !validDate(d.date)) { fail('Ngày không hợp lệ (dd/mm/yyyy)'); continue; }
    if (d.date > today) { fail('Ngày ở tương lai'); continue; }
    const raw = get('amount');
    let amount = null, negative = false;
    if (typeof raw === 'number') { negative = raw < 0; amount = Number.isSafeInteger(Math.abs(raw)) ? Math.abs(raw) : null; } else if (raw !== undefined) {
      const s = String(raw).trim();
      negative = s.startsWith('-') || s.startsWith('−');
      amount = parseVnd(s.replace(/^[-−]/, ''));
    }
    if (!amount || amount > MAX_VND) { fail('Số tiền phải là số nguyên dương, tối đa 999.999.999.999'); continue; }
    const kindText = fold(get('kind'));
    let kind = kindText === 'chi' ? 'expense' : kindText === 'thu' ? 'income' : null;
    if (!kind && !kindText && negative) kind = 'expense';
    if (!kind) { fail('Loại phải là "Chi" hoặc "Thu"'); continue; }
    const wallet = String(get('wallet') || '').trim();
    if (!wallet || wallet.length > 60) { fail('Thiếu tên ví'); continue; }
    const category = String(get('category') || '').trim();
    if (category.length > 40) { fail('Tên danh mục quá dài'); continue; }
    const note = get('note') === undefined ? '' : String(get('note')).trim();
    if (note.length > 200) { fail('Ghi chú tối đa 200 ký tự'); continue; }
    if (rows.length >= MAX_ROWS) { fail(`Tối đa ${MAX_ROWS} dòng mỗi lần nhập`); break; }
    const time = d.time && d.time !== '00:00' ? d.time : '12:00';
    rows.push({ row: r._r, occurred_at: new Date(`${d.date}T${time}:00+07:00`), kind, amount, wallet, category, note });
  }
  if (!rows.length && !errors.length) errors.push({ row: 2, error: 'Không có dòng giao dịch nào' });
  return { rows, errors };
}

router.post('/import.xlsx', canWrite, async (req, res, next) => {
  try {
    if (!(await importLimit(req, res))) return;
    const b64 = (req.body || {}).file;
    if (typeof b64 !== 'string' || !b64) return res.status(400).json({ error: 'Chưa chọn file' });
    let sheet;
    try { sheet = readSheet(Buffer.from(b64, 'base64')); } catch (e) { return res.status(400).json({ error: e.message || 'Không đọc được file Excel' }); }
    const { rows, errors } = parseTemplate(sheet, nowInTimezone().date);
    if (errors.length) return res.status(400).json({ error: `File có ${errors.length} dòng lỗi, chưa nhập gì.`, errors: errors.slice(0, 50) });

    const result = await db.withTransaction(async (client) => {
      // Ví và danh mục khớp theo tên (không dấu); chưa có thì tạo mới
      const wallets = (await client.query('SELECT id, name FROM wallets WHERE book_id = $1 AND archived_at IS NULL ORDER BY id', [req.bookId])).rows;
      const cats = (await client.query('SELECT id, name, kind, parent_id FROM categories WHERE book_id = $1 ORDER BY (parent_id IS NOT NULL), id', [req.bookId])).rows;
      const wIndex = new Map(wallets.map(w => [fold(w.name), Number(w.id)]));
      const cIndex = new Map();
      cats.forEach(c => { const k = `${c.kind}|${fold(c.name)}`; if (!cIndex.has(k)) cIndex.set(k, Number(c.id)); });
      const createdWallets = [], createdCategories = [];
      const out = [];
      for (const r of rows) {
        let wid = wIndex.get(fold(r.wallet));
        if (!wid) {
          const w = await client.query(`INSERT INTO wallets (book_id, name, type) VALUES ($1, $2, 'cash') RETURNING id`, [req.bookId, r.wallet]);
          wid = Number(w.rows[0].id);
          wIndex.set(fold(r.wallet), wid);
          createdWallets.push(r.wallet);
        }
        let cid = null;
        if (r.category) {
          const k = `${r.kind}|${fold(r.category)}`;
          cid = cIndex.get(k);
          if (!cid) {
            const c = await client.query(
              `INSERT INTO categories (book_id, name, kind, sort_order)
               VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories WHERE book_id = $1 AND kind = $3 AND parent_id IS NULL))
               RETURNING id`,
              [req.bookId, r.category, r.kind]
            );
            cid = Number(c.rows[0].id);
            cIndex.set(k, cid);
            createdCategories.push(r.category);
          }
        }
        out.push({ wallet_id: wid, category_id: cid, kind: r.kind, amount: r.amount, occurred_at: r.occurred_at, note: r.note, source: 'import' });
      }
      await backup.insertTransactions(client, req.bookId, req.user.id, out);
      return { transactions: out.length, created_wallets: createdWallets, created_categories: createdCategories };
    });
    await markOnboarded(req);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.parseTemplate = parseTemplate;
