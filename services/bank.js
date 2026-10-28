// Liên kết ngân hàng (F12): đọc webhook SePay, gợi ý danh mục theo nội dung chuyển khoản, học từ lần sửa.
const crypto = require('crypto');
const { fold } = require('./backup');

// Luật mặc định: từ khoá (đã bỏ dấu) → tên danh mục (ưu tiên mục con, không có thì danh mục cha).
// Từ khoá dài được xét trước (grabfood thắng grab).
const DEFAULT_RULES = {
  expense: [
    [['grabfood', 'shopeefood', 'baemin', 'befood', 'be food', 'now.vn', 'kfc', 'lotteria', 'mcdonald', 'jollibee', 'pizza', 'texas chicken', 'bun bo', 'pho '], ['Ăn ngoài', 'Ăn uống']],
    [['highlands', 'phuc long', 'starbucks', 'cong caphe', 'coffee house', 'katinat', 'trung nguyen', 'ca phe', 'cafe', 'coffee'], ['Cà phê', 'Ăn uống']],
    [['bach hoa xanh', 'bhx', 'winmart', 'vinmart', 'coopmart', 'co.op', 'coop food', 'big c', 'go! ', 'lotte mart', 'aeon', 'emart', 'mega market', 'circle k', 'gs25', '7-eleven', '7 eleven', 'familymart', 'ministop', 'kingfoodmart'], ['Đi chợ', 'Ăn uống']],
    [['grab', 'gojek', 'xanh sm', 'xanhsm', 'vinasun', 'mai linh', 'taxi', 'be group'], ['Grab, taxi', 'Đi lại']],
    [['petrolimex', 'pvoil', 'xang dau', 'cay xang'], ['Xăng', 'Đi lại']],
    [['vetc', 'epass', 'gui xe', 'parking'], ['Gửi xe', 'Đi lại']],
    [['vietjet', 'vietnam airlines', 'bamboo airways', 'vexere', 'futa'], ['Đi lại']],
    [['shopee', 'lazada', 'tiki', 'tiktok shop', 'sendo', 'uniqlo', 'zara', 'h&m'], ['Mua sắm']],
    [['dien may xanh', 'the gioi di dong', 'fpt shop', 'cellphones', 'ikea'], ['Đồ gia dụng', 'Mua sắm']],
    [['evn', 'tien dien', 'dien luc'], ['Điện', 'Nhà ở']],
    [['sawaco', 'cap nuoc', 'nuoc sach', 'tien nuoc'], ['Nước', 'Nhà ở']],
    [['fpt telecom', 'viettel', 'vnpt', 'mobifone', 'vinaphone', 'internet', 'cuoc dien thoai'], ['Mạng', 'Nhà ở']],
    [['tien nha', 'thue nha', 'tien phong'], ['Thuê nhà', 'Nhà ở']],
    [['netflix', 'spotify', 'youtube', 'apple.com', 'google play', 'steam', 'cgv', 'lotte cinema', 'galaxy cinema', 'bhd'], ['Giải trí']],
    [['pharmacity', 'long chau', 'an khang', 'nha thuoc', 'benh vien', 'phong kham', 'medlatec'], ['Sức khoẻ']],
    [['hoc phi', 'truong hoc', 'fahasa', 'udemy', 'coursera'], ['Học tập']],
    [['dam cuoi', 'mung cuoi', 'dam gio', 'tham om'], ['Hiếu hỉ']],
    [['gui bo me', 'gui me', 'gui bo', 'bieu bo me'], ['Gửi bố mẹ']]
  ],
  income: [
    [['luong', 'salary', 'payroll'], ['Lương']],
    [['thuong', 'bonus'], ['Thưởng']],
    [['lai tiet kiem', 'tra lai', 'interest'], ['Lãi tiết kiệm']]
  ]
};

// Từ phổ biến trong nội dung CK, không dùng làm từ khoá để học
const STOP = new Set(['chuyen', 'tien', 'khoan', 'thanh', 'toan', 'the', 'tai', 'cho', 'tu', 'den', 'qua', 'ma', 'giao', 'dich', 'ref', 'trace',
  'ft', 'mbvcb', 'ibft', 'napas', 'tt', 'ck', 'nd', 'vnd', 'dong', 'tra', 'hcm', 'hn', 'hanoi', 'ha', 'noi', 'tp', 'tphcm', 'vietnam', 'jsc', 'cong', 'ty', 'tnhh',
  'cn', 'chi', 'nhanh', 'pos', 'qr', 'payment', 'pay', 'via', 'tai', 'khoan', 'so', 'nguoi', 'nhan', 'gui', 'from', 'to', 'the', 'and', 'atm', 'rut', 'nap']);

function tokens(text) {
  return fold(text).replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter(Boolean);
}

// Từ khoá để học: từ đầu tiên đủ dài, không phải số, không phải từ phổ biến
function learnKeyword(text) {
  for (const t of tokens(text)) {
    if (t.length >= 3 && !/\d/.test(t) && !STOP.has(t)) return t;
  }
  return null;
}

// Gợi ý danh mục: luật đã học (của sổ) trước, rồi luật mặc định. categories: [{id,name,kind,parent_id}]
function suggestCategory(text, kind, categories, learned) {
  const hay = ' ' + fold(text).replace(/\s+/g, ' ') + ' ';
  const words = new Set(tokens(text));
  const mine = (learned || []).filter(r => r.kind === kind)
    .sort((a, b) => b.keyword.length - a.keyword.length || b.hits - a.hits);
  for (const r of mine) {
    if (words.has(r.keyword) || (r.keyword.includes(' ') && hay.includes(r.keyword))) return { category_id: Number(r.category_id), by: 'learned', keyword: r.keyword };
  }
  const byName = name => categories.find(c => c.kind === kind && fold(c.name) === fold(name));
  const rules = [];
  for (const [kws, names] of DEFAULT_RULES[kind] || []) for (const k of kws) rules.push([k, names]);
  rules.sort((a, b) => b[0].length - a[0].length);
  for (const [k, names] of rules) {
    if (hay.includes(k)) {
      for (const n of names) {
        const c = byName(n);
        if (c) return { category_id: Number(c.id), by: 'default', keyword: k.trim() };
      }
    }
  }
  return null;
}

// Có vẻ là chuyển sang ví khác của mình (vd "THANH TOAN THE VPBANK" ↔ ví "Thẻ VPBank")
function suggestTransferWallet(text, wallets, selfWalletId) {
  const words = new Set(tokens(text));
  for (const w of wallets) {
    if (Number(w.id) === Number(selfWalletId)) continue;
    const key = tokens(w.name).filter(t => t.length >= 4 && !STOP.has(t) && !['mat', 'tiet', 'kiem', 'quy'].includes(t));
    if (key.length && key.every(t => words.has(t))) return Number(w.id);
  }
  return null;
}

// Đọc payload SePay → { ref, kind, amount, occurred_at, note, account_last4 } hoặc { error }
function parseSepay(body) {
  if (!body || typeof body !== 'object') return { error: 'payload rỗng' };
  const id = body.id;
  if (!(Number.isSafeInteger(id) && id > 0) && !(typeof id === 'string' && /^\d{1,20}$/.test(id))) return { error: 'thiếu id' };
  if (!['in', 'out'].includes(body.transferType)) return { error: 'transferType không hợp lệ' };
  const amount = body.transferAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999) return { error: 'transferAmount không hợp lệ' };
  const m = String(body.transactionDate || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const at = m ? new Date(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}+07:00`) : new Date();
  if (isNaN(at)) return { error: 'transactionDate không hợp lệ' };
  const content = [body.content, body.description].filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  // Bỏ phần lặp: description thường chứa lại content
  const note = (content[1] && content[1].includes(content[0]) ? content[1] : content.join(' · ')).slice(0, 200);
  const acct = String(body.accountNumber || '').replace(/\D/g, '');
  return {
    ref: `sepay:${id}`,
    kind: body.transferType === 'in' ? 'income' : 'expense',
    amount,
    occurred_at: at,
    note,
    account_last4: acct.length >= 4 ? acct.slice(-4) : null,
    gateway: typeof body.gateway === 'string' ? body.gateway.slice(0, 40) : ''
  };
}

function newSecret() {
  return crypto.randomBytes(24).toString('base64url');
}
function newHookId() {
  return 'h_' + crypto.randomBytes(12).toString('base64url');
}
function hashSecret(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
// Kiểm header "Authorization: Apikey <mã>" (so khớp thời gian hằng)
function checkApiKey(header, secretHash) {
  const m = String(header || '').match(/^Apikey\s+(.+)$/i);
  if (!m) return false;
  const got = Buffer.from(hashSecret(m[1].trim()), 'hex');
  const want = Buffer.from(String(secretHash), 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { DEFAULT_RULES, tokens, learnKeyword, suggestCategory, suggestTransferWallet, parseSepay, newSecret, newHookId, hashSecret, checkApiKey };
