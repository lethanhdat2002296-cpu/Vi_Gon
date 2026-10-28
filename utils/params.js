// Đọc tham số dùng chung cho các route
const { MAX_VND } = require('./money');

// id trên URL/body: số nguyên dương, ngược lại null
function toId(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)) return Number(v);
  return null;
}

// Số tiền có dấu (số dư đầu, số dư thực tế): số nguyên trong [-MAX, MAX], ngược lại null
function toSignedVnd(v) {
  if (typeof v === 'string' && /^-?\d{1,12}$/.test(v.trim())) v = Number(v.trim());
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || Math.abs(v) > MAX_VND) return null;
  return v;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cleanText(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > max ? null : s;
}

module.exports = { toId, toSignedVnd, COLOR_RE, cleanText };
