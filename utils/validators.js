// Hàm validate dùng cho backend: trả chuỗi lỗi hoặc null
const { isValidAmount, MAX_VND, formatVnd } = require('./money');

function validateEmail(email) {
  if (!email || typeof email !== 'string') return 'Email không được để trống';
  // local@domain.tld, chặn dấu chấm liên tiếp / đầu / cuối ở phần local
  const re = /^[a-zA-Z0-9_%+-]+(\.[a-zA-Z0-9_%+-]+)*@([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+)$/;
  if (email.length > 254 || !re.test(email.trim())) {
    return 'Email không hợp lệ (ví dụ: ten@gmail.com)';
  }
  return null;
}

// Chuẩn hoá email để so khớp / lưu (mỗi email một tài khoản)
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Mật khẩu không được để trống';
  if (password.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
  // bcrypt chỉ dùng 72 byte đầu
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Mật khẩu quá dài (tối đa 72 ký tự)';
  return null;
}

function validateAmount(value) {
  if (value === undefined || value === null || value === '') return 'Chưa nhập số tiền';
  if (!isValidAmount(value)) return `Số tiền phải là số nguyên dương, tối đa ${formatVnd(MAX_VND)}`;
  return null;
}

function validateDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return 'Ngày không hợp lệ (YYYY-MM-DD)';
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d) || d.toISOString().slice(0, 10) !== dateStr) return 'Ngày không hợp lệ';
  return null;
}

module.exports = { validateEmail, normalizeEmail, validatePassword, validateAmount, validateDate };
