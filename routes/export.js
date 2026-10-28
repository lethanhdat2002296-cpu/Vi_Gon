// GET /api/export.xlsx: xuất Sổ ra Excel theo đúng bộ lọc đang chọn (F04).
// Số dòng và dòng tổng khớp với số liệu Sổ hiển thị (tổng thu/chi không tính chuyển tiền).
const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const { buildFilter } = require('../services/filters');
const { buildXlsx } = require('../utils/xlsx');
const { nowInTimezone } = require('../utils/time');
const { SELECT_TX } = require('./transactions');

const router = express.Router();
router.use(authRequired, bookRequired);

const MAX_ROWS = 50000;
const SOURCE_LABEL = { manual: 'Ghi tay', adjust: 'Điều chỉnh', transfer: 'Chuyển tiền', bank: 'Tự động', recurring: 'Định kỳ', import: 'Nhập file', debt: 'Sổ nợ' };
const TZ = 'Asia/Ho_Chi_Minh';

function vnDateTime(d) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(d)).forEach(x => { p[x.type] = x.value; });
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

function kindLabel(t) {
  if (t.transfer_group) return t.kind === 'expense' ? 'Chuyển đi' : 'Chuyển đến';
  if (t.source === 'adjust') return 'Điều chỉnh';
  if (t.source === 'debt') return t.kind === 'expense' ? 'Tiền ra (sổ nợ)' : 'Tiền vào (sổ nợ)';
  return t.kind === 'income' ? 'Thu' : 'Chi';
}

router.get('/', async (req, res, next) => {
  try {
    const f = buildFilter(req.bookId, req.query);
    if (f.error) return res.status(400).json({ error: f.error });
    const r = await db.query(
      `${SELECT_TX}
       WHERE ${f.where.join(' AND ')}
       ORDER BY t.occurred_at DESC, t.id DESC LIMIT ${MAX_ROWS + 1}`,
      f.vals
    );
    if (r.rows.length > MAX_ROWS) return res.status(400).json({ error: `Quá ${MAX_ROWS} dòng, hãy thu hẹp bộ lọc` });
    // Tên danh mục cha cho cột "Nhóm"
    const parents = {};
    const catIds = [...new Set(r.rows.map(t => t.category_id).filter(Boolean))];
    if (catIds.length) {
      const pr = await db.query(
        'SELECT c.id, p.name AS parent_name FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.book_id = $1 AND c.id = ANY($2::bigint[])',
        [req.bookId, catIds]
      );
      pr.rows.forEach(x => { parents[x.id] = x.parent_name; });
    }

    let income = 0, expense = 0;
    const rows = r.rows.map(t => {
      const amount = Number(t.amount);
      if (!t.transfer_group && t.source !== 'debt') { if (t.kind === 'income') income += amount; else expense += amount; }
      const { date, time } = vnDateTime(t.occurred_at);
      const category = t.transfer_group ? '' : t.source === 'adjust' ? 'Điều chỉnh số dư' : t.source === 'debt' ? 'Sổ nợ' : (t.category_name || 'Chưa phân loại');
      return [
        date, time, kindLabel(t),
        t.kind === 'income' ? amount : -amount,
        category, parents[t.category_id] || (t.category_id ? category : ''),
        t.wallet_name, t.counterpart_wallet_name || '', t.note, SOURCE_LABEL[t.source] || t.source
      ];
    });
    const columns = [
      { header: 'Ngày', width: 12 }, { header: 'Giờ', width: 7 }, { header: 'Loại', width: 12 },
      { header: 'Số tiền (₫)', width: 16, type: 'money' }, { header: 'Danh mục', width: 20 }, { header: 'Nhóm', width: 16 },
      { header: 'Ví', width: 16 }, { header: 'Ví đối ứng', width: 16 }, { header: 'Ghi chú', width: 36 }, { header: 'Nguồn', width: 12 }
    ];
    const footer = [
      ['Số giao dịch', '', '', rows.length],
      ['Tổng thu', '', '', income],
      ['Tổng chi', '', '', expense ? -expense : 0],
      ['Chênh lệch', '', '', income - expense]
    ];
    const buf = buildXlsx({ sheetName: 'Giao dịch', columns, rows, footer });
    const stamp = nowInTimezone().date;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="vi-gon-${stamp}.xlsx"`);
    res.setHeader('X-Row-Count', String(rows.length));
    res.send(buf);
  } catch (e) { next(e); }
});

module.exports = router;
