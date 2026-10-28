// Cài đặt (F08): hồ sơ, email, mật khẩu, giao diện, ẩn số tiền, PIN, xuất/nhập dữ liệu, xoá tài khoản.
// Khoá app bằng PIN: sau 5 phút không dùng (hoặc mở lại app) phải nhập PIN; server kiểm PIN.
(function (VG) {
  'use strict';
  var h = VG.h;

  // ============ KHOÁ BẰNG PIN ============
  var ACTIVE_KEY = 'vigon_last_active';
  var IDLE_MS = 5 * 60 * 1000;
  var locked = false;
  var lastWrite = 0;

  function lastActive() {
    try { return Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (e) { return 0; }
  }
  function touch() {
    var now = Date.now();
    if (now - lastWrite < 10000) return;
    lastWrite = now;
    try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch (e) {}
  }
  function shouldLock() {
    return !!(VG.state.user && VG.state.user.has_pin && VG.getToken() && Date.now() - lastActive() > IDLE_MS);
  }
  // Gọi trước khi vẽ màn hình riêng tư: true = đang khoá (đã vẽ màn khoá)
  VG.checkLock = function () {
    if (!locked && shouldLock()) locked = true;
    if (locked) { lockScreen(); return true; }
    touch();
    return false;
  };
  VG.unlockedNow = function () { locked = false; lastWrite = 0; touch(); };

  ['pointerdown', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (!locked) touch(); }, { passive: true });
  });
  // Quay lại app sau khi để nền / máy ngủ: kiểm lại
  function recheck() {
    if (!locked && shouldLock()) { locked = true; VG.closeSheet(); VG.hideToast(); lockScreen(); }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') recheck(); });
  setInterval(recheck, 30000);

  function lockScreen() {
    var pin = '';
    var dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
    var msg = VG.message();
    function draw() {
      dots.textContent = '';
      for (var i = 0; i < Math.max(4, pin.length); i++) dots.appendChild(h('i', { class: i < pin.length ? 'on' : null }));
    }
    function submit() {
      if (pin.length < 4) return msg.show('PIN gồm 4 đến 6 chữ số');
      var tried = pin;
      pin = ''; draw();
      VG.api('POST', '/me/pin/verify', { pin: tried }).then(function () {
        VG.unlockedNow(); VG.route();
      }).catch(function (e) {
        if (e.status === 401) { locked = false; VG.signOut(); VG.go('/login'); setTimeout(function () { VG.toast(e.message, { kind: 'err', ms: 6000 }); }, 50); return; }
        msg.show(e.message);
      });
    }
    function press(k) {
      msg.hide();
      if (k === 'back') pin = pin.slice(0, -1);
      else if (k === 'ok') return submit();
      else if (pin.length < 6) pin += k;
      draw();
    }
    var keys = h('div', { class: 'pin-keys' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map(function (k) {
      return h('button', { type: 'button', class: 'key' + (k === 'ok' ? ' ok-key' : k === 'back' ? ' fn' : ''), 'aria-label': k === 'back' ? 'Xoá' : k === 'ok' ? 'Mở khoá' : k, onclick: function () { press(k); } },
        k === 'back' ? '⌫' : k === 'ok' ? 'Mở' : k);
    }));
    var out = h('button', { type: 'button', class: 'btn link' }, 'Quên PIN? Đăng xuất');
    out.addEventListener('click', function () { locked = false; VG.signOut(); VG.go('/login'); });
    VG.render(h('div', { class: 'screen lock' },
      h('div', { class: 'center' }, h('div', { class: 'logo' }, 'Ví Gọn'), h('p', { class: 'muted' }, 'Nhập PIN để mở khoá'), dots),
      msg, keys, out));
    draw();
    document.onkeydown = function (ev) {
      if (!locked) { document.onkeydown = null; return; }
      if (/^\d$/.test(ev.key)) press(ev.key);
      else if (ev.key === 'Backspace') press('back');
      else if (ev.key === 'Enter') press('ok');
    };
  }

  // ============ TẢI FILE KÈM ĐĂNG NHẬP ============
  VG.download = function (path, btn, doneText) {
    if (btn) btn.disabled = true;
    return fetch('/api' + path, { headers: { Authorization: 'Bearer ' + VG.getToken() } }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Không tải được file'); });
      var name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b);
        var a = h('a', { href: url, download: name ? name[1] : 'vi-gon' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        if (doneText) VG.toast(doneText);
      });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); }).then(function () { if (btn) btn.disabled = false; });
  };

  // Chọn file từ máy; đọc dạng chữ (JSON) hoặc base64 (Excel)
  function pickFile(accept, asText, onFile) {
    var input = h('input', { type: 'file', accept: accept, class: 'hidden' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) return VG.toast('File lớn quá 3 MB', { kind: 'err' });
      var reader = new FileReader();
      reader.onload = function () {
        onFile(asText ? reader.result : String(reader.result).split(',')[1] || '', f.name);
      };
      reader.onerror = function () { VG.toast('Không đọc được file', { kind: 'err' }); };
      if (asText) reader.readAsText(f); else reader.readAsDataURL(f);
    });
    document.body.appendChild(input);
    input.click();
  }

  // ============ MÀN CÀI ĐẶT ============
  function section(title, sub) {
    var box = h('div', { class: 'card' }, h('b', null, title), sub ? h('p', { class: 'muted small' }, sub) : null);
    return box;
  }
  function pwInput(id, label, auto) {
    return VG.field(label, h('input', { id: id, type: 'password', autocomplete: auto || 'current-password' }));
  }
  function formWith(fields, btnLabel, handler, btnClass) {
    var msg = VG.message();
    var btn = h('button', { type: 'submit', class: btnClass || 'btn' }, btnLabel);
    var form = h('form', { class: 'stack', novalidate: true }, fields, msg, btn);
    VG.onSubmit(form, btn, msg, function () { return handler(form, msg); });
    return form;
  }
  function val(form, id) { return form.querySelector('#' + id).value; }
  function setUser(u) { VG.state.user = u; VG.applyTheme(u); }

  VG.screens.settings = function () {
    var u = VG.state.user;
    var c = VG.shell('/me');
    c.appendChild(VG.topbar('Cài đặt', { back: '/me' }));

    // Hồ sơ
    var profile = section('Hồ sơ');
    profile.appendChild(formWith([
      VG.field('Tên', h('input', { id: 's-name', type: 'text', maxlength: '100', value: u.full_name, autocomplete: 'name' }))
    ], 'Lưu tên', function (form) {
      return VG.api('PATCH', '/me', { full_name: val(form, 's-name') }).then(function (d) { setUser(d.user); VG.toast('Đã lưu tên'); });
    }, 'btn ghost'));
    c.appendChild(profile);

    // Email
    var mail = section('Email', u.email + (u.email_verified ? ' · đã xác minh' : ' · chưa xác minh'));
    mail.appendChild(h('details', null, h('summary', null, 'Đổi email'), formWith([
      VG.field('Email mới', h('input', { id: 's-email', type: 'email', inputmode: 'email', autocomplete: 'email' })),
      pwInput('s-email-pw', 'Mật khẩu hiện tại')
    ], 'Đổi email', function (form) {
      return VG.api('POST', '/me/email', { email: val(form, 's-email'), password: val(form, 's-email-pw') }).then(function (d) {
        setUser(d.user); VG.toast('Đã đổi email. Kiểm tra hộp thư để xác minh.'); VG.route();
      });
    })));
    c.appendChild(mail);

    // Mật khẩu
    var pw = section('Mật khẩu', 'Đổi mật khẩu sẽ đăng xuất mọi máy khác.');
    pw.appendChild(h('details', null, h('summary', null, 'Đổi mật khẩu'), formWith([
      pwInput('s-cur', 'Mật khẩu hiện tại'),
      pwInput('s-new', 'Mật khẩu mới (ít nhất 8 ký tự)', 'new-password')
    ], 'Đổi mật khẩu', function (form) {
      return VG.api('POST', '/me/password', { current_password: val(form, 's-cur'), new_password: val(form, 's-new') }).then(function (d) {
        VG.signedIn(d); VG.toast('Đã đổi mật khẩu'); VG.route();
      });
    })));
    c.appendChild(pw);

    // Giao diện + ẩn số tiền
    var look = section('Giao diện');
    look.appendChild(VG.seg([['system', 'Theo máy'], ['light', 'Sáng'], ['dark', 'Tối']], u.theme, function (t) {
      var old = u.theme;
      u.theme = t; VG.applyTheme(u);
      VG.api('PATCH', '/me', { theme: t }).catch(function (e) { u.theme = old; VG.applyTheme(u); VG.toast(e.message, { kind: 'err' }); VG.route(); });
    }));
    var hide = VG.toggle('Ẩn số tiền', u.hide_amounts, 'Che số dư và số tiền khi đang ở chỗ đông người');
    hide.input.addEventListener('change', function () {
      var v = hide.input.checked;
      VG.api('PATCH', '/me', { hide_amounts: v }).then(function (d) { setUser(d.user); })
        .catch(function (e) { hide.input.checked = !v; VG.toast(e.message, { kind: 'err' }); });
    });
    look.appendChild(hide);
    c.appendChild(look);

    // PIN
    var pinBox = section('Khoá bằng PIN', u.has_pin ? 'Đang bật. Sau 5 phút không dùng, mở lại app phải nhập PIN.' : 'Đang tắt. Bật để khoá app sau 5 phút không dùng.');
    var pinFields = [
      VG.field('PIN mới (4–6 số)', h('input', { id: 's-pin', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'off' })),
      VG.field('Nhập lại PIN', h('input', { id: 's-pin2', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'off' })),
      pwInput('s-pin-pw', 'Mật khẩu tài khoản')
    ];
    pinBox.appendChild(h('details', null, h('summary', null, u.has_pin ? 'Đổi PIN' : 'Bật PIN'), formWith(pinFields, u.has_pin ? 'Đổi PIN' : 'Bật PIN', function (form) {
      var p1 = val(form, 's-pin'), p2 = val(form, 's-pin2');
      if (!/^\d{4,6}$/.test(p1)) throw new Error('PIN gồm 4 đến 6 chữ số');
      if (p1 !== p2) throw new Error('Hai lần nhập PIN không khớp');
      return VG.api('POST', '/me/pin', { pin: p1, password: val(form, 's-pin-pw') }).then(function (d) {
        setUser(d.user); VG.unlockedNow(); VG.toast('Đã bật khoá bằng PIN'); VG.route();
      });
    })));
    if (u.has_pin) {
      pinBox.appendChild(h('details', null, h('summary', null, 'Tắt PIN'), formWith([pwInput('s-unpin-pw', 'Mật khẩu tài khoản')], 'Tắt PIN', function (form) {
        return VG.api('DELETE', '/me/pin', { password: val(form, 's-unpin-pw') }).then(function (d) { setUser(d.user); VG.toast('Đã tắt PIN'); VG.route(); });
      }, 'btn ghost')));
    }
    c.appendChild(pinBox);

    // Dữ liệu
    var data = section('Dữ liệu', 'Sao lưu để luôn lấy lại được dữ liệu. Nhập là thêm vào dữ liệu đang có.');
    var expXlsx = h('button', { type: 'button', class: 'btn ghost' }, 'Xuất Excel toàn bộ');
    expXlsx.addEventListener('click', function () { VG.download('/export.xlsx', expXlsx, 'Đã xuất Excel'); });
    var expJson = h('button', { type: 'button', class: 'btn ghost' }, 'Sao lưu JSON');
    expJson.addEventListener('click', function () { VG.download('/data/export.json', expJson, 'Đã tải bản sao lưu'); });
    var result = h('div');
    function showResult(kind, text, errors) {
      result.textContent = '';
      result.appendChild(h('div', { class: 'msg ' + kind }, text));
      if (errors && errors.length) {
        result.appendChild(h('ul', { class: 'err-list small' }, errors.map(function (e) { return h('li', null, 'Dòng ' + e.row + ': ' + e.error); })));
      }
    }
    var impJson = h('button', { type: 'button', class: 'btn ghost' }, 'Nhập bản sao lưu JSON');
    impJson.addEventListener('click', function () {
      pickFile('.json,application/json', true, function (text) {
        var backup;
        try { backup = JSON.parse(text); } catch (e) { return showResult('err', 'File không phải JSON hợp lệ'); }
        impJson.disabled = true;
        VG.api('POST', '/data/import.json', { backup: backup }).then(function (d) {
          VG.state.user = null;
          showResult('ok', 'Đã nhập ' + d.wallets + ' ví, ' + d.transactions + ' giao dịch' + (d.categories_created ? ', thêm ' + d.categories_created + ' danh mục' : '') + '.');
        }).catch(function (e) { showResult('err', e.message); }).then(function () { impJson.disabled = false; });
      });
    });
    var tpl = h('button', { type: 'button', class: 'btn link' }, 'Tải file Excel mẫu');
    tpl.addEventListener('click', function () { VG.download('/data/template.xlsx', tpl); });
    var impXlsx = h('button', { type: 'button', class: 'btn ghost' }, 'Nhập giao dịch từ Excel mẫu');
    impXlsx.addEventListener('click', function () {
      pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false, function (b64) {
        impXlsx.disabled = true;
        VG.api('POST', '/data/import.xlsx', { file: b64 }).then(function (d) {
          VG.state.user = null;
          var extra = [];
          if (d.created_wallets.length) extra.push('tạo ví ' + d.created_wallets.join(', '));
          if (d.created_categories.length) extra.push('tạo danh mục ' + d.created_categories.join(', '));
          showResult('ok', 'Đã nhập ' + d.transactions + ' giao dịch' + (extra.length ? ' (' + extra.join('; ') + ')' : '') + '.');
        }).catch(function (e) { showResult('err', e.message, e.data && e.data.errors); }).then(function () { impXlsx.disabled = false; });
      });
    });
    data.appendChild(h('div', { class: 'stack' }, expXlsx, expJson, impJson, impXlsx, tpl, result));
    c.appendChild(data);

    // Xoá tài khoản
    var del = section('Xoá tài khoản', 'Xoá vĩnh viễn tài khoản và mọi ví, danh mục, giao dịch. Không khôi phục được. Nên sao lưu JSON trước.');
    del.appendChild(h('details', null, h('summary', { class: 'danger' }, 'Xoá tài khoản vĩnh viễn'), formWith([
      pwInput('s-del-pw', 'Mật khẩu tài khoản'),
      VG.field('Gõ XOA để xác nhận', h('input', { id: 's-del-confirm', type: 'text', autocomplete: 'off', autocapitalize: 'characters' }))
    ], 'Xoá vĩnh viễn', function (form) {
      if (val(form, 's-del-confirm').trim().toUpperCase() !== 'XOA') throw new Error('Gõ XOA để xác nhận');
      return VG.api('DELETE', '/me', { password: val(form, 's-del-pw'), confirm: 'XOA' }).then(function () {
        VG.signOut(); VG.go('/login'); setTimeout(function () { VG.toast('Đã xoá tài khoản. Tạm biệt!'); }, 50);
      });
    }, 'btn danger-btn')));
    c.appendChild(del);
  };
})(window.VG);
