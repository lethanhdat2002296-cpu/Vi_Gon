// Màn hình tài khoản: đăng nhập, đăng ký, quên/đặt lại mật khẩu, xác minh email (F01)
(function (VG) {
  'use strict';
  var h = VG.h;

  function header(title, sub) {
    return h('div', { class: 'stack' },
      h('div', { class: 'brand' }, 'Ví Gọn'),
      h('h1', null, title),
      sub ? h('p', { class: 'muted' }, sub) : null);
  }

  function input(attrs) { return h('input', attrs); }

  var EMAIL_KEY = 'vigon_email';
  function lastEmail() { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; } }

  function afterSignIn(d, remember) {
    VG.signedIn(d, remember);
    try { if (remember === false) localStorage.removeItem(EMAIL_KEY); else localStorage.setItem(EMAIL_KEY, d.user.email); } catch (e) {}
    VG.go(d.user.onboarded ? '/' : '/onboarding');
  }

  VG.screens.login = function () {
    var msg = VG.message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Đăng nhập');
    var remember = VG.toggle('Ghi nhớ đăng nhập', true, 'Tắt nếu dùng máy chung: đóng trình duyệt là thoát');
    var email = input({ id: 'email', name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true, value: lastEmail() });
    var form = h('form', { class: 'stack', novalidate: true, method: 'post', action: '#/login' },
      VG.field('Email', email),
      VG.field('Mật khẩu', input({ id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      remember, msg, btn,
      h('a', { href: '#/forgot', class: 'small' }, 'Quên mật khẩu?'));
    VG.onSubmit(form, btn, msg, function () {
      var keep = remember.input.checked;
      return VG.api('POST', '/auth/login', { email: form.email.value, password: form.password.value }).then(function (d) {
        // Nhờ trình duyệt lưu mật khẩu (Chrome/Android: hiện hỏi "Lưu mật khẩu?", lần sau tự điền)
        if (keep && window.PasswordCredential && navigator.credentials) {
          try { navigator.credentials.store(new window.PasswordCredential({ id: form.email.value, password: form.password.value, name: d.user.full_name || undefined })).catch(function () {}); } catch (e) {}
        }
        afterSignIn(d, keep);
      });
    });
    VG.render(h('div', { class: 'screen' }, header('Đăng nhập', 'Chào mừng bạn quay lại.'), form,
      h('div', { class: 'bottom' }, h('p', { class: 'muted small' }, 'Chưa có tài khoản? ', h('a', { href: '#/register' }, 'Đăng ký')))));
    if (email.value) form.password.focus();
  };

  VG.screens.register = function () {
    var msg = VG.message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Tạo tài khoản');
    var form = h('form', { class: 'stack', novalidate: true },
      VG.field('Tên của bạn (không bắt buộc)', input({ id: 'full_name', name: 'full_name', type: 'text', autocomplete: 'name', maxlength: '100' })),
      VG.field('Email', input({ id: 'email', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true })),
      VG.field('Mật khẩu (ít nhất 8 ký tự)', input({ id: 'password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      if (form.password.value.length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự');
      return VG.api('POST', '/auth/register', {
        full_name: form.full_name.value, email: form.email.value, password: form.password.value
      }).then(afterSignIn);
    });
    VG.render(h('div', { class: 'screen' }, header('Tạo tài khoản', 'Ghi thu chi nhanh, biết tiền mình đi đâu.'), form,
      h('div', { class: 'bottom' }, h('p', { class: 'muted small' }, 'Đã có tài khoản? ', h('a', { href: '#/login' }, 'Đăng nhập')))));
  };

  VG.screens.forgot = function () {
    var msg = VG.message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Gửi link đặt lại');
    var form = h('form', { class: 'stack', novalidate: true },
      VG.field('Email đã đăng ký', input({ id: 'email', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true })),
      msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      return VG.api('POST', '/auth/forgot', { email: form.email.value }).then(function (d) { msg.show(d.message, 'ok'); });
    });
    VG.render(h('div', { class: 'screen' }, header('Quên mật khẩu', 'Nhập email, chúng tôi gửi link đặt mật khẩu mới.'), form,
      h('div', { class: 'bottom' }, h('a', { href: '#/login', class: 'small' }, '← Quay lại đăng nhập'))));
  };

  VG.screens.reset = function () {
    var token = VG.queryParam('token');
    var msg = VG.message();
    var btn = h('button', { class: 'btn', type: 'submit' }, 'Lưu mật khẩu mới');
    var form = h('form', { class: 'stack', novalidate: true },
      VG.field('Mật khẩu mới (ít nhất 8 ký tự)', input({ id: 'password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      if (form.password.value.length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự');
      return VG.api('POST', '/auth/reset', { token: token, password: form.password.value }).then(afterSignIn);
    });
    VG.render(h('div', { class: 'screen' }, header('Đặt mật khẩu mới', 'Các máy khác đang đăng nhập sẽ bị đăng xuất.'), form));
  };

  VG.screens.verify = function () {
    var token = VG.queryParam('token');
    var box = h('div', { class: 'msg info' }, 'Đang xác minh email…');
    VG.render(h('div', { class: 'screen' }, header('Xác minh email'), box,
      h('div', { class: 'bottom' }, h('a', { href: '#/', class: 'btn' }, 'Vào Ví Gọn'))));
    VG.api('POST', '/auth/verify-email', { token: token })
      .then(function () {
        box.className = 'msg ok';
        box.textContent = 'Đã xác minh email. Cảm ơn bạn!';
        if (VG.state.user) VG.state.user.email_verified = true;
      })
      .catch(function (e) { box.className = 'msg err'; box.textContent = e.message; });
  };
})(window.VG);
