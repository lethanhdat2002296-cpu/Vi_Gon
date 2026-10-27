// Tiền = số nguyên VND. KHÔNG dùng số thực ở bất kỳ bước nào.
// DB lưu BIGINT; driver pg trả BIGINT dạng chuỗi → formatVnd nhận cả number/string/bigint.

const MAX_VND = 999_999_999_999;

// Bỏ ký hiệu tiền tệ + khoảng trắng: "45.000 ₫", "45.000đ", "45000 VND"
function stripCurrency(s) {
  return s.replace(/\s+/g, '').replace(/(₫|đ|vnđ|vnd)$/i, '');
}

// "45.000" → 45000, "45,000" → 45000, "45000" → 45000, 45000 → 45000.
// Trả null nếu: rỗng, âm, có phần lẻ ("45.5"), nhóm số sai ("4.50"), vượt MAX_VND.
function parseVnd(input) {
  let digits;
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) return null;
    digits = String(input);
  } else if (typeof input === 'bigint') {
    if (input < 0n) return null;
    digits = input.toString();
  } else if (typeof input === 'string') {
    const s = stripCurrency(input.trim());
    if (/^\d+$/.test(s)) {
      digits = s;
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s) || /^\d{1,3}(,\d{3})+$/.test(s)) {
      digits = s.replace(/[.,]/g, '');
    } else {
      return null;
    }
  } else {
    return null;
  }
  // So bằng BigInt để chuỗi rất dài không bị làm tròn
  if (BigInt(digits) > BigInt(MAX_VND)) return null;
  return Number(digits);
}

// Số tiền hợp lệ cho giao dịch: nguyên, > 0, ≤ MAX_VND
function isValidAmount(value) {
  const n = parseVnd(value);
  return n !== null && n > 0;
}

// 45000 → "45.000 ₫", -45000 → "-45.000 ₫". Giá trị không phải số nguyên → "".
function formatVnd(value, { symbol = true } = {}) {
  let s;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return '';
    s = String(value);
  } else if (typeof value === 'bigint') {
    s = value.toString();
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    s = value.trim();
  } else {
    return '';
  }
  const neg = s.startsWith('-');
  const digits = (neg ? s.slice(1) : s).replace(/^0+(?=\d)/, '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const out = (neg && digits !== '0' ? '-' : '') + grouped;
  return symbol ? `${out} ₫` : out;
}

module.exports = { MAX_VND, parseVnd, isValidAmount, formatVnd };
