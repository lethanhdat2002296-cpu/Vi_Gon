// Dùng chung: sổ chung gia đình (F14), chia tiền nhóm (F15), sổ nợ (F16)
(function (VG) {
  'use strict';
  var h = VG.h;
  var ROLE_LABEL = { owner: 'Chủ sổ', editor: 'Thành viên', viewer: 'Người xem' };

  function money(n) { return VG.show(n, { symbol: false }); }
  function selectEl(id, options, value) {
    var sel = h('select', { id: id });
    options.forEach(function (o) { var opt = h('option', { value: String(o[0]) }, o[1]); if (String(o[0]) === String(value)) opt.selected = true; sel.appendChild(opt); });
    return sel;
  }
  function bar(pct, level) {
    var fill = h('i', { class: level || '' });
    fill.style.width = Math.min(100, Math.round(pct * 100)) + '%';
    return h('div', { class: 'prog', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct * 100)) }, fill);
  }
  function dateInput(id, value, opts) {
    opts = opts || {};
    return h('input', { id: id, type: 'date', value: value || '', max: opts.max || null, min: opts.min || null });
  }
  function copyText(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text).then(function () { VG.toast('Đã chép link'); }, function () { VG.toast('Không chép được, hãy chép tay', { kind: 'err' }); });
    VG.toast('Hãy chép link bên dưới', { kind: 'err' });
  }

  // ============ ĐỔI SỔ (Sổ của tôi / Sổ gia đình) ============
  VG.bookSwitch = function () {
    var books = VG.state.books || [];
    if (books.length < 2) return null;
    var cur = VG.state.book;
    return h('div', { class: 'chips book-switch', role: 'radiogroup', 'aria-label': 'Chọn sổ' }, books.map(function (b) {
      var on = cur ? cur.id === b.id : b.kind === 'personal';
      return h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(on), onclick: function () {
        if (on) return;
        VG.setBook(b);
        VG.toast('Đang xem: ' + b.name + (b.role === 'viewer' ? ' (chỉ xem)' : ''));
        VG.route();
      } }, (b.kind === 'personal' ? '👤 ' : '👨‍👩‍👧 ') + b.name);
    }));
  };

  // ============ SỔ CHUNG (F14) ============
  VG.screens.books = function () {
    var c = VG.shell('/me');
    c.appendChild(VG.topbar('Sổ chung gia đình', { back: '/me' }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    VG.loadBooks().then(function () {
      body.textContent = '';
      var list = VG.state.books;
      body.appendChild(h('div', { class: 'card tight' }, list.map(function (b) {
        var on = VG.state.book ? VG.state.book.id === b.id : b.kind === 'personal';
        var sub = b.kind === 'personal' ? 'Chỉ mình bạn' : ROLE_LABEL[b.role] + ' · ' + b.members + ' người';
        return h('a', { href: b.kind === 'personal' ? '#/books' : '#/books/' + b.id, class: 'tx', onclick: b.kind === 'personal' ? function (ev) { ev.preventDefault(); VG.setBook(null); VG.go('/'); } : null },
          h('span', { class: 'cat neutral', 'aria-hidden': 'true' }, b.kind === 'personal' ? '👤' : '👨‍👩‍👧'),
          h('span', { class: 't' }, h('b', null, b.name), h('span', { class: 'lbl' }, sub)),
          on ? h('span', { class: 'tag' }, 'Đang dùng') : h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
      })));
      body.appendChild(h('p', { class: 'muted small' }, 'Sổ chung có ví, danh mục và giao dịch riêng. Mọi người cùng ghi, cùng thấy tổng. Chỉ người ghi hoặc chủ sổ sửa, xoá được từng khoản.'));
      var msg = VG.message();
      var name = h('input', { id: 'bk-name', type: 'text', maxlength: '60', placeholder: 'Sổ gia đình', autocomplete: 'off' });
      var btn = h('button', { type: 'submit', class: 'btn' }, 'Tạo sổ chung');
      var form = h('form', { class: 'card stack', novalidate: true }, h('b', null, 'Tạo sổ chung mới'), VG.field('Tên sổ', name), msg, btn);
      VG.onSubmit(form, btn, msg, function () {
        return VG.api('POST', '/books', { name: name.value || 'Sổ gia đình' }, { personal: true }).then(function (d) {
          VG.state.books = null;
          VG.setBook(d.book);
          VG.toast('Đã tạo sổ. Thêm ví chung rồi mời người nhà.');
          VG.go('/books/' + d.book.id);
        });
      });
      body.appendChild(form);
    }).catch(function (e) { VG.fail(body, e); });
  };

  VG.screens.bookDetail = function (id) {
    id = Number(id);
    var c = VG.shell('/me');
    var book = (VG.state.books || []).filter(function (b) { return b.id === id; })[0];
    c.appendChild(VG.topbar(book ? book.name : 'Sổ chung', { back: '/books' }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    function load() {
      VG.api('GET', '/books/' + id + '/members', null, { personal: true }).then(function (d) { draw(d); }).catch(function (e) { VG.fail(body, e); });
    }
    function draw(d) {
      body.textContent = '';
      var owner = d.role === 'owner';
      var using = VG.state.book && VG.state.book.id === id;
      if (!using) {
        body.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { VG.setBook(book); VG.go('/'); } }, 'Dùng sổ này'));
      }
      body.appendChild(h('div', { class: 'card tight' }, h('b', { class: 'block' }, 'Thành viên'), d.members.map(function (m) {
        var right;
        if (owner && m.role !== 'owner') {
          right = selectEl('role-' + m.id, [['editor', 'Thành viên'], ['viewer', 'Người xem'], ['remove', 'Mời ra khỏi sổ']], m.role);
          right.setAttribute('aria-label', 'Quyền của ' + m.name);
          right.addEventListener('change', function () {
            var v = right.value;
            var p = v === 'remove'
              ? (window.confirm('Mời ' + m.name + ' ra khỏi sổ? Giao dịch họ đã ghi vẫn ở lại.') ? VG.api('DELETE', '/books/' + id + '/members/' + m.id, null, { personal: true }) : null)
              : VG.api('PATCH', '/books/' + id + '/members/' + m.id, { role: v }, { personal: true });
            if (!p) { right.value = m.role; return; }
            p.then(function () { VG.toast('Đã cập nhật'); load(); }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); load(); });
          });
        } else {
          right = h('span', { class: 'tag' }, ROLE_LABEL[m.role]);
        }
        return h('div', { class: 'tx' }, VG.badge('', '#5E6FB8', m.name),
          h('span', { class: 't' }, h('b', null, m.name + (m.me ? ' (bạn)' : '')), m.email ? h('span', { class: 'lbl' }, m.email) : null), right);
      })));

      if (owner) {
        var role = 'editor';
        var msg = VG.message();
        var mail = h('input', { id: 'inv-email', type: 'email', placeholder: 'Không bắt buộc', autocomplete: 'off' });
        var btn = h('button', { type: 'submit', class: 'btn' }, 'Tạo link mời');
        var out = h('div', { class: 'stack-sm' });
        var form = h('form', { class: 'card stack', novalidate: true }, h('b', null, 'Mời người nhà'),
          VG.chips([['editor', 'Thành viên (ghi được)'], ['viewer', 'Người xem']], role, function (v) { role = v; }),
          VG.field('Gửi qua email', mail), msg, btn, out);
        VG.onSubmit(form, btn, msg, function () {
          return VG.api('POST', '/books/' + id + '/invites', { role: role, email: mail.value || undefined }, { personal: true }).then(function (r) {
            out.textContent = '';
            out.appendChild(h('span', { class: 'lbl' }, (r.emailed ? 'Đã gửi email. ' : '') + 'Link dùng 1 lần, hết hạn sau 7 ngày:'));
            out.appendChild(h('code', { class: 'code' }, r.link));
            out.appendChild(h('button', { type: 'button', class: 'btn ghost sm', onclick: function () { copyText(r.link); } }, 'Chép link'));
            if (navigator.share) out.appendChild(h('button', { type: 'button', class: 'btn ghost sm', onclick: function () { navigator.share({ title: 'Ví Gọn', text: 'Vào sổ chung trên Ví Gọn', url: r.link }).catch(function () {}); } }, 'Gửi qua Zalo, Messenger…'));
            mail.value = '';
          });
        });
        body.appendChild(form);
        if (d.invites.length) {
          body.appendChild(h('div', { class: 'card tight' }, h('b', { class: 'block' }, 'Lời mời chưa dùng'), d.invites.map(function (i) {
            return h('div', { class: 'tx' }, h('span', { class: 't' }, h('b', null, i.email || 'Link mời'), h('span', { class: 'lbl' }, ROLE_LABEL[i.role] + ' · hết hạn ' + VG.shortDate(VG.vnDate(i.expires_at)))),
              h('button', { type: 'button', class: 'btn link danger', onclick: function () {
                VG.api('DELETE', '/books/' + id + '/invites/' + i.id, null, { personal: true }).then(load);
              } }, 'Huỷ'));
          })));
        }
        var rename = h('button', { type: 'button', class: 'btn ghost' }, 'Đổi tên sổ');
        rename.addEventListener('click', function () {
          var n = window.prompt('Tên sổ mới', book ? book.name : '');
          if (!n) return;
          VG.api('PATCH', '/books/' + id, { name: n }, { personal: true }).then(function () { VG.state.books = null; VG.loadBooks().then(function () { VG.route(); }); })
            .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        });
        var del = h('button', { type: 'button', class: 'btn link danger' }, 'Xoá sổ chung');
        del.addEventListener('click', function () {
          var pw = window.prompt('Xoá sổ sẽ mất toàn bộ ví, giao dịch của sổ này với mọi người. Nhập mật khẩu để xác nhận:');
          if (!pw) return;
          VG.api('DELETE', '/books/' + id, { password: pw }, { personal: true }).then(function () {
            VG.setBook(null); VG.state.books = null; VG.toast('Đã xoá sổ'); VG.go('/books');
          }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        });
        body.appendChild(h('div', { class: 'split' }, rename, del));
      } else {
        var me = d.members.filter(function (m) { return m.me; })[0];
        var leave = h('button', { type: 'button', class: 'btn link danger' }, 'Rời sổ này');
        leave.addEventListener('click', function () {
          if (!window.confirm('Rời sổ? Giao dịch bạn đã ghi vẫn ở lại sổ, hiện là "Thành viên cũ".')) return;
          VG.api('DELETE', '/books/' + id + '/members/' + me.id, null, { personal: true }).then(function () {
            VG.setBook(null); VG.state.books = null; VG.toast('Đã rời sổ'); VG.go('/books');
          }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        });
        body.appendChild(leave);
      }
    }
    load();
  };

  VG.screens.join = function (token) {
    var c = VG.shell('/me');
    c.appendChild(VG.topbar('Lời mời vào sổ chung'));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    VG.api('GET', '/invites/' + token, null, { personal: true }).then(function (d) {
      body.textContent = '';
      body.appendChild(h('div', { class: 'card stack' },
        h('span', { class: 'big' }, '👨‍👩‍👧'),
        h('b', null, (d.inviter || 'Một người') + ' mời bạn vào sổ "' + d.book_name + '"'),
        h('span', { class: 'muted small' }, 'Quyền: ' + ROLE_LABEL[d.role] + (d.role === 'viewer' ? ' (chỉ xem, không ghi)' : ' (cùng ghi chép)'))));
      if (d.already_member) {
        body.appendChild(h('p', { class: 'muted' }, 'Bạn đã ở trong sổ này.'));
        return;
      }
      var msg = VG.message();
      var btn = h('button', { type: 'submit', class: 'btn' }, 'Vào sổ');
      var form = h('form', { class: 'stack' }, msg, btn);
      VG.onSubmit(form, btn, msg, function () {
        return VG.api('POST', '/invites/' + token + '/accept', {}, { personal: true }).then(function (r) {
          VG.state.books = null;
          return VG.loadBooks().then(function () {
            VG.setBook(VG.state.books.filter(function (b) { return b.id === r.book.id; })[0]);
            VG.toast('Đã vào sổ ' + r.book.name);
            VG.go('/');
          });
        });
      });
      body.appendChild(form);
    }).catch(function (e) { VG.fail(body, e); });
  };

  // ============ CHIA TIỀN NHÓM (F15) ============
  VG.screens.groups = function () {
    var c = VG.shell('/me');
    c.appendChild(VG.topbar('Chia tiền nhóm', { back: '/me', action: h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Tạo nhóm', onclick: newGroup }, '+') }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    VG.api('GET', '/groups').then(function (d) {
      body.textContent = '';
      if (!d.groups.length) {
        body.appendChild(VG.empty('🧮', 'Chưa có nhóm nào', 'Đi chơi, ăn chung? Tạo nhóm, ghi ai trả gì, app tính ai trả ai với ít lần chuyển nhất.',
          h('button', { type: 'button', class: 'btn', onclick: newGroup }, 'Tạo nhóm đầu tiên')));
        return;
      }
      body.appendChild(h('div', { class: 'card tight' }, d.groups.map(function (g) {
        var sub = g.members + ' người · tổng ' + money(g.total);
        var st = g.settled ? h('span', { class: 'chip ok' }, 'Đã xong')
          : g.my_balance > 0 ? h('span', { class: 'amt in' }, 'được nhận ' + money(g.my_balance))
            : g.my_balance < 0 ? h('span', { class: 'amt out' }, 'phải trả ' + money(-g.my_balance))
              : h('span', { class: 'lbl' }, g.open_transfers + ' lần chuyển');
        return h('a', { href: '#/groups/' + g.id, class: 'tx' + (g.archived ? ' dimmed' : '') }, h('span', { class: 'cat neutral', 'aria-hidden': 'true' }, '🧮'),
          h('span', { class: 't' }, h('b', null, g.name), h('span', { class: 'lbl' }, sub)), st);
      })));
    }).catch(function (e) { VG.fail(body, e); });
  };

  function newGroup() {
    var msg = VG.message();
    var name = h('input', { id: 'g-name', type: 'text', maxlength: '60', placeholder: 'Đà Lạt 3N2Đ', autocomplete: 'off' });
    var me = h('input', { id: 'g-me', type: 'text', maxlength: '40', value: (VG.state.user.full_name || 'Tôi').split(' ').pop(), autocomplete: 'off' });
    var others = h('textarea', { id: 'g-others', rows: '3', placeholder: 'Hà, Minh, Tú' });
    var btn = h('button', { type: 'submit', class: 'btn' }, 'Tạo nhóm');
    var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, 'Nhóm mới'),
      VG.field('Tên nhóm / chuyến đi', name), VG.field('Tên của bạn trong nhóm', me),
      VG.field('Những người khác (cách nhau bằng dấu phẩy)', others), msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      var list = others.value.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
      return VG.api('POST', '/groups', { name: name.value, me_name: me.value, members: list }).then(function (d) {
        VG.closeSheet(); VG.go('/groups/' + d.group.id);
      });
    });
    VG.openSheet(form);
  }

  VG.screens.groupDetail = function (id) {
    var c = VG.shell('/me');
    var title = h('h1', { class: 'grow' }, 'Nhóm');
    c.appendChild(h('div', { class: 'topbar' }, h('a', { href: '#/groups', class: 'back', 'aria-label': 'Quay lại' }, '‹'), title,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Thêm khoản chi', onclick: function () { if (cur) expenseForm(cur); } }, '+')));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    var cur = null;
    function call(method, path, data) {
      return VG.api(method, '/groups/' + id + (path || ''), data).then(function (d) { draw(d); return d; });
    }
    function draw(d) {
      cur = d;
      title.textContent = d.group.name;
      body.textContent = '';
      var me = d.members.filter(function (m) { return m.is_me; })[0];
      body.appendChild(h('div', { class: 'card' },
        h('div', { class: 'split' },
          h('div', null, h('span', { class: 'lbl' }, 'Tổng chi'), h('b', { class: 'big block' }, money(d.total))),
          h('div', null, h('span', { class: 'lbl' }, 'Phần của bạn'), h('b', { class: 'block' }, money(d.my_share)),
            me && me.balance ? h('span', { class: 'small ' + (me.balance > 0 ? 'in' : 'out') }, me.balance > 0 ? 'được nhận ' + money(me.balance) : 'phải trả ' + money(-me.balance)) : null))));

      // Tất toán: ai trả ai (kèm VietQR)
      var planCard = h('div', { class: 'card tight' }, h('b', { class: 'block' }, d.plan.length ? 'Cần chuyển ' + d.plan.length + ' lần để xong' : 'Đã tất toán xong 🎉'));
      d.plan.forEach(function (p) {
        var qrBtn = p.qr ? h('button', { type: 'button', class: 'btn ghost sm', onclick: function () { showQr(p); } }, 'VietQR') : null;
        var paid = h('button', { type: 'button', class: 'btn sm', onclick: function () {
          call('POST', '/settlements', { from_member: p.from, to_member: p.to, amount: p.amount }).then(function () { VG.toast('Đã đánh dấu ' + p.from_name + ' trả ' + p.to_name); })
            .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        } }, 'Đã trả');
        planCard.appendChild(h('div', { class: 'plan-row' },
          h('div', { class: 'row-between' }, h('b', null, p.from_name + ' → ' + p.to_name), h('b', { class: 'amt' }, money(p.amount))),
          h('div', { class: 'row-between' }, h('span', { class: 'lbl grow' }, p.qr ? 'Quét VietQR là đúng số tiền' : 'Thêm tài khoản của ' + p.to_name + ' để có VietQR'), qrBtn, paid)));
      });
      body.appendChild(planCard);

      // Từng người: đã trả / phần phải chịu
      body.appendChild(h('div', { class: 'card tight' }, h('div', { class: 'row-between' }, h('b', null, 'Thành viên'),
        h('button', { type: 'button', class: 'btn link sm', onclick: function () { memberForm(null); } }, '+ Thêm người')),
      d.members.map(function (m) {
        return h('button', { type: 'button', class: 'tx', onclick: function () { memberForm(m); } }, VG.badge('', m.is_me ? '#0D6B5E' : '#5E6FB8', m.name),
          h('span', { class: 't' }, h('b', null, m.name + (m.is_me ? ' (bạn)' : '')), h('span', { class: 'lbl' }, 'Đã trả ' + money(m.paid) + ' · phần ' + money(m.owed) + (m.account_no ? ' · 🏦 ' + m.bank_code : ''))),
          h('span', { class: 'amt ' + (m.balance > 0 ? 'in' : m.balance < 0 ? 'out' : '') }, (m.balance > 0 ? '+' : m.balance < 0 ? '−' : '') + money(Math.abs(m.balance))));
      })));

      // Khoản chi
      body.appendChild(h('div', { class: 'card tight' }, h('div', { class: 'row-between' }, h('b', null, 'Khoản chi (' + d.expenses.length + ')'),
        h('button', { type: 'button', class: 'btn link sm', onclick: function () { expenseForm(d); } }, '+ Thêm khoản')),
      d.expenses.length ? d.expenses.map(function (e) {
        var how = { equal: 'chia đều', amount: 'theo số tiền', ratio: 'theo tỉ lệ' }[e.split_mode];
        return h('div', { class: 'tx' }, h('span', { class: 't' }, h('b', null, e.title), h('span', { class: 'lbl' }, e.payer_name + ' trả · ' + how + ' ' + Object.keys(e.split).length + ' người · ' + VG.shortDate(e.occurred_on))),
          h('span', { class: 'amt' }, money(e.amount)),
          h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Xoá khoản ' + e.title, onclick: function () {
            if (window.confirm('Xoá khoản "' + e.title + '"?')) call('DELETE', '/expenses/' + e.id).catch(function (er) { VG.toast(er.message, { kind: 'err' }); });
          } }, '×'));
      }) : h('p', { class: 'muted small' }, 'Chưa có khoản nào. Bấm + để ghi khoản chung đầu tiên.')));

      if (d.settlements.length) {
        body.appendChild(h('div', { class: 'card tight' }, h('b', { class: 'block' }, 'Đã trả nhau'), d.settlements.map(function (s) {
          return h('div', { class: 'tx' }, h('span', { class: 't' }, h('b', null, s.from_name + ' → ' + s.to_name), h('span', { class: 'lbl' }, VG.shortDate(VG.vnDate(s.paid_at)))),
            h('span', { class: 'amt' }, money(s.amount)),
            h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Bỏ đánh dấu', onclick: function () { call('DELETE', '/settlements/' + s.id); } }, '↶'));
        })));
      }
      // Ghi phần của mình vào sổ cá nhân
      if (d.unrecorded > 0) {
        body.appendChild(h('button', { type: 'button', class: 'btn ghost', onclick: recordMine }, 'Ghi phần của tôi (' + money(d.unrecorded) + ' ₫) vào sổ cá nhân'));
      } else if (d.group.recorded_amount) {
        body.appendChild(h('p', { class: 'muted small center-text' }, 'Đã ghi ' + money(d.group.recorded_amount) + ' ₫ phần của bạn vào sổ cá nhân.'));
      }
      var del = h('button', { type: 'button', class: 'btn link danger' }, 'Xoá nhóm');
      del.addEventListener('click', function () {
        if (!window.confirm('Xoá nhóm "' + d.group.name + '"? Giao dịch đã ghi vào sổ cá nhân vẫn giữ.')) return;
        VG.api('DELETE', '/groups/' + id).then(function () { VG.go('/groups'); });
      });
      body.appendChild(del);
    }

    function showQr(p) {
      var img = h('img', { src: p.qr, alt: 'VietQR chuyển ' + money(p.amount) + ' đồng cho ' + p.to_name, class: 'qr-img' });
      VG.openSheet(h('div', { class: 'stack center-text' }, h('h2', null, p.from_name + ' chuyển ' + p.to_name),
        h('span', { class: 'big' }, VG.show(p.amount)), img,
        h('span', { class: 'muted small' }, 'Mở app ngân hàng → Quét QR. Số tiền và nội dung điền sẵn.'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          VG.closeSheet();
          call('POST', '/settlements', { from_member: p.from, to_member: p.to, amount: p.amount }).then(function () { VG.toast('Đã đánh dấu đã trả'); });
        } }, 'Đánh dấu đã trả')));
    }

    function memberForm(m) {
      var msg = VG.message();
      var name = h('input', { id: 'gm-name', type: 'text', maxlength: '40', value: m ? m.name : '', autocomplete: 'off' });
      var bank = h('input', { id: 'gm-bank', type: 'text', maxlength: '20', value: m && m.bank_code ? m.bank_code : '', placeholder: 'VCB, TCB, MB, ACB…', autocomplete: 'off' });
      var acc = h('input', { id: 'gm-acc', type: 'text', inputmode: 'numeric', maxlength: '30', value: m && m.account_no ? m.account_no : '', autocomplete: 'off' });
      var accName = h('input', { id: 'gm-accname', type: 'text', maxlength: '50', value: m && m.account_name ? m.account_name : '', placeholder: 'NGUYEN VAN A', autocomplete: 'off' });
      var btn = h('button', { type: 'submit', class: 'btn' }, m ? 'Lưu' : 'Thêm');
      var rm = m && !m.is_me ? h('button', { type: 'button', class: 'btn link danger', onclick: function () {
        call('DELETE', '/members/' + m.id).then(function () { VG.closeSheet(); }).catch(function (e) { msg.show(e.message); });
      } }, 'Xoá khỏi nhóm') : null;
      var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, m ? m.name : 'Thêm người'),
        VG.field('Tên', name),
        h('span', { class: 'lbl' }, 'Tài khoản nhận tiền (để tạo VietQR, không bắt buộc)'),
        VG.field('Ngân hàng', bank), VG.field('Số tài khoản', acc), VG.field('Tên chủ tài khoản', accName), msg, btn, rm);
      VG.onSubmit(form, btn, msg, function () {
        var data = { name: name.value, bank_code: bank.value, account_no: acc.value, account_name: accName.value };
        return call(m ? 'PATCH' : 'POST', '/members' + (m ? '/' + m.id : ''), data).then(function () { VG.closeSheet(); });
      });
      VG.openSheet(form);
    }

    function expenseForm(d) {
      var msg = VG.message();
      var mode = 'equal';
      var me = d.members.filter(function (m) { return m.is_me; })[0];
      var title = h('input', { id: 'ge-title', type: 'text', maxlength: '80', placeholder: 'Khách sạn, ăn tối…', autocomplete: 'off' });
      var amount = VG.moneyInput({ id: 'ge-amount', placeholder: '0' });
      var payer = selectEl('ge-payer', d.members.map(function (m) { return [m.id, m.name]; }), me ? me.id : d.members[0].id);
      var rows = d.members.map(function (m) {
        var check = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Chia cho ' + m.name });
        check.checked = true;
        var val = h('input', { type: 'text', inputmode: 'numeric', class: 'money hidden', 'aria-label': 'Phần của ' + m.name, autocomplete: 'off' });
        val.addEventListener('input', function () {
          if (mode === 'amount') { var dd = val.value.replace(/[^\d]/g, '').slice(0, 12); val.value = dd ? VG.group(dd) : ''; }
          else val.value = val.value.replace(/[^\d]/g, '').slice(0, 4);
          sync();
        });
        check.addEventListener('change', sync);
        return { m: m, check: check, val: val, el: h('label', { class: 'toggle-row' }, h('span', { class: 'grow' }, m.name), val, check) };
      });
      var hint = h('span', { class: 'muted small' });
      function sync() {
        rows.forEach(function (r) {
          r.val.className = mode === 'equal' || !r.check.checked ? 'money hidden' : 'money';
          if (mode === 'ratio' && !r.val.value) r.val.value = '1';
        });
        var total = VG.parseAmount(amount.value) || 0;
        var on = rows.filter(function (r) { return r.check.checked; });
        if (mode === 'equal') hint.textContent = on.length ? 'Mỗi người khoảng ' + money(Math.floor(total / on.length / 1000) * 1000) + ' ₫ (làm tròn 1.000, dư dồn cho người trả)' : 'Chọn ít nhất 1 người';
        else if (mode === 'amount') {
          var s = on.reduce(function (a, r) { return a + (VG.parseAmount(r.val.value) || 0); }, 0);
          hint.textContent = s === total ? 'Khớp tổng ✓' : 'Đã chia ' + money(s) + ' / ' + money(total) + ' ₫';
        } else hint.textContent = 'Ví dụ 2 : 1 : 1 — người có số lớn chịu nhiều hơn';
      }
      amount.addEventListener('input', sync);
      var modeSeg = VG.seg([['equal', 'Chia đều'], ['amount', 'Theo số tiền'], ['ratio', 'Theo tỉ lệ']], mode, function (v) {
        mode = v;
        rows.forEach(function (r) { r.val.value = ''; });
        sync();
      });
      var date = dateInput('ge-date', VG.today(), { max: VG.today() });
      var btn = h('button', { type: 'submit', class: 'btn' }, 'Lưu khoản chi');
      var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, 'Khoản chi chung'),
        VG.field('Nội dung', title), h('div', { class: 'field big-field' }, h('label', { for: 'ge-amount' }, 'Số tiền'), amount),
        VG.field('Ai trả', payer), modeSeg, h('div', { class: 'stack-sm' }, rows.map(function (r) { return r.el; })), hint,
        VG.field('Ngày', date), msg, btn);
      sync();
      VG.onSubmit(form, btn, msg, function () {
        var shares = rows.filter(function (r) { return r.check.checked; }).map(function (r) {
          return { member_id: r.m.id, value: mode === 'amount' ? (VG.parseAmount(r.val.value) || 0) : mode === 'ratio' ? Number(r.val.value || 0) : 1 };
        });
        return call('POST', '/expenses', { title: title.value, amount: VG.parseAmount(amount.value), paid_by: Number(payer.value), split_mode: mode, shares: shares, date: date.value })
          .then(function () { VG.closeSheet(); VG.toast('Đã ghi khoản chi'); });
      });
      VG.openSheet(form);
    }

    function recordMine() {
      Promise.all([VG.api('GET', '/wallets', null, { personal: true }), VG.api('GET', '/categories', null, { personal: true })]).then(function (r) {
        var wallets = r[0].wallets.filter(function (w) { return !w.archived; });
        if (!wallets.length) return VG.toast('Sổ cá nhân chưa có ví', { kind: 'err' });
        var cats = r[1].categories.filter(function (x) { return x.kind === 'expense' && !x.archived; });
        var msg = VG.message();
        var ws = selectEl('gr-wallet', wallets.map(function (w) { return [w.id, w.name + ' · ' + VG.fmt(w.balance)]; }), wallets[0].id);
        var def = cats.filter(function (x) { return x.name === 'Giải trí'; })[0];
        var cs = selectEl('gr-cat', [['', '— Chưa phân loại —']].concat(cats.map(function (x) { return [x.id, (x.parent_id ? '— ' : '') + x.name]; })), def ? def.id : '');
        var btn = h('button', { type: 'submit', class: 'btn' }, 'Ghi ' + money(cur.unrecorded) + ' ₫');
        var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, 'Ghi phần của tôi'),
          h('p', { class: 'muted small' }, 'Ghi 1 khoản chi "Chia tiền: ' + cur.group.name + '" vào Sổ của tôi.'),
          VG.field('Trừ vào ví', ws), VG.field('Danh mục', cs), msg, btn);
        VG.onSubmit(form, btn, msg, function () {
          return VG.api('POST', '/groups/' + id + '/record', { wallet_id: Number(ws.value), category_id: cs.value ? Number(cs.value) : null }).then(function (d) {
            VG.closeSheet(); draw(d); VG.toast('Đã ghi ' + money(d.amount) + ' ₫ vào sổ cá nhân');
          });
        });
        VG.openSheet(form);
      }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
    }

    VG.api('GET', '/groups/' + id).then(draw).catch(function (e) { VG.fail(body, e); });
  };

  // ============ SỔ NỢ (F16) ============
  var debtTab = 'lend';
  function dueChip(d) {
    if (d.closed) return h('span', { class: 'chip ok' }, 'Đã xong');
    if (d.overdue_days) return h('span', { class: 'chip bad' }, 'Quá hạn ' + d.overdue_days + ' ngày');
    if (d.due_date) return h('span', { class: 'chip' + (d.days_left <= 3 ? ' warn' : '') }, 'Hạn ' + VG.shortDate(d.due_date));
    return h('span', { class: 'chip' }, 'Không hạn');
  }

  VG.screens.debts = function () {
    var c = VG.shell('/me');
    var addBtn = VG.canWrite() ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ghi khoản nợ', onclick: function () { debtForm(); } }, '+') : null;
    c.appendChild(VG.topbar('Sổ nợ', { back: '/me', action: addBtn }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    var data = null;
    function load() { VG.api('GET', '/debts').then(function (d) { data = d; draw(); }).catch(function (e) { VG.fail(body, e); }); }
    function draw() {
      body.textContent = '';
      body.appendChild(h('div', { class: 'card' }, h('div', { class: 'split' },
        h('div', null, h('span', { class: 'lbl' }, 'Người ta nợ mình'), h('b', { class: 'big in block' }, money(data.totals.lent))),
        h('div', null, h('span', { class: 'lbl' }, 'Mình nợ'), h('b', { class: 'big out block' }, money(data.totals.borrowed)))),
        h('span', { class: 'muted small' }, 'Cho mượn làm giảm ví nhưng không tính là chi; nhận lại không tính là thu.')));
      body.appendChild(VG.seg([['lend', 'Cho mượn'], ['borrow', 'Đi vay']], debtTab, function (v) { debtTab = v; draw(); }));
      var list = data.debts.filter(function (d) { return d.direction === debtTab; });
      if (!list.length) {
        body.appendChild(VG.empty('🤝', debtTab === 'lend' ? 'Chưa cho ai mượn' : 'Chưa vay ai', 'Bấm + để ghi. Có hạn trả thì Ví Gọn email nhắc trước 3 ngày.'));
        return;
      }
      body.appendChild(h('div', { class: 'card tight' }, list.map(function (d) {
        return h('button', { type: 'button', class: 'tx debt-row' + (d.closed ? ' dimmed' : ''), onclick: function () { debtDetail(d); } },
          VG.badge('', d.direction === 'lend' ? '#1C7C45' : '#B6452A', d.person),
          h('span', { class: 't' }, h('b', null, d.person),
            h('span', { class: 'lbl' }, d.closed ? 'Đã trả đủ ' + money(d.amount) : 'Còn ' + money(d.remaining) + (d.note ? ' · ' + d.note : '')),
            bar(d.progress, d.overdue_days ? 'b' : '')),
          dueChip(d));
      })));
    }

    function walletOptions() {
      return VG.api('GET', '/wallets').then(function (r) {
        return [['', '— Không ghi vào ví —']].concat(r.wallets.filter(function (w) { return !w.archived; }).map(function (w) { return [w.id, w.name + ' · ' + VG.fmt(w.balance)]; }));
      });
    }

    function debtForm() {
      walletOptions().then(function (wopts) {
        var dir = debtTab;
        var msg = VG.message();
        var person = h('input', { id: 'd-person', type: 'text', maxlength: '60', placeholder: 'Nam', autocomplete: 'off' });
        var amount = VG.moneyInput({ id: 'd-amount', placeholder: '0' });
        var date = dateInput('d-date', VG.today(), { max: VG.today() });
        var due = dateInput('d-due', '');
        var note = h('input', { id: 'd-note', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Không bắt buộc' });
        var wallet = selectEl('d-wallet', wopts, wopts[1] ? wopts[1][0] : '');
        var walletLbl = h('label', { for: 'd-wallet' });
        function sync() { walletLbl.textContent = dir === 'lend' ? 'Lấy tiền từ ví' : 'Tiền vay vào ví'; }
        sync();
        var btn = h('button', { type: 'submit', class: 'btn' }, 'Lưu');
        var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, 'Ghi khoản nợ'),
          VG.seg([['lend', 'Cho mượn'], ['borrow', 'Đi vay']], dir, function (v) { dir = v; sync(); }),
          VG.field(dir === 'lend' ? 'Ai mượn' : 'Vay ai', person),
          h('div', { class: 'field big-field' }, h('label', { for: 'd-amount' }, 'Số tiền'), amount),
          h('div', { class: 'split' }, VG.field('Ngày', date), VG.field('Hạn trả', due)),
          h('div', { class: 'field' }, walletLbl, wallet),
          VG.field('Ghi chú', note), msg, btn);
        VG.onSubmit(form, btn, msg, function () {
          return VG.api('POST', '/debts', {
            direction: dir, person: person.value, amount: VG.parseAmount(amount.value), date: date.value,
            due_date: due.value || null, note: note.value, wallet_id: wallet.value ? Number(wallet.value) : null
          }).then(function () { debtTab = dir; VG.closeSheet(); VG.toast('Đã ghi'); load(); });
        });
        VG.openSheet(form);
      }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
    }

    function debtDetail(d) {
      var write = VG.canWrite();
      var box = h('div', { class: 'stack' },
        h('h2', null, (d.direction === 'lend' ? 'Cho ' + d.person + ' mượn' : 'Vay ' + d.person)),
        h('div', { class: 'split' },
          h('div', null, h('span', { class: 'lbl' }, 'Còn lại'), h('b', { class: 'big block' }, money(d.remaining))),
          h('div', null, h('span', { class: 'lbl' }, 'Đã trả'), h('b', { class: 'block' }, money(d.paid) + ' / ' + money(d.amount)))),
        bar(d.progress, d.overdue_days ? 'b' : ''),
        h('div', { class: 'chips' }, dueChip(d), h('span', { class: 'chip' }, 'Từ ' + VG.shortDate(d.start_date))),
        d.note ? h('p', { class: 'muted small' }, d.note) : null);
      if (d.payments.length) {
        box.appendChild(h('div', { class: 'stack-sm' }, h('span', { class: 'lbl' }, 'Các lần trả'), d.payments.map(function (p) {
          return h('div', { class: 'tx' }, h('span', { class: 't' }, h('b', null, VG.shortDate(p.paid_on))), h('span', { class: 'amt' }, money(p.amount)),
            write ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Xoá lần trả', onclick: function () {
              VG.api('DELETE', '/debts/' + d.id + '/payments/' + p.id).then(function () { VG.closeSheet(); load(); });
            } }, '×') : null);
        })));
      }
      if (write && !d.closed) {
        walletOptions().then(function (wopts) {
          var msg = VG.message();
          var amount = VG.moneyInput({ id: 'dp-amount', value: d.remaining });
          var date = dateInput('dp-date', VG.today(), { max: VG.today(), min: d.start_date });
          var wallet = selectEl('dp-wallet', wopts, d.wallet_id || '');
          var btn = h('button', { type: 'submit', class: 'btn' }, d.direction === 'lend' ? 'Ghi ' + d.person + ' trả' : 'Ghi mình trả');
          var form = h('form', { class: 'stack card', novalidate: true }, h('b', null, 'Trả (một phần hoặc hết)'),
            h('div', { class: 'field big-field' }, h('label', { for: 'dp-amount' }, 'Số tiền'), amount),
            h('div', { class: 'split' }, VG.field('Ngày', date), VG.field(d.direction === 'lend' ? 'Vào ví' : 'Từ ví', wallet)), msg, btn);
          VG.onSubmit(form, btn, msg, function () {
            return VG.api('POST', '/debts/' + d.id + '/payments', { amount: VG.parseAmount(amount.value), date: date.value, wallet_id: wallet.value ? Number(wallet.value) : null })
              .then(function (r) { VG.closeSheet(); VG.toast(r.debt.closed ? 'Đã trả hết 🎉' : 'Còn lại ' + money(r.debt.remaining) + ' ₫'); load(); });
          });
          box.appendChild(form);
          addDelete();
        });
      } else addDelete();
      function addDelete() {
        if (!write) return;
        box.appendChild(h('button', { type: 'button', class: 'btn link danger', onclick: function () {
          if (!window.confirm('Xoá khoản nợ này? Các giao dịch ví đã ghi cũng bị xoá.')) return;
          VG.api('DELETE', '/debts/' + d.id).then(function () { VG.closeSheet(); VG.toast('Đã xoá'); load(); });
        } }, 'Xoá khoản nợ'));
      }
      VG.openSheet(box);
    }
    load();
  };
})(window.VG);
