// Trợ lý AI (chạy trên máy): phần thuần, chạy cả trình duyệt lẫn Node (test).
//   moneyIn(text)            → số tiền đầu tiên người dùng nhắc tới ("15 triệu", "15tr", "1,5 củ", "500k", "15.000.000")
//   systemPrompt(ctx, fmt)   → lời nhắc hệ thống: vai trò + số liệu thật của sổ
//   parsePlan(text)          → [{ name, amount }] từ khối "KẾ HOẠCH:" mô hình trả về
//   fitPlan(items, total)    → làm tròn 1.000 ₫ và chỉnh cho tổng đúng bằng số tiền (mô hình nhỏ hay cộng sai)
//   matchCategory(name, cats)→ danh mục chi khớp tên (không phân biệt dấu, hoa thường)
(function (root) {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
  }

  var UNITS = { 'trieu': 1e6, 'tr': 1e6, 'cu': 1e6, 'm': 1e6, 'ty': 1e9, 'ti': 1e9, 'nghin': 1e3, 'ngan': 1e3, 'k': 1e3, 'ng': 1e3 };
  var MONEY_RE = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|ty|ti|nghin|ngan|k|ng|m)?(?![a-z])/g;

  // Số tiền (VND, số nguyên) trong 1 đoạn chữ, theo thứ tự xuất hiện
  function amountsIn(text) {
    // Bỏ ký hiệu tiền ngay sau số ("12.500.000đ", "500 vnd") để không làm lệch cách đọc
    var s = fold(text).replace(/(\d)\s*(vnd|dong|d|₫)(?![a-z])/g, '$1 ');
    var out = [], m;
    MONEY_RE.lastIndex = 0;
    while ((m = MONEY_RE.exec(s))) {
      var raw = m[1], unit = m[2];
      var v;
      if (unit) {
        v = parseFloat(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * UNITS[unit];
      } else if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) {
        v = Number(raw.replace(/[.,]/g, ''));
      } else {
        v = Number(raw.replace(',', '.'));
      }
      v = Math.round(v);
      if (isFinite(v) && v >= 1000 && v <= 999999999999) out.push(v);
    }
    return out;
  }
  function moneyIn(text) { var a = amountsIn(text); return a.length ? a[0] : null; }

  function vnd(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'; }

  // Lời nhắc hệ thống. Ngắn gọn vì mô hình chạy trên máy chỉ có khung ngữ cảnh ~4.000 token.
  function systemPrompt(ctx) {
    var L = [];
    L.push('Bạn là trợ lý tài chính cá nhân trong app Ví Gọn. Trả lời bằng tiếng Việt, xưng "mình", gọi "bạn", ngắn gọn, thân thiện, thực tế với người Việt.');
    L.push('Quy tắc: dùng số liệu thật bên dưới, không bịa số. Tiền là VND, viết dạng 1.500.000 ₫. Không khuyên mua mã cổ phiếu, coin hay sản phẩm cụ thể. Nếu thiếu thông tin quan trọng (thu nhập, khoản bắt buộc) thì hỏi lại 1 câu.');
    L.push('Khi bạn chia một số tiền hoặc lập kế hoạch chi tiêu, LUÔN kết thúc bằng khối sau, mỗi dòng một khoản, tổng các dòng đúng bằng số tiền cần chia:');
    L.push('KẾ HOẠCH:\n- <tên khoản>: <số tiền>');
    if (ctx.expense_categories && ctx.expense_categories.length) {
      L.push('Ưu tiên tên khoản trùng danh mục của người dùng: ' + ctx.expense_categories.join(', ') + '. Có thể thêm "Tiết kiệm", "Dự phòng".');
    }
    L.push('Gợi ý tham khảo khi người dùng chưa có thói quen rõ: khoảng 50% nhu cầu thiết yếu, 30% mong muốn, 20% tiết kiệm; điều chỉnh theo số liệu thật.');
    var F = [];
    var d = ctx.today ? ctx.today.split('-').reverse().join('/') : '';
    F.push('Hôm nay ' + d + ', tháng này còn ' + ctx.days_left + ' ngày.');
    F.push('Tổng số dư các ví: ' + vnd(ctx.total_balance) + (ctx.wallets && ctx.wallets.length ? ' (' + ctx.wallets.slice(0, 5).map(function (w) { return w.name + ' ' + vnd(w.balance); }).join(', ') + ')' : '') + '.');
    F.push('Tháng này đến nay: thu ' + vnd(ctx.this_month.income) + ', chi ' + vnd(ctx.this_month.expense) + '.');
    if (ctx.history_months) {
      F.push('Trung bình mỗi tháng (' + ctx.history_months + ' tháng trước): thu ' + vnd(ctx.avg_month.income) + ', chi ' + vnd(ctx.avg_month.expense) + '.');
      if (ctx.avg_by_category.length) F.push('Chi trung bình/tháng theo danh mục: ' + ctx.avg_by_category.slice(0, 8).map(function (c) { return c.name + ' ' + vnd(c.amount); }).join(', ') + '.');
    } else {
      F.push('Người dùng mới, chưa có dữ liệu các tháng trước.');
    }
    if (ctx.budgets && ctx.budgets.length) F.push('Ngân sách tháng này: ' + ctx.budgets.map(function (b) { return b.name + ' đã chi ' + vnd(b.spent) + '/' + vnd(b.limit); }).join(', ') + '.');
    if (ctx.goals && ctx.goals.length) F.push('Mục tiêu tiết kiệm: ' + ctx.goals.map(function (g) { return g.name + ' có ' + vnd(g.saved) + '/' + vnd(g.target) + ', hạn ' + g.deadline + ', cần ' + vnd(g.monthly_needed) + '/tháng'; }).join('; ') + '.');
    if (ctx.debts && (ctx.debts.lent || ctx.debts.borrowed)) F.push('Sổ nợ: người khác nợ ' + vnd(ctx.debts.lent) + ', mình nợ ' + vnd(ctx.debts.borrowed) + '.');
    return L.join('\n') + '\n\nSỐ LIỆU CỦA NGƯỜI DÙNG:\n' + F.join('\n');
  }

  // Đọc khối kế hoạch: ưu tiên phần sau "KẾ HOẠCH", không có thì đọc mọi dòng dạng "- tên: số tiền"
  var LINE_RE = /^\s*(?:[-*•+]|\d+[.)])?\s*\**\s*([^:：\n]{1,40}?)\s*\**\s*[:：–-]\s*\**\s*([0-9][0-9.,]*\s*(?:triệu|trieu|tr|củ|nghìn|nghin|ngàn|k|tỷ|ty)?)\s*(?:₫|đ|vnđ|vnd|đồng)?/i;
  function parsePlan(text) {
    var t = String(text || '');
    var at = fold(t).search(/ke hoach\s*:/);
    var part = at >= 0 ? t.slice(at) : t;
    var out = [];
    var seen = {};
    part.split('\n').forEach(function (line) {
      if (/ke hoach\s*:/.test(fold(line)) && !/\d/.test(line.split(':').slice(1).join(':'))) return;
      var m = line.match(LINE_RE);
      if (!m) return;
      var name = m[1].replace(/[*_`#]/g, '').trim();
      var fname = fold(name);
      if (!name || /^(tong|tong cong|total|con lai)$/.test(fname)) return;
      var amount = moneyIn(m[2]);
      if (!amount) return;
      if (seen[fname]) { seen[fname].amount += amount; return; }
      seen[fname] = { name: name, amount: amount };
      out.push(seen[fname]);
    });
    return out.length >= 2 ? out : [];
  }

  // Làm tròn 1.000 ₫ và co giãn theo tỉ lệ cho tổng đúng bằng total; phần lệch dồn vào khoản lớn nhất
  function fitPlan(items, total) {
    if (!items.length) return [];
    var sum = items.reduce(function (s, x) { return s + x.amount; }, 0);
    if (!total || sum <= 0) return items.map(function (x) { return { name: x.name, amount: x.amount }; });
    var scaled = items.map(function (x) { return { name: x.name, amount: Math.floor(x.amount * total / sum / 1000) * 1000 }; });
    var got = scaled.reduce(function (s, x) { return s + x.amount; }, 0);
    var big = 0;
    scaled.forEach(function (x, i) { if (x.amount > scaled[big].amount) big = i; });
    scaled[big].amount += total - got;
    return scaled;
  }

  // Tên khoản → danh mục chi (khớp đúng, rồi khớp chứa nhau). Không khớp → null
  function matchCategory(name, cats) {
    var f = fold(name);
    var exact = cats.filter(function (c) { return fold(c.name) === f; })[0];
    if (exact) return exact;
    return cats.filter(function (c) { var g = fold(c.name); return g.length >= 3 && (f.indexOf(g) >= 0 || g.indexOf(f) >= 0); })[0] || null;
  }

  var api = { fold: fold, amountsIn: amountsIn, moneyIn: moneyIn, systemPrompt: systemPrompt, parsePlan: parsePlan, fitPlan: fitPlan, matchCategory: matchCategory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VGAi = api;
})(typeof window !== 'undefined' ? window : this);
