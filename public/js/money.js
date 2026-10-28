// Màn hình chính: khung có thanh tab, Tổng quan, Sổ, Tôi, Ví (F05), Danh mục (F06), làm quen (F01)
(function (VG) {
  'use strict';
  var h = VG.h;

  var WALLET_TYPES = [['cash', 'Tiền mặt'], ['bank', 'Ngân hàng'], ['ewallet', 'Ví điện tử'], ['credit', 'Thẻ tín dụng'], ['savings', 'Tiết kiệm']];
  var TYPE_ICON = { cash: '💵', bank: '🏦', ewallet: '📱', credit: '💳', savings: '🐷' };
  var TYPE_LABEL = {};
  WALLET_TYPES.forEach(function (t) { TYPE_LABEL[t[0]] = t[1]; });

  function loading() { return h('p', { class: 'muted center-text' }, 'Đang tải…'); }
  function fail(box, e) { box.textContent = ''; box.appendChild(h('div', { class: 'msg err' }, e.message)); }

  // ============ KHUNG CÓ THANH TAB ============
  var TABS = [['/', 'Tổng quan', 'home'], ['/ledger', 'Sổ', 'book'], [null, '', 'add'], ['/plan', 'Kế hoạch', 'plan'], ['/me', 'Tôi', 'me']];
  function shell(active) {
    var content = h('main', { class: 'screen with-tabs' });
    var nav = h('nav', { class: 'tabs', 'aria-label': 'Điều hướng' }, TABS.map(function (t) {
      if (!t[0]) {
        return h('button', { type: 'button', class: 'tab fab', 'aria-label': 'Thêm giao dịch', onclick: function () { VG.quickAdd(); } }, h('b', null, '+'));
      }
      return h('a', { href: '#' + t[0], class: 'tab ' + t[2] + (t[0] === active ? ' on' : ''), 'aria-current': t[0] === active ? 'page' : null }, h('i', { 'aria-hidden': 'true' }), t[1]);
    }));
    VG.render(content, nav);
    return content;
  }

  // ============ DANH SÁCH GIAO DỊCH ============
  function txTitle(t) {
    if (t.transfer_group) {
      return t.kind === 'expense' ? 'Chuyển đến ' + (t.counterpart_wallet_name || 'ví khác') : 'Nhận từ ' + (t.counterpart_wallet_name || 'ví khác');
    }
    if (t.source === 'adjust') return 'Điều chỉnh số dư';
    return t.category_name || 'Chưa phân loại';
  }
  function txRow(t) {
    var neutral = !!t.transfer_group;
    var sub = [t.note && t.source !== 'adjust' ? t.note : null, t.wallet_name].filter(Boolean).join(' · ');
    return h('button', { type: 'button', class: 'tx', onclick: function () { VG.quickAdd({ tx: t }); } },
      neutral ? h('span', { class: 'cat', bg: 'var(--c5)', 'aria-hidden': 'true' }, '⇄') : VG.badge(t.category_icon, t.category_color, txTitle(t)),
      h('span', { class: 't' }, h('b', null, txTitle(t)), h('span', { class: 'lbl' }, sub)),
      h('span', { class: 'amt ' + (neutral ? '' : t.kind === 'income' ? 'in' : 'out') }, (t.kind === 'income' ? '+' : '−') + VG.fmt(t.amount, { symbol: false })));
  }
  // Nhóm theo ngày (giờ VN), mỗi ngày có tổng thu/chi (không tính chuyển tiền)
  function txGroups(list, into) {
    var lastDay = null, dayBox = null, sums = null;
    list.forEach(function (t) {
      var d = VG.vnDate(t.occurred_at);
      if (d !== lastDay) {
        lastDay = d;
        sums = h('span', { class: 'lbl' });
        sums.inc = 0; sums.exp = 0;
        dayBox = h('div', { class: 'card tight' });
        into.appendChild(h('div', { class: 'day' }, h('span', null, VG.dayLabel(d)), sums));
        into.appendChild(dayBox);
      }
      if (!t.transfer_group && t.source !== 'adjust') {
        if (t.kind === 'income') sums.inc += t.amount; else sums.exp += t.amount;
        sums.textContent = [sums.inc ? '+' + VG.fmt(sums.inc, { symbol: false }) : null, sums.exp ? '−' + VG.fmt(sums.exp, { symbol: false }) : null].filter(Boolean).join('  ');
      }
      dayBox.appendChild(txRow(t));
    });
  }

  // ============ TỔNG QUAN (bản gọn; đầy đủ ở Bước 4) ============
  VG.screens.home = function () {
    var u = VG.state.user;
    var c = shell('/');
    var hero = h('div', { class: 'card hero' }, h('span', { class: 'lbl' }, 'Tổng số dư'), h('span', { class: 'big' }, '…'));
    var recent = h('div', { class: 'stack' }, loading());
    var verifyBox = null;
    if (!u.email_verified) {
      var resend = h('button', { type: 'button', class: 'btn link' }, 'Gửi lại');
      verifyBox = h('div', { class: 'msg warn' }, h('span', null, 'Kiểm tra hộp thư để xác minh email.'), resend);
      resend.addEventListener('click', function () {
        resend.disabled = true;
        VG.api('POST', '/auth/resend-verify')
          .then(function () { verifyBox.className = 'msg ok'; verifyBox.textContent = 'Đã gửi lại email xác minh.'; })
          .catch(function (e) { verifyBox.className = 'msg err'; verifyBox.textContent = e.message; });
      });
    }
    c.appendChild(h('div', { class: 'topbar' }, h('div', { class: 'grow' }, h('span', { class: 'lbl' }, 'Xin chào'), h('h1', null, u.full_name || 'bạn'))));
    if (!u.onboarded) {
      c.appendChild(h('div', { class: 'card' }, h('b', null, 'Hoàn tất làm quen'),
        h('p', { class: 'muted small' }, 'Tạo ví đầu tiên để bắt đầu ghi thu chi.'),
        h('a', { href: '#/onboarding', class: 'btn' }, 'Tiếp tục')));
    }
    c.appendChild(h('a', { href: '#/wallets', class: 'plain' }, hero));
    if (verifyBox) c.appendChild(verifyBox);
    c.appendChild(h('div', { class: 'row-between' }, h('b', null, 'Gần đây'), h('a', { href: '#/ledger', class: 'small' }, 'Xem tất cả')));
    c.appendChild(recent);

    VG.api('GET', '/wallets').then(function (d) {
      hero.lastChild.textContent = VG.fmt(d.total);
      hero.appendChild(h('span', { class: 'lbl' }, d.wallets.length + ' ví'));
    }).catch(function () { hero.lastChild.textContent = '—'; });
    VG.api('GET', '/transactions?limit=5').then(function (d) {
      recent.textContent = '';
      if (!d.transactions.length) {
        recent.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Chưa có giao dịch. Bấm nút + để ghi khoản đầu tiên.')));
        return;
      }
      txGroups(d.transactions, recent);
    }).catch(function (e) { fail(recent, e); });
  };

  // ============ SỔ (danh sách đầy đủ; tìm và lọc ở Bước 4) ============
  VG.screens.ledger = function () {
    var c = shell('/ledger');
    c.appendChild(VG.topbar('Sổ giao dịch'));
    var list = h('div', { class: 'stack' }, loading());
    var more = h('button', { type: 'button', class: 'btn ghost hidden' }, 'Tải thêm');
    c.appendChild(list);
    c.appendChild(more);
    var cursor = null, all = [];
    function load() {
      more.disabled = true;
      VG.api('GET', '/transactions' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        all = all.concat(d.transactions);
        cursor = d.next_cursor;
        list.textContent = '';
        if (!all.length) list.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Chưa có giao dịch nào.')));
        else txGroups(all, list);
        more.className = 'btn ghost' + (cursor ? '' : ' hidden');
        more.disabled = false;
      }).catch(function (e) { fail(list, e); });
    }
    more.addEventListener('click', load);
    load();
  };

  VG.screens.plan = function () {
    var c = shell('/plan');
    c.appendChild(VG.topbar('Kế hoạch'));
    c.appendChild(h('div', { class: 'card empty' }, h('b', null, 'Ngân sách · Mục tiêu · Định kỳ'),
      h('p', { class: 'muted small' }, 'Phần này có ở giai đoạn 2, sau khi xong bản dùng thử.')));
  };

  // ============ TÔI ============
  VG.screens.me = function () {
    var u = VG.state.user;
    var c = shell('/me');
    c.appendChild(VG.topbar('Tôi'));
    c.appendChild(h('div', { class: 'card' }, h('b', null, u.full_name || 'Chưa đặt tên'), h('span', { class: 'muted small' }, u.email)));
    function item(href, icon, label, sub) {
      return h('a', { href: href, class: 'menu-item' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'grow' }, h('span', null, label), sub ? h('span', { class: 'muted small block' }, sub) : null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    }
    c.appendChild(h('div', { class: 'card tight' },
      item('#/wallets', '👛', 'Ví', 'Thêm, sửa, ẩn ví; chuyển tiền'),
      item('#/categories', '🏷️', 'Danh mục', 'Sửa, sắp xếp, gộp danh mục')));
    var out = h('button', { type: 'button', class: 'btn ghost' }, 'Đăng xuất');
    out.addEventListener('click', function () {
      VG.api('POST', '/auth/logout').catch(function () {}).then(function () { VG.signOut(); VG.go('/login'); });
    });
    c.appendChild(h('div', { class: 'bottom' }, out));
  };

  // ============ VÍ (F05) ============
  function walletRow(w) {
    var sub = TYPE_LABEL[w.type] + (w.type === 'credit' && w.due_day ? ' · hạn ngày ' + w.due_day : '') +
      (w.exclude_from_total ? ' · ngoài tổng' : '');
    return h('a', { href: '#/wallets/' + w.id, class: 'tx' }, VG.badge(TYPE_ICON[w.type], w.color, w.name),
      h('span', { class: 't' }, h('b', null, w.name), h('span', { class: 'lbl' }, sub)),
      h('span', { class: 'amt' + (w.balance < 0 ? ' out' : '') }, VG.fmt(w.balance, { symbol: false })));
  }

  VG.screens.wallets = function () {
    var c = shell('/me');
    var showArchived = VG.queryParam('archived') === '1';
    c.appendChild(VG.topbar('Ví của tôi', { back: '/me', action: h('a', { href: '#/wallets/new', class: 'icon-btn', 'aria-label': 'Thêm ví' }, '+') }));
    var body = h('div', { class: 'stack' }, loading());
    c.appendChild(body);
    VG.api('GET', '/wallets?include_archived=1').then(function (d) {
      body.textContent = '';
      var active = d.wallets.filter(function (w) { return !w.archived; });
      var archived = d.wallets.filter(function (w) { return w.archived; });
      body.appendChild(h('div', { class: 'card' }, h('span', { class: 'lbl' }, 'Tổng tài sản ròng'), h('span', { class: 'big' }, VG.fmt(d.total))));
      if (!active.length) body.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Chưa có ví. Thêm ví đầu tiên để bắt đầu.')));
      else body.appendChild(h('div', { class: 'card tight' }, active.map(walletRow)));
      if (archived.length) {
        body.appendChild(h('a', { href: showArchived ? '#/wallets' : '#/wallets?archived=1', class: 'small center-text' },
          showArchived ? 'Ẩn danh sách ví đã ẩn' : 'Xem ' + archived.length + ' ví đã ẩn'));
        if (showArchived) body.appendChild(h('div', { class: 'card tight dimmed' }, archived.map(walletRow)));
      }
      body.appendChild(h('div', { class: 'split' },
        h('button', { type: 'button', class: 'btn ghost', onclick: function () { VG.quickAdd({ mode: 'transfer' }); } }, 'Chuyển tiền'),
        h('a', { href: '#/wallets/new', class: 'btn' }, 'Thêm ví')));
    }).catch(function (e) { fail(body, e); });
  };

  // Form ví dùng chung cho tạo mới, sửa và bước 2 làm quen
  function walletForm(w, onSaved, opts) {
    opts = opts || {};
    var isNew = !w;
    var type = w ? w.type : 'cash';
    var msg = VG.message();
    var name = h('input', { id: 'w-name', type: 'text', maxlength: '60', value: w ? w.name : 'Tiền mặt', autocomplete: 'off' });
    var nameTouched = !isNew;
    name.addEventListener('input', function () { nameTouched = true; });
    var opening = VG.moneyInput({ id: 'w-open', value: w ? w.opening_balance : null, placeholder: '0' });
    var openingLabel = h('label', { for: 'w-open' });
    var limit = VG.moneyInput({ id: 'w-limit', value: w && w.credit_limit !== null ? w.credit_limit : null, placeholder: 'Không bắt buộc' });
    var due = h('input', { id: 'w-due', type: 'number', min: '1', max: '31', inputmode: 'numeric', value: w && w.due_day ? String(w.due_day) : '', placeholder: '1–31' });
    var creditBox = h('div', { class: 'stack' }, VG.field('Hạn mức', limit), VG.field('Ngày đến hạn thanh toán hằng tháng', due));
    var color = VG.colorPicker(w ? w.color : VG.COLORS[0]);
    var exclude = VG.toggle('Không tính vào tổng số dư', w && w.exclude_from_total, 'Ví dụ quỹ giữ hộ, tiền của người khác');
    var typeChips = VG.chips(WALLET_TYPES, type, function (t) {
      if (!nameTouched) name.value = TYPE_LABEL[t];
      type = t;
      sync();
    });
    function sync() {
      openingLabel.textContent = type === 'credit' ? 'Dư nợ hiện tại' : 'Số dư hiện tại';
      creditBox.className = type === 'credit' ? 'stack' : 'hidden';
    }
    sync();
    var btn = h('button', { type: 'submit', class: 'btn' }, opts.submitLabel || (isNew ? 'Tạo ví' : 'Lưu'));
    var form = h('form', { class: 'stack', novalidate: true },
      typeChips,
      VG.field('Tên ví', name),
      isNew ? h('div', { class: 'field big-field' }, openingLabel, opening) : null,
      creditBox,
      opts.compact ? null : h('div', { class: 'stack-sm' }, h('span', { class: 'lbl' }, 'Màu'), color),
      opts.compact ? null : exclude,
      msg, btn);
    VG.onSubmit(form, btn, msg, function () {
      var body = { name: name.value, type: type };
      if (!opts.compact) { body.color = color.value; body.exclude_from_total = exclude.input.checked; }
      if (isNew) {
        var ob = VG.parseAmount(opening.value) || 0;
        body.opening_balance = type === 'credit' ? -ob : ob;
      }
      if (type === 'credit') {
        body.credit_limit = VG.parseAmount(limit.value);
        body.due_day = due.value ? Number(due.value) : null;
      }
      return VG.api(isNew ? 'POST' : 'PATCH', isNew ? '/wallets' : '/wallets/' + w.id, body).then(function (d) { onSaved(d.wallet); });
    });
    return form;
  }

  VG.screens.walletNew = function () {
    var c = shell('/me');
    c.appendChild(VG.topbar('Thêm ví', { back: '/wallets' }));
    c.appendChild(walletForm(null, function (w) { VG.toast('Đã tạo ví ' + w.name); VG.go('/wallets'); }));
  };

  VG.screens.walletEdit = function (id) {
    var c = shell('/me');
    c.appendChild(VG.topbar('Ví', { back: '/wallets' }));
    var body = h('div', { class: 'stack' }, loading());
    c.appendChild(body);
    VG.api('GET', '/wallets?include_archived=1').then(function (d) {
      var w = d.wallets.filter(function (x) { return x.id === Number(id); })[0];
      body.textContent = '';
      if (!w) return body.appendChild(h('div', { class: 'msg err' }, 'Không tìm thấy ví.'));
      body.appendChild(h('div', { class: 'card' }, h('span', { class: 'lbl' }, w.type === 'credit' ? 'Số dư (âm là dư nợ)' : 'Số dư hiện tại'),
        h('span', { class: 'big' + (w.balance < 0 ? ' out' : '') }, VG.fmt(w.balance)),
        w.type === 'credit' && w.credit_limit ? h('span', { class: 'lbl' }, 'Hạn mức ' + VG.fmt(w.credit_limit) + ' · còn dùng được ' + VG.fmt(w.credit_limit + w.balance)) : null));

      // Điều chỉnh số dư: nhập số thật, app ghi khoản "Điều chỉnh" bằng phần chênh
      var actual = VG.moneyInput({ id: 'w-actual', placeholder: VG.fmt(Math.abs(w.balance), { symbol: false }) });
      var aMsg = VG.message();
      var aBtn = h('button', { type: 'submit', class: 'btn ghost' }, 'Điều chỉnh');
      var aForm = h('form', { class: 'stack', novalidate: true },
        VG.field(w.type === 'credit' ? 'Dư nợ thực tế' : 'Số dư thực tế', actual), aMsg, aBtn);
      VG.onSubmit(aForm, aBtn, aMsg, function () {
        var v = VG.parseAmount(actual.value);
        if (v === null) throw new Error('Nhập số dư thực tế');
        return VG.api('POST', '/wallets/' + w.id + '/adjust', { actual_balance: w.type === 'credit' ? -v : v }).then(function (r) {
          VG.toast(r.adjustment ? 'Đã điều chỉnh ' + (r.adjustment.kind === 'income' ? '+' : '−') + VG.fmt(r.adjustment.amount) : 'Số dư đã khớp, không cần điều chỉnh');
          VG.route();
        });
      });

      var archiveBtn = h('button', { type: 'button', class: 'btn ghost' }, w.archived ? 'Hiện lại ví' : 'Ẩn ví');
      archiveBtn.addEventListener('click', function () {
        VG.api('POST', '/wallets/' + w.id + '/archive', { archived: !w.archived }).then(function () {
          VG.toast(w.archived ? 'Đã hiện lại ví' : 'Đã ẩn ví. Xem lại trong danh sách ví đã ẩn.');
          VG.go('/wallets');
        }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
      });
      var delBtn = !w.has_transactions ? h('button', { type: 'button', class: 'btn link danger' }, 'Xoá ví') : null;
      if (delBtn) {
        delBtn.addEventListener('click', function () {
          VG.api('DELETE', '/wallets/' + w.id).then(function () { VG.toast('Đã xoá ví'); VG.go('/wallets'); })
            .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        });
      }

      body.appendChild(h('details', { class: 'card' }, h('summary', null, 'Điều chỉnh số dư'),
        h('p', { class: 'muted small' }, 'Nhập số dư thật đang có, Ví Gọn ghi một khoản "Điều chỉnh" bằng phần chênh lệch.'), aForm));
      body.appendChild(h('div', { class: 'card' }, h('b', null, 'Thông tin ví'), walletForm(w, function () { VG.toast('Đã lưu'); VG.route(); })));
      body.appendChild(h('div', { class: 'stack' }, archiveBtn, delBtn,
        w.has_transactions ? h('p', { class: 'muted small center-text' }, 'Ví đã có giao dịch nên chỉ ẩn được, không xoá.') : null));
    }).catch(function (e) { fail(body, e); });
  };

  // ============ DANH MỤC (F06) ============
  var catKind = 'expense';
  VG.screens.categories = function () {
    var c = shell('/me');
    c.appendChild(VG.topbar('Danh mục', { back: '/me', action: h('a', { href: '#/categories/new?kind=' + catKind, class: 'icon-btn', 'aria-label': 'Thêm danh mục' }, '+') }));
    var segBox = h('div');
    var body = h('div', { class: 'stack' }, loading());
    c.appendChild(segBox);
    c.appendChild(body);
    VG.api('GET', '/categories').then(function (d) {
      function draw() {
        var list = d.categories.filter(function (x) { return x.kind === catKind; });
        var parents = list.filter(function (x) { return !x.parent_id; });
        var count = function (k) { return d.categories.filter(function (x) { return x.kind === k && !x.parent_id; }).length; };
        segBox.textContent = '';
        segBox.appendChild(VG.seg([['expense', 'Chi · ' + count('expense')], ['income', 'Thu · ' + count('income')]], catKind, function (k) {
          catKind = k; c.querySelector('.icon-btn').setAttribute('href', '#/categories/new?kind=' + k); draw();
        }));
        body.textContent = '';
        var card = h('div', { class: 'card tight sortable' });
        parents.forEach(function (p) {
          var kids = list.filter(function (x) { return x.parent_id === p.id; }).map(function (x) { return x.name; });
          var handle = h('span', { class: 'handle', 'aria-label': 'Kéo để sắp xếp', role: 'button', tabindex: '0' }, '⋮⋮');
          var row = h('div', { class: 'tx sort-row', 'data-id': String(p.id) },
            VG.badge(p.icon, p.color, p.name),
            h('a', { href: '#/categories/' + p.id, class: 't plain' }, h('b', null, p.name), h('span', { class: 'lbl' }, kids.length ? kids.join(' · ') : 'Không có mục con')),
            handle);
          makeDraggable(card, row, handle);
          card.appendChild(row);
        });
        body.appendChild(card);
        body.appendChild(h('p', { class: 'lbl center-text' }, 'Giữ ⋮⋮ và kéo để sắp xếp. Bấm vào danh mục để sửa, gộp, xoá.'));
      }
      draw();
    }).catch(function (e) { fail(body, e); });
  };

  // Kéo thả bằng pointer events (chạy cả cảm ứng lẫn chuột); thả tay thì lưu thứ tự mới
  function makeDraggable(list, row, handle) {
    handle.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      row.classList.add('dragging');
      function move(e) {
        var rows = Array.prototype.slice.call(list.children);
        var target = rows.filter(function (r) {
          var b = r.getBoundingClientRect();
          return r !== row && e.clientY > b.top && e.clientY < b.bottom;
        })[0];
        if (!target) return;
        var b = target.getBoundingClientRect();
        list.insertBefore(row, e.clientY < b.top + b.height / 2 ? target : target.nextSibling);
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        row.classList.remove('dragging');
        saveOrder(list);
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    // Bàn phím: mũi tên lên/xuống
    handle.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowUp' && row.previousSibling) { list.insertBefore(row, row.previousSibling); saveOrder(list); handle.focus(); ev.preventDefault(); }
      if (ev.key === 'ArrowDown' && row.nextSibling) { list.insertBefore(row.nextSibling, row); saveOrder(list); handle.focus(); ev.preventDefault(); }
    });
  }
  function saveOrder(list) {
    var ids = Array.prototype.map.call(list.children, function (r) { return Number(r.getAttribute('data-id')); });
    VG.api('POST', '/categories/reorder', { ids: ids }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  }

  var ICONS = ['🍜', '☕', '🛒', '🛵', '⛽', '🏠', '💡', '💧', '📶', '🛍️', '👕', '💊', '📚', '🎬', '🎁', '👪', '🧸', '🐶', '✈️', '💼', '🎉', '🏪', '🧧', '🏦', '📱', '💳', '•'];

  VG.screens.categoryEdit = function (id) {
    var isNew = !id;
    var c = shell('/me');
    c.appendChild(VG.topbar(isNew ? 'Thêm danh mục' : 'Sửa danh mục', { back: '/categories' }));
    var body = h('div', { class: 'stack' }, loading());
    c.appendChild(body);
    VG.api('GET', '/categories').then(function (d) {
      var cat = isNew ? null : d.categories.filter(function (x) { return x.id === Number(id); })[0];
      body.textContent = '';
      if (!isNew && !cat) return body.appendChild(h('div', { class: 'msg err' }, 'Không tìm thấy danh mục.'));
      var kind = cat ? cat.kind : (VG.queryParam('kind') === 'income' ? 'income' : 'expense');
      var parentId = cat ? cat.parent_id : (Number(VG.queryParam('parent')) || null);
      var hasKids = cat && d.categories.some(function (x) { return x.parent_id === cat.id; });
      var others = d.categories.filter(function (x) { return x.kind === kind && (!cat || x.id !== cat.id); });

      var msg = VG.message();
      var name = h('input', { id: 'c-name', type: 'text', maxlength: '40', value: cat ? cat.name : '', autocomplete: 'off', autofocus: isNew });
      var icon = cat ? cat.icon : '';
      var iconBox = h('div', { class: 'icons', role: 'radiogroup', 'aria-label': 'Biểu tượng' }, ICONS.map(function (ic) {
        var b = h('button', { type: 'button', class: 'icon-pick', role: 'radio', 'aria-checked': String(ic === icon) }, ic);
        b.addEventListener('click', function () {
          icon = ic;
          Array.prototype.forEach.call(iconBox.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
        });
        return b;
      }));
      var color = VG.colorPicker(cat ? cat.color : VG.COLORS[0]);
      var parentSel = h('select', { id: 'c-parent' }, h('option', { value: '' }, '— Không (danh mục chính) —'));
      others.filter(function (x) { return !x.parent_id; }).forEach(function (p) {
        var o = h('option', { value: String(p.id) }, p.name);
        if (p.id === parentId) o.selected = true;
        parentSel.appendChild(o);
      });
      parentSel.disabled = !!hasKids;
      var btn = h('button', { type: 'submit', class: 'btn' }, isNew ? 'Thêm' : 'Lưu');
      var form = h('form', { class: 'stack', novalidate: true },
        isNew ? h('p', { class: 'muted' }, kind === 'income' ? 'Danh mục thu' : 'Danh mục chi') : null,
        VG.field('Tên danh mục', name),
        h('div', { class: 'stack-sm' }, h('span', { class: 'lbl' }, 'Biểu tượng'), iconBox),
        h('div', { class: 'stack-sm' }, h('span', { class: 'lbl' }, 'Màu'), color),
        h('div', { class: 'field' }, h('label', { for: 'c-parent' }, hasKids ? 'Thuộc danh mục (đang có mục con nên giữ là danh mục chính)' : 'Thuộc danh mục'), parentSel),
        msg, btn);
      VG.onSubmit(form, btn, msg, function () {
        var data = { name: name.value, icon: icon, color: color.value, parent_id: parentSel.value ? Number(parentSel.value) : null };
        if (isNew) data.kind = kind;
        return VG.api(isNew ? 'POST' : 'PATCH', isNew ? '/categories' : '/categories/' + cat.id, data)
          .then(function () { VG.toast(isNew ? 'Đã thêm danh mục' : 'Đã lưu'); VG.go('/categories'); });
      });
      body.appendChild(form);
      if (isNew) return;

      // Gộp và xoá
      function targetSelect(selId) {
        var sel = h('select', { id: selId }, h('option', { value: '' }, '— Chọn danh mục —'));
        others.filter(function (x) { return x.parent_id !== cat.id; }).forEach(function (x) {
          var p = x.parent_id ? d.categories.filter(function (y) { return y.id === x.parent_id; })[0] : null;
          sel.appendChild(h('option', { value: String(x.id) }, (p ? p.name + ' › ' : '') + x.name));
        });
        return sel;
      }
      var mergeSel = targetSelect('c-merge');
      var mMsg = VG.message();
      var mBtn = h('button', { type: 'submit', class: 'btn ghost' }, 'Gộp');
      var mForm = h('form', { class: 'stack', novalidate: true }, VG.field('Gộp "' + cat.name + '" vào', mergeSel), mMsg, mBtn);
      VG.onSubmit(mForm, mBtn, mMsg, function () {
        if (!mergeSel.value) throw new Error('Chọn danh mục nhận');
        return VG.api('POST', '/categories/' + cat.id + '/merge', { into: Number(mergeSel.value) }).then(function (r) {
          VG.toast('Đã gộp, chuyển ' + r.moved_transactions + ' giao dịch'); VG.go('/categories');
        });
      });
      var kidsTx = d.categories.filter(function (x) { return x.parent_id === cat.id; }).reduce(function (s, x) { return s + (x.tx_count || 0); }, 0);
      var used = (cat.tx_count || 0) + kidsTx;
      var delSel = targetSelect('c-move');
      var dMsg = VG.message();
      var dBtn = h('button', { type: 'submit', class: 'btn link danger' }, 'Xoá danh mục');
      var dForm = h('form', { class: 'stack', novalidate: true },
        used ? h('p', { class: 'muted small' }, 'Danh mục' + (hasKids ? ' và mục con' : '') + ' đang có ' + used + ' giao dịch. Chọn nơi nhận lại trước khi xoá.') : null,
        used ? VG.field('Chuyển giao dịch sang', delSel) : null,
        hasKids && !used ? h('p', { class: 'muted small' }, 'Các mục con cũng bị xoá.') : null,
        dMsg, dBtn);
      VG.onSubmit(dForm, dBtn, dMsg, function () {
        if (used && !delSel.value) throw new Error('Chọn danh mục nhận lại giao dịch');
        return VG.api('DELETE', '/categories/' + cat.id + (used ? '?move_to=' + delSel.value : '')).then(function () {
          VG.toast('Đã xoá danh mục'); VG.go('/categories');
        });
      });
      body.appendChild(h('details', { class: 'card' }, h('summary', null, 'Gộp vào danh mục khác'),
        h('p', { class: 'muted small' }, 'Mọi giao dịch chuyển sang danh mục nhận, rồi danh mục này bị xoá.'), mForm));
      if (!cat.parent_id) body.appendChild(h('a', { href: '#/categories/new?kind=' + cat.kind + '&parent=' + cat.id, class: 'btn ghost' }, '+ Thêm mục con'));
      body.appendChild(dForm);
    }).catch(function (e) { fail(body, e); });
  };

  // ============ LÀM QUEN (F01): 3 bước ============
  var PURPOSES = [
    ['track', '🧾', 'Biết tiền mình tiêu vào đâu'],
    ['save', '🎯', 'Tiết kiệm cho một mục tiêu'],
    ['debt', '💳', 'Kiểm soát nợ, thẻ tín dụng'],
    ['family', '🏠', 'Quản lý chi tiêu gia đình'],
    ['other', '✨', 'Lý do khác']
  ];
  function dots(n) {
    return h('div', { class: 'stack-sm' },
      h('div', { class: 'dots' }, [1, 2, 3].map(function (i) { return h('i', { class: i === n ? 'on' : null }); })),
      h('span', { class: 'step-lbl' }, 'Bước ' + n + '/3'));
  }

  VG.screens.onboarding = function () {
    var chosen = VG.state.user.onboarding_purpose;
    var msg = VG.message();
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
      var p = purpose ? VG.api('PATCH', '/me', { onboarding_purpose: purpose }).then(function (d) { VG.state.user = d.user; }) : Promise.resolve();
      p.then(function () { VG.go('/onboarding/wallet'); })
        .catch(function (e) { msg.show(e.message); next.disabled = skip.disabled = false; });
    }
    next.addEventListener('click', function () { finish(chosen); });
    skip.addEventListener('click', function () { finish(null); });
    VG.render(h('div', { class: 'screen' }, dots(1),
      h('h1', null, 'Bạn dùng Ví Gọn để làm gì?'),
      h('p', { class: 'muted' }, 'Chọn một mục để Ví Gọn gợi ý phù hợp hơn.'),
      h('div', { class: 'choices' }, buttons), msg,
      h('div', { class: 'bottom' }, next, skip)));
  };

  // Bước 2 (bắt buộc): tạo ví đầu tiên + số dư hiện có
  VG.screens.onboardingWallet = function () {
    var screen = h('div', { class: 'screen' }, dots(2),
      h('h1', null, 'Bạn đang có bao nhiêu tiền?'),
      h('p', { class: 'muted' }, 'Tạo ví đầu tiên. Thêm ví khác sau cũng được.'));
    VG.render(screen);
    VG.api('GET', '/wallets').then(function (d) {
      if (d.wallets.length) {
        // Đã tạo ví (quay lại bước này) → cho đi tiếp
        screen.appendChild(h('div', { class: 'card tight' }, d.wallets.map(walletRow)));
        screen.appendChild(h('div', { class: 'bottom' }, h('a', { href: '#/onboarding/categories', class: 'btn' }, 'Tiếp tục'),
          h('a', { href: '#/wallets/new', class: 'btn link' }, 'Thêm ví khác')));
        return;
      }
      screen.appendChild(walletForm(null, function () { VG.go('/onboarding/categories'); }, { compact: true, submitLabel: 'Tiếp tục' }));
      screen.appendChild(h('p', { class: 'lbl center-text' }, 'Đổi số dư sau trong mục Tôi › Ví'));
    }).catch(function (e) { screen.appendChild(h('div', { class: 'msg err' }, e.message)); });
  };

  // Bước 3 (bỏ qua được): chọn bộ danh mục mặc định
  VG.screens.onboardingCategories = function () {
    var preset = 'full';
    var msg = VG.message();
    var opts = [
      ['full', '🗂️', 'Đầy đủ', 'Có mục con: Nhà ở › Điện, Nước, Mạng; Ăn uống › Đi chợ, Cà phê…'],
      ['basic', '📋', 'Gọn', 'Chỉ 11 danh mục chi và 6 danh mục thu chính']
    ];
    var buttons = opts.map(function (o) {
      var b = h('button', { type: 'button', class: 'choice', 'aria-pressed': String(o[0] === preset) },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, o[1]),
        h('span', null, h('b', { class: 'block' }, o[2]), h('span', { class: 'muted small' }, o[3])));
      b.addEventListener('click', function () {
        preset = o[0];
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
      return b;
    });
    var next = h('button', { class: 'btn', type: 'button' }, 'Bắt đầu dùng');
    var skip = h('button', { class: 'btn link', type: 'button' }, 'Bỏ qua, dùng bộ đầy đủ');
    function finish(p) {
      next.disabled = skip.disabled = true;
      VG.api('POST', '/onboarding/complete', { category_preset: p }).then(function (d) {
        VG.state.user = d.user;
        VG.go('/');
      }).catch(function (e) {
        next.disabled = skip.disabled = false;
        if (e.status === 400 && /ví/.test(e.message)) return VG.go('/onboarding/wallet');
        msg.show(e.message);
      });
    }
    next.addEventListener('click', function () { finish(preset); });
    skip.addEventListener('click', function () { finish('full'); });
    VG.render(h('div', { class: 'screen' }, dots(3),
      h('h1', null, 'Chọn bộ danh mục'),
      h('p', { class: 'muted' }, 'Danh mục kiểu Việt có sẵn Hiếu hỉ, Gửi bố mẹ. Sửa, thêm, gộp sau trong mục Tôi › Danh mục.'),
      h('div', { class: 'choices' }, buttons), msg,
      h('div', { class: 'bottom' }, next, skip)));
  };
})(window.VG);
