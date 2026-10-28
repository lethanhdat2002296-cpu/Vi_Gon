// Bộ lọc giao dịch dùng chung cho Sổ, xuất Excel và Báo cáo (F04, F07).
// Ngày tính theo giờ Việt Nam (+07:00, không có giờ mùa hè).
const { toId } = require('../utils/params');
const { addDays } = require('../utils/time');

const SOURCES = ['manual', 'adjust', 'transfer', 'bank', 'recurring', 'import'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!DATE_RE.test(String(s))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Đầu ngày (giờ VN) dưới dạng Date
function vnStartOfDay(dateStr) {
  return new Date(`${dateStr}T00:00:00+07:00`);
}

// "45k" → 45000, "1,5tr" không nhận (không có số lẻ), "45.000" → 45000; không phải số tiền → null
function amountQuery(q) {
  const s = q.replace(/\s+/g, '').toLowerCase();
  let m = s.match(/^(\d{1,9})k$/);
  if (m) return Number(m[1]) * 1000;
  m = s.match(/^(\d{1,6})(tr|m)$/);
  if (m) return Number(m[1]) * 1000000;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d{1,12}$/.test(s)) return Number(s);
  return null;
}

// Trả { where: [điều kiện SQL], vals } hoặc { error }. Bảng: t = transactions, c = categories (LEFT JOIN).
// `vals` bắt đầu bằng [bookId] → $1 luôn là book_id.
function buildFilter(bookId, query, { forReport = false } = {}) {
  const vals = [bookId];
  const where = ['t.book_id = $1', 't.deleted_at IS NULL'];
  const p = v => { vals.push(v); return `$${vals.length}`; };

  if (query.from !== undefined && query.from !== '') {
    if (!validDate(query.from)) return { error: 'Ngày bắt đầu không hợp lệ' };
    where.push(`t.occurred_at >= ${p(vnStartOfDay(query.from))}`);
  }
  if (query.to !== undefined && query.to !== '') {
    if (!validDate(query.to)) return { error: 'Ngày kết thúc không hợp lệ' };
    where.push(`t.occurred_at < ${p(vnStartOfDay(addDays(query.to, 1)))}`);
  }
  if (query.from && query.to && query.from > query.to) return { error: 'Ngày bắt đầu phải trước ngày kết thúc' };

  if (query.wallet !== undefined && query.wallet !== '') {
    const id = toId(query.wallet);
    if (!id) return { error: 'Ví không hợp lệ' };
    where.push(`t.wallet_id = ${p(id)}`);
  }
  if (query.category !== undefined && query.category !== '') {
    if (query.category === 'none') {
      where.push('t.category_id IS NULL AND t.transfer_group IS NULL AND t.source <> \'adjust\'');
    } else {
      const id = toId(query.category);
      if (!id) return { error: 'Danh mục không hợp lệ' };
      // Gồm cả mục con
      const ph = p(id);
      where.push(`t.category_id IN (SELECT id FROM categories WHERE book_id = $1 AND (id = ${ph} OR parent_id = ${ph}))`);
    }
  }
  if (query.kind !== undefined && query.kind !== '') {
    if (query.kind === 'transfer') where.push('t.transfer_group IS NOT NULL');
    else if (query.kind === 'expense' || query.kind === 'income') where.push(`t.kind = ${p(query.kind)} AND t.transfer_group IS NULL`);
    else return { error: 'Loại không hợp lệ' };
  }
  if (query.source !== undefined && query.source !== '') {
    if (!SOURCES.includes(query.source)) return { error: 'Nguồn không hợp lệ' };
    where.push(`t.source = ${p(query.source)}`);
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  if (q) {
    // Không phân biệt hoa thường và dấu: so trên vn_fold() của ghi chú và tên danh mục
    const like = p('%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%');
    const conds = [`t.note_search LIKE vn_fold(${like})`, `vn_fold(c.name) LIKE vn_fold(${like})`];
    const amt = amountQuery(q);
    if (amt !== null) conds.push(`t.amount = ${p(amt)}`);
    where.push(`(${conds.join(' OR ')})`);
  }
  // Báo cáo không tính chuyển giữa ví và điều chỉnh số dư
  if (forReport) where.push('t.transfer_group IS NULL', "t.source <> 'adjust'");
  return { where, vals };
}

// Khoảng ngày của tháng 'YYYY-MM'
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

// Kỳ liền trước cùng độ dài: trọn tháng → lùi đúng số tháng; còn lại lùi theo số ngày
function previousPeriod(from, to) {
  const isMonthStart = from.slice(8) === '01';
  const isMonthEnd = addDays(to, 1).slice(8) === '01';
  if (isMonthStart && isMonthEnd) {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    const months = (ty * 12 + tm) - (fy * 12 + fm) + 1;
    const startIdx = fy * 12 + (fm - 1) - months;
    const start = `${Math.floor(startIdx / 12)}-${String((startIdx % 12) + 1).padStart(2, '0')}`;
    const endIdx = fy * 12 + (fm - 1) - 1;
    const end = `${Math.floor(endIdx / 12)}-${String((endIdx % 12) + 1).padStart(2, '0')}`;
    return { from: monthBounds(start).from, to: monthBounds(end).to };
  }
  const days = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

module.exports = { SOURCES, buildFilter, amountQuery, validDate, vnStartOfDay, monthBounds, previousPeriod };
