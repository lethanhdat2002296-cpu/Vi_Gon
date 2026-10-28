// Đọc hoá đơn từ chữ OCR (F13): tổng tiền, ngày, tên cửa hàng. Hàm thuần, chạy cả trình duyệt lẫn Node (test).
// Không đọc được thì để trống — người dùng luôn xem lại trước khi lưu.
(function (root) {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  }

  // Từ khoá dòng tổng, ưu tiên từ trên xuống
  var TOTAL_KEYS = [
    ['tong thanh toan', 'tong cong thanh toan', 'can thanh toan', 'khach can tra', 'khach phai tra', 'phai thanh toan', 'thanh toan', 'amount due', 'grand total'],
    ['tong cong', 'tong tien', 'total', 'tong'],
    ['thanh tien', 'cong']
  ];
  // Dòng không phải tổng phải trả (tiền khách đưa thường lớn hơn tổng)
  var SKIP = ['tien khach dua', 'khach dua', 'tien thua', 'tra lai', 'change', 'cash', 'tien mat dua', 'chiet khau', 'giam gia', 'khuyen mai', 'discount',
    'vat', 'thue', 'tax', 'tich diem', 'diem', 'so luong', 'sl', 'hotline', 'dien thoai', 'tel', 'mst', 'ma so thue', 'so hd', 'hoa don so'];
  var CHAINS = ['bach hoa xanh', 'winmart', 'vinmart', 'co.op', 'coopmart', 'coop food', 'circle k', 'gs25', '7-eleven', 'familymart', 'ministop',
    'big c', 'go!', 'lotte mart', 'aeon', 'emart', 'mega market', 'highlands', 'phuc long', 'starbucks', 'pharmacity', 'long chau', 'kfc', 'lotteria', 'jollibee'];

  // Sửa lỗi OCR hay gặp trong số: O→0, l/I→1, khoảng trắng giữa nhóm nghìn
  function cleanNumbers(line) {
    var prev;
    do {
      prev = line;
      line = line.replace(/([\d.,])[oO](?=[\doO.,]|\s|$)/g, '$10').replace(/(\d)[lI](?=\d)/g, '$11');
    } while (line !== prev);
    return line;
  }
  function amountsIn(line) {
    var out = [];
    var s = cleanNumbers(line);
    var re = /(\d{1,3}(?:[.,\s]\d{3})+|\d{4,9})(?![\d.,]*%)/g;
    var m;
    while ((m = re.exec(s))) {
      var n = parseInt(m[1].replace(/[.,\s]/g, ''), 10);
      if (n >= 1000 && n <= 999999999) out.push(n);
    }
    return out;
  }
  function hasAny(f, words) {
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      // Từ ngắn (sl, tel, vat…) phải đứng riêng, tránh khớp nhầm trong từ dài
      if (w.length <= 3 ? new RegExp('(^|[^a-z])' + w.replace('.', '\\.') + '([^a-z]|$)').test(f) : f.indexOf(w) >= 0) return true;
    }
    return false;
  }

  function findTotal(lines) {
    var folded = lines.map(fold);
    for (var p = 0; p < TOTAL_KEYS.length; p++) {
      var found = null;
      for (var i = 0; i < lines.length; i++) {
        var f = folded[i];
        if (!hasAny(f, TOTAL_KEYS[p]) || hasAny(f, SKIP)) continue;
        var nums = amountsIn(lines[i]);
        // Số nằm ở dòng dưới (in 2 dòng)
        if (!nums.length && i + 1 < lines.length && !hasAny(folded[i + 1], SKIP)) nums = amountsIn(lines[i + 1]);
        if (nums.length) found = Math.max.apply(null, nums); // lấy dòng tổng CUỐI cùng khớp mức ưu tiên này
      }
      if (found) return found;
    }
    // Không có dòng tổng: số lớn nhất, trừ các dòng tiền khách đưa / tiền thừa / mã số
    var best = null;
    lines.forEach(function (l, i) {
      if (hasAny(folded[i], SKIP)) return;
      amountsIn(l).forEach(function (n) { if (!best || n > best) best = n; });
    });
    return best;
  }

  function findDate(text) {
    var m = String(text).match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
    if (!m) return null;
    var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3].length === 2 ? '20' + m[3] : m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var t = new Date(iso + 'T12:00:00Z');
    return !isNaN(t) && t.toISOString().slice(0, 10) === iso ? iso : null;
  }

  function findStore(lines) {
    for (var i = 0; i < lines.length; i++) {
      var f = fold(lines[i]);
      for (var c = 0; c < CHAINS.length; c++) if (f.indexOf(CHAINS[c]) >= 0) return tidy(lines[i]);
    }
    // Dòng đầu có chữ, không phải ngày/số/địa chỉ
    for (var j = 0; j < Math.min(lines.length, 5); j++) {
      var l = lines[j].trim();
      var letters = (l.match(/\p{L}/gu) || []).length;
      if (letters >= 3 && !/\d{2}[/.-]\d{2}/.test(l) && !/^(dc|đc|địa chỉ|dia chi|đt|dt|tel|hotline)/i.test(l)) return tidy(l);
    }
    return '';
  }
  function tidy(s) { return s.replace(/[*_=~|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

  function parseReceipt(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    return { amount: findTotal(lines), date: findDate(text), store: findStore(lines) };
  }

  var api = { parseReceipt: parseReceipt, amountsIn: amountsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VGReceipt = api;
})(typeof window !== 'undefined' ? window : this);
