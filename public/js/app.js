// Ví Gọn - client (không framework). Router theo hash: #/login, #/register, #/forgot,
// #/reset?token=…, #/verify?token=…, #/onboarding, #/ (trang chính).
// Mọi nội dung động gắn bằng textContent (qua h()) → không chèn HTML từ dữ liệu.
(function () {
  'use strict';

  var TOKEN_KEY = 'vigon_token';
  var app = document.getElementById('app');
  var state = { user: null };

  // ============ TIỆN ÍCH ============
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // h('div', { class: 'x', onclick: fn }, 'chữ', con...) → phần tử DOM
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    kids.forEach(function add(c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function render() {
    app.textContent = '';
    Array.prototype.slice.call(arguments).forEach(function (n) { if (n) app.appendChild(n); });
    var first = app.querySelector('input');
    if (first) first.focus();
  }

  function go(path) {
    if (location.hash === '#' + path) route();
    else location.hash = path;
  }

  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch('/api' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && t) { setToken(null); state.user = null; }
          if (!r.ok) {
            var err = new Error(data.error || 'Có lỗi xảy ra, thử lại sau.');
            err.status = r.status;
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

  function signedIn(data) {
    setToken(data.token);
    state.user = data.user;
    applyTheme(data.user);
  }

  function queryParam(name) {
    var q = location.hash.split('?')[1] || '';
    var m = q.split('&').map(function (p) { return p.split('='); }).filter(function (p) { return p[0] === name; })[0];
    return m ? decodeURIComponent(m[1] || '') : '';
  }

  // ============ KHỐI GIAO DIỆN ============
  function field(label, attrs) {
    var input = h('input', attrs);
    var wrap = h('div', { class: 'field' }, h('label', { for: attrs.id }, label));
    if (attrs.type === 'password') {
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
    box.show = function (text, kind) {
      box.textContent = text;
      box.className = 'msg ' + (kind || 'err');
    };
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

  function header(title, sub) {
    return h('div', { class: 'stack' },
      h('div', { class: 'brand' }, 'Ví Gọn'),
      h('h1', null, title),
      sub ? h('p', { class: 'muted' }, sub) : null);
  }

  // ============ MÀN HÌNH ============
  function screenLogin() {
    var msg = message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Đăng nhập');
    var form = h('form', { class: 'stack', novalidate: true },
      field('Email', { id: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true }),
      field('Mật khẩu', { id: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      msg, btn,
      h('a', { href: '#/forgot', class: 'small' }, 'Quên mật khẩu?'));
    onSubmit(form, btn, msg, function () {
      return api('POST', '/auth/login', { email: form.email.value, password: form.password.value })
        .then(function (d) { signedIn(d); go(d.user.onboarded ? '/' : '/onboarding'); });
    });
    render(header('Đăng nhập', 'Chào mừng bạn quay lại.'), form,
      h('div', { class: 'bottom' }, h('p', { class: 'muted small' }, 'Chưa có tài khoản? ', h('a', { href: '#/register' }, 'Đăng ký'))));
  }

  function screenRegister() {
    var msg = message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Tạo tài khoản');
    var form = h('form', { class: 'stack', novalidate: true },
      field('Tên của bạn (không bắt buộc)', { id: 'full_name', type: 'text', autocomplete: 'name', maxlength: '100' }),
      field('Email', { id: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true }),
      field('Mật khẩu (ít nhất 8 ký tự)', { id: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true }),
      msg, btn);
    onSubmit(form, btn, msg, function () {
      if (form.password.value.length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự');
      return api('POST', '/auth/register', {
        full_name: form.full_name.value, email: form.email.value, password: form.password.value
      }).then(function (d) { signedIn(d); go('/onboarding'); });
    });
    render(header('Tạo tài khoản', 'Ghi thu chi nhanh, biết tiền mình đi đâu.'), form,
      h('div', { class: 'bottom' }, h('p', { class: 'muted small' }, 'Đã có tài khoản? ', h('a', { href: '#/login' }, 'Đăng nhập'))));
  }

  function screenForgot() {
    var msg = message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Gửi link đặt lại');
    var form = h('form', { class: 'stack', novalidate: true },
      field('Email đã đăng ký', { id: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true }),
      msg, btn);
    onSubmit(form, btn, msg, function () {
      return api('POST', '/auth/forgot', { email: form.email.value })
        .then(function (d) { msg.show(d.message, 'ok'); });
    });
    render(header('Quên mật khẩu', 'Nhập email, chúng tôi gửi link đặt mật khẩu mới.'), form,
      h('div', { class: 'bottom' }, h('a', { href: '#/login', class: 'small' }, '← Quay lại đăng nhập')));
  }

  function screenReset() {
    var token = queryParam('token');
    var msg = message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Lưu mật khẩu mới');
    var form = h('form', { class: 'stack', novalidate: true },
      field('Mật khẩu mới (ít nhất 8 ký tự)', { id: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true }),
      msg, btn);
    onSubmit(form, btn, msg, function () {
      if (form.password.value.length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự');
      return api('POST', '/auth/reset', { token: token, password: form.password.value })
        .then(function (d) { signedIn(d); go(d.user.onboarded ? '/' : '/onboarding'); });
    });
    render(header('Đặt mật khẩu mới', 'Các máy khác đang đăng nhập sẽ bị đăng xuất.'), form);
  }

  function screenVerify() {
    var token = queryParam('token');
    var box = h('div', { class: 'msg info' }, 'Đang xác minh email…');
    var next = h('a', { href: '#/', class: 'btn' }, 'Vào Ví Gọn');
    render(header('Xác minh email'), box, h('div', { class: 'bottom' }, next));
    api('POST', '/auth/verify-email', { token: token })
      .then(function () {
        box.className = 'msg ok';
        box.textContent = 'Đã xác minh email. Cảm ơn bạn!';
        if (state.user) state.user.email_verified = true;
      })
      .catch(function (e) { box.className = 'msg err'; box.textContent = e.message; });
  }

  // Làm quen: bước 1 chọn mục đích (bỏ qua được).
  // Bước 2 (tạo ví) và 3 (bộ danh mục) cần API ví/danh mục → có ở Bước 3 của kế hoạch.
  var PURPOSES = [
    ['track', '🧾', 'Biết tiền mình tiêu vào đâu'],
    ['save', '🎯', 'Tiết kiệm cho một mục tiêu'],
    ['debt', '💳', 'Kiểm soát nợ, thẻ tín dụng'],
    ['family', '🏠', 'Quản lý chi tiêu gia đình'],
    ['other', '✨', 'Lý do khác']
  ];

  function screenOnboarding() {
    var chosen = state.user.onboarding_purpose;
    var msg = message();
    var buttons = PURPOSES.map(function (p) {
      var b = h('button', { type: 'button', class: 'choice', 'aria-pressed': String(chosen === p[0]) },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, p[1]), h('span', null, p[2]));
      b.addEventListener('click', function () {
        chosen = p[0];
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
      return b;
    });
    var next = h('button', { class: 'btn', type: 'button' }, 'Tiếp tục');
    var skip = h('button', { class: 'btn link', type: 'button' }, 'Bỏ qua');
    function finish(purpose) {
      next.disabled = skip.disabled = true;
      var p = purpose ? api('PATCH', '/me', { onboarding_purpose: purpose }).then(function (d) { state.user = d.user; }) : Promise.resolve();
      p.then(function () { go('/onboarding/wallet'); })
        .catch(function (e) { msg.show(e.message); next.disabled = skip.disabled = false; });
    }
    next.addEventListener('click', function () { finish(chosen); });
    skip.addEventListener('click', function () { finish(null); });
    render(
      h('div', { class: 'dots' }, h('i', { class: 'on' }), h('i'), h('i')),
      h('span', { class: 'step-lbl' }, 'Bước 1/3'),
      h('h1', null, 'Bạn dùng Ví Gọn để làm gì?'),
      h('p', { class: 'muted' }, 'Chọn một mục để Ví Gọn gợi ý phù hợp hơn.'),
      h('div', { class: 'choices' }, buttons),
      msg,
      h('div', { class: 'bottom' }, next, skip));
  }

  function screenOnboardingWallet() {
    render(
      h('div', { class: 'dots' }, h('i'), h('i', { class: 'on' }), h('i')),
      h('span', { class: 'step-lbl' }, 'Bước 2/3'),
      h('h1', null, 'Bạn đang có bao nhiêu tiền?'),
      h('div', { class: 'msg info' }, 'Phần tạo ví đầu tiên đang được xây dựng và sẽ có trong bản cập nhật tới.'),
      h('div', { class: 'bottom' }, h('a', { href: '#/', class: 'btn' }, 'Về trang chính')));
  }

  function screenHome() {
    var u = state.user;
    var verifyBox = null;
    if (!u.email_verified) {
      var resend = h('button', { type: 'button', class: 'btn link' }, 'Gửi lại');
      verifyBox = h('div', { class: 'msg warn' }, h('span', null, 'Kiểm tra hộp thư để xác minh email.'), resend);
      resend.addEventListener('click', function () {
        resend.disabled = true;
        api('POST', '/auth/resend-verify')
          .then(function () { verifyBox.className = 'msg ok'; verifyBox.textContent = 'Đã gửi lại email xác minh.'; })
          .catch(function (e) { verifyBox.className = 'msg err'; verifyBox.textContent = e.message; });
      });
    }
    var out = h('button', { type: 'button', class: 'btn ghost' }, 'Đăng xuất');
    out.addEventListener('click', function () {
      api('POST', '/auth/logout').catch(function () {}).then(function () {
        setToken(null); state.user = null; applyTheme(null); go('/login');
      });
    });
    render(
      h('div', { class: 'topbar' }, h('div', { class: 'brand' }, 'Ví Gọn')),
      h('h1', null, 'Xin chào' + (u.full_name ? ', ' + u.full_name : '') + '!'),
      verifyBox,
      !u.onboarded ? h('div', { class: 'card' },
        h('b', null, 'Hoàn tất làm quen'),
        h('p', { class: 'muted small' }, 'Tạo ví đầu tiên để bắt đầu ghi thu chi.'),
        h('a', { href: '#/onboarding', class: 'btn' }, 'Tiếp tục')) : null,
      h('p', { class: 'muted small' }, 'Đăng nhập bằng ' + u.email),
      h('div', { class: 'bottom' }, out));
  }

  // ============ ROUTER ============
  var PUBLIC = { '/login': screenLogin, '/register': screenRegister, '/forgot': screenForgot, '/reset': screenReset, '/verify': screenVerify };
  var PRIVATE = { '/': screenHome, '/onboarding': screenOnboarding, '/onboarding/wallet': screenOnboardingWallet };

  function route() {
    var path = (location.hash.replace(/^#/, '').split('?')[0]) || '/';
    if (PUBLIC[path]) {
      // Đã đăng nhập mà mở trang đăng nhập/đăng ký → về trang chính
      if (getToken() && (path === '/login' || path === '/register')) return go('/');
      return PUBLIC[path]();
    }
    var screen = PRIVATE[path] || screenHome;
    if (!getToken()) return go('/login');
    if (state.user) return screen();
    api('GET', '/me')
      .then(function (d) { state.user = d.user; applyTheme(d.user); screen(); })
      .catch(function (e) {
        if (e.status === 401) return go('/login');
        render(h('div', { class: 'center' }, h('div', { class: 'logo' }, 'Ví Gọn'), h('p', { class: 'muted' }, e.message),
          h('button', { class: 'btn', type: 'button', onclick: route }, 'Thử lại')));
      });
  }

  window.addEventListener('hashchange', route);
  route();
})();
