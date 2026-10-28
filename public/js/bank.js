// Liên kết ngân hàng qua SePay (F12): hướng dẫn kết nối, địa chỉ + mã bí mật, nhật ký; hộp "Chờ xác nhận".
(function (VG) {
  'use strict';
  var h = VG.h;

  function copyBtn(text, label) {
    var b = h('button', { type: 'button', class: 'btn sm' }, label || 'Copy');
    b.addEventListener('click', function () {
      var done = function () { VG.toast('Đã copy'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { VG.toast('Hãy giữ và chọn để copy', { kind: 'warn' }); });
      else VG.toast('Hãy giữ và chọn để copy', { kind: 'warn' });
    });
    return b;
  }
  function codeBox(label, value) {
    return h('div', { class: 'stack-sm' }, h('span', { class: 'lbl' }, label),
      h('div', { class: 'code-row' }, h('code', { class: 'code' }, value), copyBtn(value)));
  }
  var RESULT = { created: ['ok', 'Đã nhận'], duplicate: ['', 'Trùng, bỏ qua'], ignored: ['warn', 'Bỏ qua'], rejected: ['bad', 'Từ chối'] };
  function fmtTime(at) {
    var d = new Date(at);
    return VG.shortDate(VG.vnDate(d)) + ' ' + new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  // Hiện địa chỉ + mã bí mật ngay sau khi tạo / đổi mã (mã chỉ hiện 1 lần)
  function showSecret(link, secret) {
    VG.openSheet(h('div', { class: 'stack' },
      h('h2', null, 'Dán vào SePay'),
      h('div', { class: 'msg warn' }, 'Mã bí mật chỉ hiện 1 lần. Copy ngay; mất thì bấm "Đổi mã" để tạo mã mới.'),
      codeBox('1. Gọi đến URL', link.hook_url),
      h('p', { class: 'small' }, '2. Kiểu chứng thực: chọn ', h('b', null, 'API Key')),
      codeBox('3. API Key', secret),
      h('p', { class: 'small' }, '4. Sự kiện: ', h('b', null, 'Có tiền vào và có tiền ra'), '. Bỏ qua "Xác thực thanh toán".'),
      h('button', { type: 'button', class: 'btn', onclick: function () { VG.closeSheet(); VG.route(); } }, 'Đã dán xong')));
  }

  function linkForm(wallets) {
    var sel = h('select', { id: 'l-wallet' }, wallets.map(function (w) { return h('option', { value: String(w.id) }, w.name); }));
    var last4 = h('input', { id: 'l-last4', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'Ví dụ 2019' });
    var auto = VG.toggle('Tự xác nhận khi có gợi ý danh mục', false, 'Bật sau khi đã quen; khoản nghi trùng hoặc nghi chuyển ví vẫn chờ xác nhận');
    var msg = VG.message();
    var btn = h('button', { type: 'submit', class: 'btn' }, 'Tạo địa chỉ nhận dữ liệu');
    var form = h('form', { class: 'stack', novalidate: true },
      h('h2', null, 'Liên kết tài khoản'),
      h('div', { class: 'field' }, h('label', { for: 'l-wallet' }, 'Ghi giao dịch vào ví'), sel),
      VG.field('4 số cuối tài khoản (không bắt buộc)', last4),
      auto, msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      return VG.api('POST', '/bank/links', { wallet_id: Number(sel.value), account_last4: last4.value || null, auto_confirm: auto.input.checked }).then(function (d) {
        showSecret(d.link, d.secret);
      });
    });
    VG.openSheet(form);
  }

  function linkCard(l) {
    var events = h('div', { class: 'stack-sm' });
    var showEvents = h('button', { type: 'button', class: 'btn link small' }, 'Xem nhật ký nhận dữ liệu');
    showEvents.addEventListener('click', function () {
      VG.api('GET', '/bank/links/' + l.id + '/events').then(function (d) {
        events.textContent = '';
        if (!d.events.length) events.appendChild(h('p', { class: 'lbl' }, 'Chưa nhận được dữ liệu nào. Chuyển thử 10.000 ₫ để kiểm tra.'));
        d.events.forEach(function (e) {
          var r = RESULT[e.result] || ['', e.result];
          events.appendChild(h('div', { class: 'event-row small' }, h('span', { class: 'chip ' + r[0] }, r[1]), h('span', { class: 'grow' }, e.detail), h('span', { class: 'lbl' }, fmtTime(e.received_at))));
        });
      }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
    });
    var auto = VG.toggle('Tự xác nhận khi có gợi ý', l.auto_confirm);
    auto.input.addEventListener('change', function () {
      VG.api('PATCH', '/bank/links/' + l.id, { auto_confirm: auto.input.checked }).catch(function (e) { auto.input.checked = !auto.input.checked; VG.toast(e.message, { kind: 'err' }); });
    });
    var rotate = h('button', { type: 'button', class: 'btn sm ghost' }, 'Đổi mã');
    rotate.addEventListener('click', function () {
      VG.api('POST', '/bank/links/' + l.id + '/rotate').then(function (d) { showSecret(d.link, d.secret); }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
    });
    var del = h('button', { type: 'button', class: 'btn sm ghost danger' }, 'Gỡ liên kết');
    del.addEventListener('click', function () {
      VG.api('DELETE', '/bank/links/' + l.id).then(function () { VG.toast('Đã gỡ liên kết (giao dịch đã ghi vẫn giữ)'); VG.route(); });
    });
    return h('div', { class: 'card' },
      h('div', { class: 'row-between' }, h('b', null, '🏦 ' + l.wallet_name + (l.account_last4 ? ' ···' + l.account_last4 : '')),
        h('span', { class: 'chip ' + (l.last_event_at ? 'ok' : 'warn') }, l.last_event_at ? 'Đã nhận dữ liệu' : 'Chờ dữ liệu đầu tiên')),
      codeBox('Địa chỉ nhận dữ liệu', l.hook_url),
      l.last_event_at ? h('span', { class: 'lbl' }, 'Lần cuối: ' + fmtTime(l.last_event_at)) : null,
      auto, h('div', { class: 'chips' }, rotate, del), showEvents, events);
  }

  VG.screens.bank = function () {
    var u = VG.state.user;
    var c = VG.shell('/me');
    c.appendChild(VG.topbar('Liên kết ngân hàng', { back: '/me' }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    Promise.all([VG.api('GET', '/bank/links'), VG.api('GET', '/wallets')]).then(function (r) {
      var links = r[0].links, wallets = r[1].wallets;
      body.textContent = '';
      var any = links.length > 0, got = links.some(function (l) { return l.last_event_at; });
      body.appendChild(h('div', { class: 'card' },
        h('b', null, 'Kết nối qua SePay'),
        h('div', { class: 'steps' },
          h('div', { class: 'done' }, h('b', null, '1'), h('span', null, 'Tạo tài khoản miễn phí tại sepay.vn')),
          h('div', { class: 'done' }, h('b', null, '2'), h('span', null, 'Trong SePay: thêm tài khoản ngân hàng của bạn')),
          h('div', { class: any ? 'done' : 'cur' }, h('b', null, any ? '✓' : '3'), h('span', null, 'Tạo địa chỉ ở đây, dán vào SePay › Tích hợp WebHooks')),
          h('div', { class: got ? 'done' : any ? 'cur' : '' }, h('b', null, got ? '✓' : '4'), h('span', null, 'Chuyển thử 10.000 ₫ để kiểm tra'))),
        h('p', { class: 'lbl' }, '🔒 Ví Gọn chỉ đọc biến động số dư, không thể chuyển tiền. Chỉ lưu 4 số cuối tài khoản.')));
      if (!u.email_verified) {
        body.appendChild(h('div', { class: 'msg warn' }, 'Cần xác minh email trước khi liên kết ngân hàng. Kiểm tra hộp thư hoặc gửi lại ở Tổng quan.'));
      } else if (!wallets.length) {
        body.appendChild(h('div', { class: 'msg info' }, 'Tạo một ví (ví dụ Techcombank) trước để nhận giao dịch.'));
      } else {
        body.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { linkForm(wallets); } }, any ? '+ Liên kết tài khoản khác' : 'Tạo địa chỉ nhận dữ liệu'));
      }
      links.forEach(function (l) { body.appendChild(linkCard(l)); });
      if (any) body.appendChild(h('a', { href: '#/bank/pending', class: 'btn ghost' }, 'Mở hộp Chờ xác nhận'));
    }).catch(function (e) { VG.fail(body, e); });
  };

  // ============ CHỜ XÁC NHẬN ============
  function pickCategory(t, cats, onPick) {
    var list = cats.filter(function (c) { return c.kind === t.kind; });
    var box = h('div', { class: 'stack' }, h('h2', null, 'Chọn danh mục'), h('p', { class: 'muted small' }, t.note || ''));
    list.filter(function (c) { return !c.parent_id; }).forEach(function (p) {
      box.appendChild(h('div', { class: 'qa-group' }, [p].concat(list.filter(function (c) { return c.parent_id === p.id; })).map(function (c) {
        return h('button', { type: 'button', class: 'chip' + (c.parent_id ? ' sub' : ''), 'aria-pressed': String(c.id === t.category_id), onclick: function () { VG.closeSheet(); onPick(c.id); } },
          (c.icon ? c.icon + ' ' : '') + c.name);
      })));
    });
    VG.openSheet(box);
  }

  VG.screens.bankPending = function () {
    var c = VG.shell('/');
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(VG.topbar('Chờ xác nhận', { back: '/' }));
    c.appendChild(body);
    Promise.all([VG.api('GET', '/bank/pending'), VG.api('GET', '/categories'), VG.api('GET', '/wallets')]).then(function (r) {
      var list = r[0].pending, cats = r[1].categories, wallets = r[2].wallets;
      var catById = {};
      cats.forEach(function (x) { catById[x.id] = x; });
      body.textContent = '';
      if (!list.length) {
        body.appendChild(h('div', { class: 'card empty' }, h('b', null, 'Không có gì chờ xác nhận'), h('p', { class: 'muted small' }, 'Giao dịch từ ngân hàng sẽ hiện ở đây kèm danh mục gợi ý.')));
        return;
      }
      var clear = list.filter(function (t) { return t.category_id && !t.suggest_wallet_id && !t.duplicate; }).length;
      var all = h('button', { type: 'button', class: 'btn sm', disabled: !clear }, 'Đúng hết (' + clear + ')');
      all.addEventListener('click', function () {
        VG.api('POST', '/bank/pending/confirm-all').then(function (d) { VG.toast('Đã xác nhận ' + d.confirmed + ' giao dịch'); VG.route(); });
      });
      body.appendChild(h('div', { class: 'row-between' }, h('b', null, list.length + ' giao dịch'), all));
      function act(path, data, text) {
        return VG.api('POST', '/bank/pending/' + path, data).then(function (d) { VG.toast(text + (d && d.learned ? ' · lần sau tự gợi ý như vậy' : '')); VG.route(); })
          .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
      }
      list.forEach(function (t) {
        var cat = t.category_id ? catById[t.category_id] : null;
        var suggestion;
        var okBtn = h('button', { type: 'button', class: 'btn sm' }, 'Đúng');
        var change = h('button', { type: 'button', class: 'btn sm ghost' }, 'Đổi');
        change.addEventListener('click', function () { pickCategory(t, cats, function (id) { act(t.id + '/confirm', { category_id: id }, 'Đã lưu'); }); });
        var extra = null;
        if (t.suggest_wallet_id) {
          suggestion = h('span', { class: 'chip' }, '⇄ Chuyển giữa ví');
          extra = h('div', { class: 'msg info' }, 'Có vẻ là chuyển tiền ' + (t.kind === 'expense' ? 'sang ' : 'từ ') + (t.suggest_wallet_name || 'ví khác') + ', không phải khoản ' + (t.kind === 'expense' ? 'chi' : 'thu'));
          okBtn.addEventListener('click', function () { act(t.id + '/confirm', { transfer_wallet_id: t.suggest_wallet_id }, 'Đã ghi là chuyển giữa ví'); });
        } else {
          suggestion = cat ? h('span', { class: 'chip' }, (cat.icon ? cat.icon + ' ' : '') + cat.name) : h('span', { class: 'chip warn' }, 'Chưa có gợi ý');
          okBtn.disabled = !cat;
          okBtn.addEventListener('click', function () { act(t.id + '/confirm', {}, 'Đã xác nhận'); });
        }
        if (t.duplicate) {
          var merge = h('button', { type: 'button', class: 'btn sm' }, 'Gộp');
          merge.addEventListener('click', function () { act(t.id + '/merge', null, 'Đã gộp với khoản ghi tay'); });
          extra = h('div', { class: 'msg warn' }, h('span', null, 'Có vẻ trùng khoản ghi tay' + (t.duplicate.category_name ? ' "' + t.duplicate.category_name + '"' : '') + (t.duplicate.note ? ' · ' + t.duplicate.note : '')), merge);
        }
        // Không phải chuyển ví như gợi ý → chọn ví khác hoặc danh mục
        var asTransfer = wallets.filter(function (w) { return w.id !== t.wallet_id; }).length && !t.suggest_wallet_id ? h('button', { type: 'button', class: 'btn link small' }, 'Là chuyển giữa ví?') : null;
        if (asTransfer) {
          asTransfer.addEventListener('click', function () {
            var box = h('div', { class: 'stack' }, h('h2', null, 'Chuyển ' + (t.kind === 'expense' ? 'sang' : 'từ') + ' ví nào?'));
            wallets.filter(function (w) { return w.id !== t.wallet_id; }).forEach(function (w) {
              box.appendChild(h('button', { type: 'button', class: 'choice', onclick: function () { VG.closeSheet(); act(t.id + '/confirm', { transfer_wallet_id: w.id }, 'Đã ghi là chuyển giữa ví'); } }, h('span', null, w.name)));
            });
            VG.openSheet(box);
          });
        }
        body.appendChild(h('div', { class: 'card' },
          h('div', { class: 'row-between' }, h('span', { class: 'lbl' }, t.wallet_name + ' · ' + fmtTime(t.occurred_at)),
            h('b', { class: 'amt ' + (t.kind === 'income' ? 'in' : 'out') }, (t.kind === 'income' ? '+' : '−') + VG.show(t.amount, { symbol: false }))),
          h('b', { class: 'tx-note' }, t.note || '(không có nội dung)'),
          extra,
          h('div', { class: 'row-between' }, suggestion, h('span', { class: 'chips' }, change, okBtn)),
          asTransfer));
      });
    }).catch(function (e) { VG.fail(body, e); });
  };
})(window.VG);
