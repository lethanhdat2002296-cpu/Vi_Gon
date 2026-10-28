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
    app.textContent = '';
    Array.prototype.slice.call(arguments).forEach(function (n) { if (n) app.appendChild(n); });
    window.scrollTo(0, 0);
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

  // opts.personal: luôn gọi trên sổ cá nhân (bỏ header X-Book-Id)
  function api(method, path, body, opts) {
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

  function applyTheme(user) {
    var t = user && user.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  function signedIn(data, remember) {
    setToken(data.token, remember);
    // Vừa đăng nhập bằng mật khẩu → không bắt nhập PIN ngay
    try { localStorage.setItem('vigon_last_active', String(Date.now())); } catch (e) {}
    state.user = data.user;
    applyTheme(data.user);
  }

  function signOut() {
    setToken(null); state.user = null; state.books = null; setBook(null); applyTheme(null);
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
  function show(n, opts) {
    if (state.user && state.user.hide_amounts) return opts && opts.symbol === false ? '••••••' : '•••••• ₫';
    return fmt(n, opts);
  }
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
    authHeaders: authHeaders, setBook: setBook, savedBookId: savedBookId, canWrite: canWrite,
    applyTheme: applyTheme, signedIn: signedIn, signOut: signOut, queryParam: queryParam,
    fmt: fmt, show: show, parseAmount: parseAmount, moneyInput: moneyInput, group: group,
    vnDate: vnDate, today: today, addDays: addDays, dayLabel: dayLabel, shortDate: shortDate,
    toast: toast, hideToast: hideToast, openSheet: openSheet, closeSheet: closeSheet, sheetOpen: sheetOpen,
    field: field, message: message, onSubmit: onSubmit, chips: chips, seg: seg, colorPicker: colorPicker,
    COLORS: COLORS, toggle: toggle, badge: badge, topbar: topbar,
    screens: {}, route: null
  };
})();
