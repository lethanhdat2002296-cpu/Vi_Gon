// Kiểm email có vẻ là email thật trước khi tạo tài khoản / đổi email.
// Không hỏi được hộp thư có tồn tại không (chỉ email xác minh mới chắc chắn), nên kiểm 4 lớp:
//   1. Gõ nhầm tên miền phổ biến (gmial.com, gmail.co…) → gợi ý sửa
//   2. Quy tắc tên Gmail (6–30 ký tự, chỉ chữ, số, dấu chấm)
//   3. Tên miền email dùng một lần (mailinator, yopmail…) → từ chối
//   4. Tên miền phải nhận được thư (có bản ghi MX). Tên miền không tồn tại / không có MX → từ chối.
//      DNS lỗi tạm thời (hết giờ…) thì cho qua: email xác minh sẽ chặn tiếp, không làm mất người đăng ký.
const dns = require('dns').promises;

const POPULAR = ['gmail.com', 'yahoo.com', 'yahoo.com.vn', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com'];
// Tên miền thật nhưng gần giống tên miền phổ biến → không gợi ý sửa
const LEGIT = new Set(['mail.com', 'ymail.com', 'gmx.com', 'email.com', 'me.com', 'mac.com', 'live.vn', 'hotmail.fr', 'hotmail.de',
  'hotmail.it', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.ca', 'yahoo.co.jp', 'yahoo.co.uk', 'yahoo.com.au', 'outlook.fr', 'outlook.de',
  'outlook.jp', 'live.fr', 'live.co.uk', 'live.ca', 'msn.com', 'aol.com', 'zoho.com', 'proton.me', 'fpt.vn', 'vnn.vn']);
const DISPOSABLE = new Set(['mailinator.com', 'yopmail.com', 'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'temp-mail.org',
  'tempmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com', 'emailondeck.com']);

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Tên miền gần giống tên miền phổ biến (lệch ≤ 2 ký tự) → tên miền đúng
function suggestDomain(domain) {
  if (POPULAR.includes(domain) || LEGIT.has(domain)) return null;
  let best = null, bestD = 3;
  for (const p of POPULAR) {
    const dd = distance(domain, p);
    if (dd < bestD) { best = p; bestD = dd; }
  }
  return best;
}

async function hasMx(domain, resolveMx) {
  try {
    const mx = await Promise.race([
      resolveMx(domain),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000))
    ]);
    // "Null MX" (RFC 7505): tên miền tuyên bố không nhận thư
    return mx.some(r => r.exchange && r.exchange !== '.');
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'NXDOMAIN') return false;
    console.warn('Kiểm MX lỗi tạm thời, cho qua:', domain, e.code || e.message);
    return true;
  }
}

// Trả câu cảnh báo (chuỗi) nếu email không giống email thật, null nếu ổn
async function checkRealEmail(email, opts = {}) {
  const resolveMx = opts.resolveMx || dns.resolveMx;
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (DISPOSABLE.has(domain)) return 'Không dùng email tạm thời. Hãy nhập email bạn dùng thường xuyên để xác minh tài khoản.';
  const fix = suggestDomain(domain);
  if (fix) return `Có phải bạn muốn nhập ${local}@${fix}? Kiểm tra lại email để nhận được thư xác minh.`;
  if (domain === 'gmail.com') {
    const name = local.split('+')[0].replace(/\./g, '');
    if (!/^[a-z0-9.+]+$/.test(local) || name.length < 6 || name.length > 30) {
      return 'Địa chỉ Gmail này không đúng quy tắc của Gmail (6–30 ký tự, chỉ chữ, số và dấu chấm). Nhập đúng email để xác minh.';
    }
  }
  if (opts.mx !== false && !(await hasMx(domain, resolveMx))) return `Tên miền "${domain}" không nhận được email. Hãy nhập đúng email thật để xác minh.`;
  return null;
}

module.exports = { checkRealEmail, suggestDomain };
