// Ví Gọn - phần lõi phía trình duyệt: DOM, gọi API, định dạng tiền/ngày, thông báo, bảng trượt.
// Mọi nội dung động gắn bằng textContent (qua h()) → không chèn HTML từ dữ liệu.
// CSP chặn style inline dạng thuộc tính → màu động gán qua el.style (CSSOM).
window.VG = (function () {
  'use strict';

  var TOKEN_KEY = 'vigon_token';
  var BOOK_KEY = 'vigon_book';
  var app = document.getElementById('app');
  // book: sổ đang dùng { id, name, kind, role }; books: các sổ mình là thành viên (nạp sau /me)
  var state = { user: null, book: null, books: null };

  // Ghi nhớ đăng nhập: token ở localStorage (giữ 30 ngày). Không ghi nhớ: sessionStorage (đóng trình duyệt là thoát).
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t, remember) {
    try {
      localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
      if (t) (remember === false ? sessionStorage : localStorage).setItem(TOKEN_KEY, t);
    } catch (e) {}
  }

  // h('div', { class: 'x', onclick: fn, bg: '#fff' }, 'chữ', con...) → phần tử DOM
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'bg') el.style.background = v;
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    kids.forEach(function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function render() {
    closeSheet();
    var keep = state.keepScroll ? window.scrollY : 0;
    app.textContent = '';
    Array.prototype.slice.call(arguments).forEach(function (n) { if (n) app.appendChild(n); });
    window.scrollTo(0, keep);
    if (state.keepScroll) return;
    var first = app.querySelector('input[autofocus], form input');
    if (first) first.focus();
  }

  function go(path) {
    if (location.hash === '#' + path) VG.route();
    else location.hash = path;
  }

  // Sổ đang chọn (sổ chung) lưu theo máy; sổ cá nhân thì không gửi header
  function savedBookId() {
    try { return Number(localStorage.getItem(BOOK_KEY)) || null; } catch (e) { return null; }
  }
  function setBook(b) {
    state.book = b && b.kind === 'shared' ? b : null;
    try { if (state.book) localStorage.setItem(BOOK_KEY, String(state.book.id)); else localStorage.removeItem(BOOK_KEY); } catch (e) {}
  }
  function authHeaders(opts) {
    var headers = {};
    var t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (state.book && !(opts && opts.personal)) headers['X-Book-Id'] = String(state.book.id);
    return headers;
  }
  function canWrite() { return !state.book || state.book.role !== 'viewer'; }

  // Bộ nhớ đệm GET ngắn hạn: quay lại màn vừa xem, bấm ẩn số tiền… vẽ lại ngay không gọi máy chủ.
  // Mọi lệnh ghi (POST/PATCH/PUT/DELETE) xoá sạch đệm → sau khi sửa luôn thấy số mới.
  var CACHE_MS = 30000;
  var cache = {};
  function clearCache() { cache = {}; }

  // opts.personal: luôn gọi trên sổ cá nhân (bỏ header X-Book-Id); opts.fresh: bỏ qua đệm; opts.keepCache: ghi mà không xoá đệm
  function api(method, path, body, opts) {
    var isGet = method === 'GET';
    if (!isGet && !(opts && opts.keepCache)) clearCache();
    var key = isGet ? (opts && opts.personal ? 'p' : (state.book ? state.book.id : 'p')) + ' ' + path : null;
    if (isGet && !(opts && opts.fresh) && cache[key] && Date.now() - cache[key].at < CACHE_MS) {
      return Promise.resolve(JSON.parse(cache[key].json));
    }
    return rawApi(method, path, body, opts).then(function (data) {
      if (isGet) cache[key] = { at: Date.now(), json: JSON.stringify(data) };
      return data;
    });
  }

  function rawApi(method, path, body, opts) {
    var headers = authHeaders(opts);
    headers['Content-Type'] = 'application/json';
    var t = getToken();
    var withBook = !!headers['X-Book-Id'];
    return fetch('/api' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && t) { setToken(null); state.user = null; }
          // Đã bị mời ra / sổ đã xoá → quay về sổ cá nhân
          if (withBook && (r.status === 403 || r.status === 400) && /quyền với sổ|Sổ không hợp lệ/.test(data.error || '')) {
            setBook(null); state.books = null;
          }
          if (!r.ok) {
            var err = new Error(data.error || 'Có lỗi xảy ra, thử lại sau.');
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      }, function () { throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); });
  }

  // Nhớ giao diện sáng/tối của lần đăng nhập gần nhất để màn đăng nhập cùng màu với app
  function applyTheme(user) {
    var t;
    if (user) { t = user.theme; try { localStorage.setItem('vigon_theme', t || 'system'); } catch (e) {} }
    else { try { t = localStorage.getItem('vigon_theme'); } catch (e) {} }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(null);

  // Bàn phím điện thoại mở lên che ô đang gõ → cuộn ô đó vào giữa phần còn thấy
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    setTimeout(function () {
      if (document.activeElement !== el) return;
      var r = el.getBoundingClientRect();
      var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      if (r.bottom > vh - 12 || r.top < 0) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 350);
  });

  // Vẽ lại màn hiện tại tại chỗ (dùng dữ liệu đệm, giữ vị trí cuộn, không nhảy con trỏ)
  function rerender() {
    var y = window.scrollY;
    state.keepScroll = true;
    try { VG.route(); } finally { state.keepScroll = false; }
    window.requestAnimationFrame(function () { window.scrollTo(0, y); });
  }
  // Lưu cài đặt nhỏ của tài khoản mà không xoá đệm dữ liệu
  function saveMe(patch) { return rawApi('PATCH', '/me', patch); }

  function signedIn(data, remember) {
    setToken(data.token, remember);
    // Vừa đăng nhập bằng mật khẩu → không bắt nhập PIN ngay
    try { localStorage.setItem('vigon_last_active', String(Date.now())); } catch (e) {}
    state.user = data.user;
    applyTheme(data.user);
  }

  function signOut() {
    setToken(null); state.user = null; state.books = null; setBook(null); applyTheme(null); clearCache();
  }

  function queryParam(name) {
    var q = location.hash.split('?')[1] || '';
    var m = q.split('&').map(function (p) { return p.split('='); }).filter(function (p) { return p[0] === name; })[0];
    return m ? decodeURIComponent(m[1] || '') : '';
  }

  // ============ TIỀN (số nguyên VND, không dùng số thực) ============
  function group(digits) { return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmt(n, opts) {
    var s = String(n);
    if (!/^-?\d+$/.test(s)) return '';
    var neg = s.charAt(0) === '-';
    var d = (neg ? s.slice(1) : s).replace(/^0+(?=\d)/, '');
    var out = (neg && d !== '0' ? '−' : '') + group(d);
    return opts && opts.symbol === false ? out : out + ' ₫';
  }
  // Hiển thị số tiền ở danh sách/tổng: che khi người dùng bật "Ẩn số tiền" (F08)
  // Số tiền hiển thị. Chế độ "ẩn số tiền" chỉ che SỐ DƯ (bal), thu/chi vẫn hiện.
  function show(n, opts) {
    if (opts && opts.bal && state.user && state.user.hide_amounts) return opts.symbol === false ? '••••••' : '•••••• ₫';
    return fmt(n, opts);
  }
  function bal(n, opts) { return show(n, Object.assign({}, opts, { bal: true })); }
  // "1.250.000" → 1250000; rỗng/sai → null
  function parseAmount(s) {
    var d = String(s || '').replace(/[^\d]/g, '');
    if (!d || d.length > 12) return null;
    return Number(d);
  }
  // Ô nhập tiền: tự chèn dấu chấm khi gõ
  function moneyInput(attrs) {
    var input = h('input', Object.assign({ type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'money' }, attrs));
    input.addEventListener('input', function () {
      var d = input.value.replace(/[^\d]/g, '').slice(0, 12).replace(/^0+(?=\d)/, '');
      input.value = d ? group(d) : '';
    });
    if (attrs && attrs.value !== undefined && attrs.value !== null) input.value = group(String(Math.abs(attrs.value)));
    return input;
  }

  // ============ NGÀY (giờ Việt Nam) ============
  var TZ = 'Asia/Ho_Chi_Minh';
  function vnDate(d) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d));
    var o = {};
    p.forEach(function (x) { o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function today() { return vnDate(new Date()); }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  var WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  function dayLabel(dateStr) {
    if (dateStr === today()) return 'Hôm nay';
    if (dateStr === addDays(today(), -1)) return 'Hôm qua';
    var d = new Date(dateStr + 'T12:00:00Z');
    return WEEKDAYS[d.getUTCDay()] + ', ' + dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7) +
      (dateStr.slice(0, 4) !== today().slice(0, 4) ? '/' + dateStr.slice(0, 4) : '');
  }
  function shortDate(dateStr) {
    if (dateStr === today()) return 'Hôm nay';
    if (dateStr === addDays(today(), -1)) return 'Hôm qua';
    return dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7);
  }

  // ============ THÔNG BÁO NHỎ (toast) ============
  var toastEl = null, toastTimer = null;
  // toast('Đã xoá', { action: 'Hoàn tác', onAction: fn, ms: 5000, kind: 'warn' })
  function toast(text, opts) {
    opts = opts || {};
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    var btn = opts.action ? h('button', { type: 'button', class: 'toast-act' }, opts.action) : null;
    toastEl = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : ''), role: 'status' }, h('span', null, text), btn);
    if (btn) btn.addEventListener('click', function () { hideToast(); opts.onAction(); });
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(hideToast, opts.ms || 3500);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  // ============ BẢNG TRƯỢT TỪ DƯỚI LÊN ============
  var sheetEl = null;
  function openSheet(content, opts) {
    closeSheet();
    hideToast();
    var panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grab' }), content);
    sheetEl = h('div', { class: 'sheet-wrap' }, h('div', { class: 'sheet-dim', onclick: closeSheet }), panel);
    document.body.appendChild(sheetEl);
    document.body.classList.add('no-scroll');
    sheetEl.onClose = opts && opts.onClose;
    return panel;
  }
  function closeSheet() {
    if (!sheetEl) return;
    var cb = sheetEl.onClose;
    sheetEl.remove();
    sheetEl = null;
    document.body.classList.remove('no-scroll');
    if (cb) cb();
  }
  function sheetOpen() { return !!sheetEl; }
  // Esc đóng bảng trượt đang mở
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && sheetEl) closeSheet(); });

  // ============ KHỐI GIAO DIỆN DÙNG CHUNG ============
  function field(label, input) {
    var wrap = h('div', { class: 'field' }, h('label', { for: input.id }, label));
    if (input.type === 'password') {
      var peek = h('button', { type: 'button', class: 'peek', 'aria-label': 'Hiện mật khẩu' }, 'Hiện');
      peek.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        peek.textContent = show ? 'Ẩn' : 'Hiện';
      });
      wrap.appendChild(h('div', { class: 'field-row' }, input, peek));
    } else {
      wrap.appendChild(input);
    }
    return wrap;
  }

  // Mật khẩu mới: cùng quy tắc với máy chủ (utils/validators.js)
  var PW_RULES = [
    [function (p) { return Array.from(p).length >= 8; }, 'Ít nhất 8 ký tự', 'ít nhất 8 ký tự'],
    [function (p) { return /\p{Lu}/u.test(p); }, 'Chữ hoa', 'chữ hoa'],
    [function (p) { return /\p{Ll}/u.test(p); }, 'Chữ thường', 'chữ thường'],
    [function (p) { return /\d/.test(p); }, 'Số', 'số'],
    [function (p) { return /[^\p{L}\p{N}\s]/u.test(p); }, 'Ký tự đặc biệt (@ # ! …)', 'ký tự đặc biệt (vd: @ # ! . _)']
  ];
  function passwordError(p) {
    var miss = PW_RULES.filter(function (r) { return !r[0](p || ''); }).map(function (r) { return r[2]; });
    return miss.length ? 'Mật khẩu cần có: ' + miss.join(', ') : null;
  }
  // Ô mật khẩu mới kèm danh sách điều kiện, tích xanh dần khi gõ
  function newPasswordField(id, label) {
    var input = h('input', { id: id, name: id, type: 'password', autocomplete: 'new-password', required: true, maxlength: '72' });
    var items = PW_RULES.map(function (r) { return h('li', null, r[1]); });
    var wrap = field(label, input);
    wrap.appendChild(h('ul', { class: 'pw-rules', 'aria-label': 'Điều kiện mật khẩu' }, items));
    input.addEventListener('input', function () {
      PW_RULES.forEach(function (r, i) { items[i].className = r[0](input.value) ? 'ok' : ''; });
    });
    return wrap;
  }

  function message() {
    var box = h('div', { class: 'msg hidden', role: 'alert' });
    box.show = function (text, kind) { box.textContent = text; box.className = 'msg ' + (kind || 'err'); };
    box.hide = function () { box.className = 'msg hidden'; };
    return box;
  }

  // Gắn submit: khoá nút khi đang gửi, hiện lỗi vào msg
  function onSubmit(form, btn, msg, handler) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      msg.hide();
      btn.disabled = true;
      Promise.resolve()
        .then(handler)
        .catch(function (e) { msg.show(e.message); })
        .then(function () { btn.disabled = false; });
    });
  }

  // Nút chọn 1 trong nhiều (chips). options: [[value, label]]
  function chips(options, value, onChange) {
    var wrap = h('div', { class: 'chips', role: 'radiogroup' });
    wrap.value = value;
    options.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(o[0] === value) }, o[1]);
      b.addEventListener('click', function () {
        wrap.value = o[0];
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
        if (onChange) onChange(o[0]);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function seg(options, value, onChange) {
    var wrap = h('div', { class: 'seg', role: 'tablist' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(o[0] === value) }, o[1]);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-selected', String(x === b)); });
        onChange(o[0]);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  var COLORS = ['#0D6B5E', '#1C7C45', '#5E6FB8', '#7B4FA0', '#B6452A', '#D08A2E', '#A86A12', '#9AA79F'];
  function colorPicker(value, onChange) {
    var wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Màu' });
    wrap.value = value || COLORS[0];
    COLORS.forEach(function (c) {
      var b = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': c, 'aria-checked': String(c === wrap.value), bg: c });
      b.addEventListener('click', function () {
        wrap.value = c;
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
        if (onChange) onChange(c);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function toggle(label, checked, sub) {
    var input = h('input', { type: 'checkbox', class: 'switch' });
    input.checked = !!checked;
    var row = h('label', { class: 'toggle-row' }, h('span', { class: 'grow' }, h('span', null, label), sub ? h('span', { class: 'muted small block' }, sub) : null), input);
    row.input = input;
    return row;
  }

  // Ô biểu tượng tròn màu của danh mục / ví
  // ============ ICON NÉT (24×24, màu theo chữ) ============
  var ICONS = {
    home: ['M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.6H9.2v5.6H5A1.5 1.5 0 0 1 3.5 19z'],
    book: ['M6 3.5h10.5A1.5 1.5 0 0 1 18 5v15.5H6.5A2 2 0 0 1 4.5 18.5V5A1.5 1.5 0 0 1 6 3.5z', 'M8.5 8.5h6', 'M8.5 12h6', 'M8.5 15.5h3.5'],
    plan: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5', 'M12 7.5a4.5 4.5 0 1 0 4.5 4.5', 'M12 12l7-7', 'M16 5h3v3'],
    me: ['M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5c.8-3.7 3.7-5.8 7.5-5.8s6.7 2.1 7.5 5.8'],
    search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
    filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
    wallet: ['M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3', 'M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20V8H6.5A2.5 2.5 0 0 1 4 5.5', 'M16 14h.01'],
    tag: ['M3.5 12.5V4.5h8l9 9-8 8z', 'M8 9h.01'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M21 20H3'],
    users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20c.6-3.3 3.2-5.2 6.5-5.2s5.9 1.9 6.5 5.2', 'M16 4.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.9c2 .7 3.2 2.4 3.5 5.1'],
    split: ['M4 4h16v16H4z', 'M4 12h16', 'M12 4v16'],
    hand: ['M7 11.5V6a1.5 1.5 0 0 1 3 0v5', 'M10 10.5V4.5a1.5 1.5 0 0 1 3 0v6', 'M13 10.5V6a1.5 1.5 0 0 1 3 0v6', 'M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.8-2.4L4 15a1.6 1.6 0 0 1 2.4-2.1L7 13.5'],
    bank: ['M3 9.5 12 4l9 5.5', 'M5 10v8', 'M9.5 10v8', 'M14.5 10v8', 'M19 10v8', 'M3 20h18'],
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    logout: ['M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15', 'M10 16l-4-4 4-4', 'M6 12h10'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    plus: ['M12 5v14', 'M5 12h14'],
    swap: ['M4 8h13l-3-3', 'M20 16H7l3 3'],
    spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z']
  };
  function icon(name, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ic-svg' + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }
  // Ô icon có nền nhạt màu riêng (menu, tiêu đề mục)
  function iconTile(name, color) {
    var t = h('span', { class: 'ic-tile', 'aria-hidden': 'true' }, icon(name));
    t.style.color = color;
    t.style.background = color + '1f';
    return t;
  }
  // Trạng thái trống: biểu tượng lớn + tiêu đề + gợi ý (+ nút)
  function empty(emoji, title, sub, action) {
    return h('div', { class: 'card empty-state' }, h('span', { class: 'empty-ic', 'aria-hidden': 'true' }, emoji),
      h('b', null, title), sub ? h('p', { class: 'muted small' }, sub) : null, action || null);
  }

  // Nền nhạt cùng màu danh mục, chữ/biểu tượng màu đậm
  function badge(icon, color, fallback) {
    var c = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#9AA79F';
    var el = h('span', { class: 'cat', 'aria-hidden': 'true' }, icon || (fallback || '?').charAt(0).toUpperCase());
    el.style.background = c + '26';
    el.style.color = c;
    return el;
  }

  function topbar(title, opts) {
    opts = opts || {};
    return h('div', { class: 'topbar' },
      opts.back ? h('a', { href: '#' + opts.back, class: 'back', 'aria-label': 'Quay lại' }, '‹') : null,
      h('h1', { class: 'grow' }, title),
      opts.action || null);
  }

  return {
    state: state, app: app, h: h, render: render, go: go, api: api, getToken: getToken, setToken: setToken,
    icon: icon, iconTile: iconTile, empty: empty, bal: bal,
    authHeaders: authHeaders, clearCache: clearCache, rerender: rerender, saveMe: saveMe, setBook: setBook, savedBookId: savedBookId, canWrite: canWrite,
    applyTheme: applyTheme, signedIn: signedIn, signOut: signOut, queryParam: queryParam,
    fmt: fmt, show: show, parseAmount: parseAmount, moneyInput: moneyInput, group: group,
    vnDate: vnDate, today: today, addDays: addDays, dayLabel: dayLabel, shortDate: shortDate,
    toast: toast, hideToast: hideToast, openSheet: openSheet, closeSheet: closeSheet, sheetOpen: sheetOpen,
    field: field, passwordError: passwordError, newPasswordField: newPasswordField, message: message, onSubmit: onSubmit, chips: chips, seg: seg, colorPicker: colorPicker,
    COLORS: COLORS, toggle: toggle, badge: badge, topbar: topbar,
    screens: {}, route: null
  };
})();
