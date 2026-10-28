// Bảng nhập nhanh (F03): gõ số tiền → chọn danh mục → Lưu. Dùng cho cả thêm mới và sửa.
//   VG.quickAdd()                 thêm chi (mặc định)
//   VG.quickAdd({ mode: 'income', scan: true })  chọn sẵn loại / mở camera quét hoá đơn
//   VG.quickAdd({ tx: giaoDich }) sửa / xoá (khoản chuyển giữa ví cũ vẫn sửa được)
(function (VG) {
  'use strict';
  var h = VG.h;
  var MAX_DIGITS = 12;
  var QUICK = [[20000, '20k'], [50000, '50k'], [100000, '100k'], [200000, '200k']];

  // Sau mỗi thay đổi dữ liệu: vẽ lại màn đang mở
  function refresh() { if (VG.route) VG.route(); }

  // Xoá kèm "Hoàn tác" 5 giây (thay cho hộp xác nhận)
  VG.deleteTx = function (tx) {
    return VG.api('DELETE', '/transactions/' + tx.id).then(function () {
      refresh();
      VG.toast(tx.transfer_group ? 'Đã xoá khoản chuyển tiền' : 'Đã xoá giao dịch', {
        action: 'Hoàn tác', ms: 5000,
        onAction: function () {
          VG.api('POST', '/transactions/' + tx.id + '/restore').then(refresh)
            .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
        }
      });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  };

  VG.quickAdd = function (opts) {
    opts = opts || {};
    var panel = VG.openSheet(h('div', { class: 'qa-loading muted' }, 'Đang mở…'));
    VG.api('GET', '/quickadd').then(function (data) {
      if (!panel.isConnected) return;
      build(panel, data, opts);
    }).catch(function (e) {
      panel.textContent = '';
      panel.appendChild(h('div', { class: 'msg err' }, e.message));
    });
  };

  function build(panel, data, opts) {
    var tx = opts.tx || null;
    var editing = !!tx;
    var isTransferEdit = editing && !!tx.transfer_group;
    var wallets = data.wallets;
    var catsById = {};
    data.categories.forEach(function (c) { catsById[c.id] = c; });
    // Mục con chưa có biểu tượng riêng thì dùng biểu tượng của danh mục cha
    var withIcon = function (c) { if (!c.icon && c.parent_id && catsById[c.parent_id]) c.icon = catsById[c.parent_id].icon; };
    data.categories.forEach(withIcon);
    data.top_categories.expense.forEach(withIcon);
    data.top_categories.income.forEach(withIcon);

    // Trạng thái bảng
    var s = {
      mode: isTransferEdit ? 'transfer' : (tx ? tx.kind : (opts.mode || 'expense')),
      digits: tx ? String(tx.amount) : '',
      categoryId: tx ? tx.category_id : null,
      walletId: tx ? tx.wallet_id : data.last_wallet_id,
      fromId: null, toId: null,
      date: tx ? VG.vnDate(tx.occurred_at) : VG.today(),
      note: tx ? tx.note : ''
    };
    if (isTransferEdit) {
      s.fromId = tx.kind === 'expense' ? tx.wallet_id : tx.counterpart_wallet_id;
      s.toId = tx.kind === 'expense' ? tx.counterpart_wallet_id : tx.wallet_id;
    } else {
      s.fromId = data.last_wallet_id;
      var other = wallets.filter(function (w) { return w.id !== s.fromId; })[0];
      s.toId = other ? other.id : null;
    }
    var origDate = s.date;

    panel.textContent = '';
    if (!wallets.length && !editing) {
      panel.appendChild(h('div', { class: 'stack' },
        h('h2', null, 'Chưa có ví nào'),
        h('p', { class: 'muted' }, 'Tạo một ví (ví dụ Tiền mặt) để bắt đầu ghi thu chi.'),
        h('a', { href: '#/wallets/new', class: 'btn', onclick: VG.closeSheet }, 'Tạo ví')));
      return;
    }

    // ---- Phần đầu: loại + nút xoá khi sửa ----
    var segEl = isTransferEdit
      ? h('div', { class: 'seg' }, h('button', { type: 'button', 'aria-selected': 'true' }, 'Chuyển giữa ví'))
      : VG.seg([['expense', 'Chi'], ['income', 'Thu']], s.mode, function (m) {
        if (m !== s.mode) { s.mode = m; if (!editing || m !== tx.kind) s.categoryId = null; else s.categoryId = tx.category_id; drawBody(); drawAmount(); }
      });
    var head = h('div', { class: 'qa-head' }, h('div', { class: 'grow' }, segEl),
      editing && !isTransferEdit && VG.ruleForm ? h('button', { type: 'button', class: 'btn link', title: 'Tạo giao dịch định kỳ từ khoản này', onclick: function () {
        VG.closeSheet();
        VG.ruleForm(null, { kind: tx.kind, amount: tx.amount, category_id: tx.category_id, wallet_id: tx.wallet_id, note: tx.note });
      } }, '↻ Lặp lại') : null,
      editing && tx.has_receipt && VG.showReceipt ? h('button', { type: 'button', class: 'btn link', onclick: function () { VG.showReceipt(tx.id); } }, '🧾 Ảnh') : null,
      !editing && VG.scanReceipt ? h('button', { type: 'button', class: 'btn link', title: 'Chụp hoặc chọn ảnh hoá đơn', onclick: scan }, '📷 Quét') : null,
      editing ? h('button', { type: 'button', class: 'btn link danger', onclick: function () { VG.closeSheet(); VG.deleteTx(tx); } }, 'Xoá') : null);

    // ---- Quét hoá đơn (F13): điền sẵn số tiền, ngày, cửa hàng; luôn để người dùng xem lại ----
    var scanBox = h('div', { class: 'scan-box hidden' });
    var attach = null;
    function scan() {
      VG.scanReceipt(function (r) {
        scanBox.textContent = '';
        if (r.amount) s.digits = String(r.amount);
        if (r.date && r.date <= VG.today()) { s.date = r.date; dateInput.value = r.date; dateLabel.textContent = VG.shortDate(r.date); }
        if (r.store && !s.note) { s.note = r.store; noteInput.value = r.store; }
        if (s.mode !== 'expense') { s.mode = 'expense'; }
        drawAmount(); drawBody();
        attach = r.image ? VG.toggle('Đính kèm ảnh hoá đơn', true) : null;
        var thumb = r.image ? h('img', { src: 'data:image/jpeg;base64,' + r.image, alt: 'Ảnh hoá đơn', class: 'scan-thumb' }) : null;
        scanBox.appendChild(h('div', { class: 'msg ' + (r.amount ? 'info' : 'warn') },
          r.amount ? 'Đã đọc: ' + VG.fmt(r.amount) + (r.date ? ' · ' + VG.shortDate(r.date) : '') + (r.store ? ' · ' + r.store : '') + '. Xem lại trước khi lưu.' : 'Không đọc được tổng tiền, hãy gõ số tiền.'));
        if (thumb) scanBox.appendChild(h('div', { class: 'row-between' }, thumb, attach));
        scanBox.className = 'scan-box';
      }, function (status) {
        scanBox.textContent = '';
        if (status) { scanBox.appendChild(h('div', { class: 'msg info' }, status)); scanBox.className = 'scan-box'; }
      });
    }

    // ---- Số tiền ----
    var amountEl = h('div', { class: 'qa-amount', 'aria-live': 'polite' });
    function drawAmount() {
      amountEl.textContent = s.digits ? VG.fmt(s.digits) : '0 ₫';
      amountEl.className = 'qa-amount ' + (s.mode === 'income' ? 'in' : s.mode === 'expense' ? 'out' : '') + (s.digits ? '' : ' empty');
    }
    var quick = h('div', { class: 'chips center-chips' }, QUICK.map(function (q) {
      return h('button', { type: 'button', class: 'chip', onclick: function () { s.digits = String(q[0]); drawAmount(); } }, q[1]);
    }));

    // ---- Danh mục hoặc cặp ví chuyển tiền ----
    var body = h('div', { class: 'qa-body' });
    function walletSelect(value, onChange, label, exclude) {
      var sel = h('select', { class: 'chip-select', 'aria-label': label });
      wallets.forEach(function (w) {
        if (exclude && w.id === exclude) return;
        var o = h('option', { value: String(w.id) }, w.name);
        if (w.id === value) o.selected = true;
        sel.appendChild(o);
      });
      // Ví đã ẩn nhưng giao dịch đang sửa thuộc ví đó
      if (value && !wallets.some(function (w) { return w.id === value; })) {
        var o = h('option', { value: String(value) }, (tx && tx.wallet_name) || 'Ví đã ẩn');
        o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', function () { onChange(Number(sel.value)); });
      return sel;
    }
    function drawBody() {
      body.textContent = '';
      if (s.mode === 'transfer') {
        if (wallets.length < 2 && !isTransferEdit) {
          body.appendChild(h('div', { class: 'msg info' }, 'Cần ít nhất 2 ví để chuyển tiền. ', h('a', { href: '#/wallets/new', onclick: VG.closeSheet }, 'Thêm ví')));
          return;
        }
        var fromSel = walletSelect(s.fromId, function (v) { s.fromId = v; if (s.toId === v) { s.toId = null; } drawBody(); }, 'Từ ví');
        var toSel = walletSelect(s.toId, function (v) { s.toId = v; }, 'Đến ví', s.fromId);
        if (!s.toId || s.toId === s.fromId) s.toId = Number(toSel.value) || null;
        fromSel.disabled = toSel.disabled = isTransferEdit;
        body.appendChild(h('div', { class: 'qa-transfer' },
          h('label', null, h('span', { class: 'lbl' }, 'Từ'), fromSel),
          h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
          h('label', null, h('span', { class: 'lbl' }, 'Đến'), toSel)));
        return;
      }
      var top = data.top_categories[s.mode].slice();
      // Danh mục đang chọn luôn hiện trong lưới
      if (s.categoryId && !top.some(function (c) { return c.id === s.categoryId; }) && catsById[s.categoryId]) {
        top.unshift(catsById[s.categoryId]);
        top = top.slice(0, 9);
      }
      var grid = h('div', { class: 'catgrid' });
      top.forEach(function (c) {
        grid.appendChild(h('button', {
          type: 'button', class: 'catbtn', 'aria-pressed': String(c.id === s.categoryId),
          onclick: function () { s.categoryId = c.id; drawBody(); }
        }, VG.badge(c.icon, c.color, c.name), h('span', null, c.name)));
      });
      grid.appendChild(h('button', { type: 'button', class: 'catbtn', onclick: pickAll },
        h('span', { class: 'cat more', 'aria-hidden': 'true' }, '…'), h('span', null, 'Thêm')));
      body.appendChild(grid);
    }
    // Chọn trong toàn bộ danh mục (cả mục con)
    function pickAll() {
      var list = data.categories.filter(function (c) { return c.kind === s.mode; });
      var parents = list.filter(function (c) { return !c.parent_id; });
      var box = h('div', { class: 'qa-all' }, h('div', { class: 'row-between' }, h('b', null, 'Chọn danh mục'),
        h('button', { type: 'button', class: 'btn link', onclick: drawBody }, 'Xong')));
      parents.forEach(function (p) {
        var kids = list.filter(function (c) { return c.parent_id === p.id; });
        box.appendChild(h('div', { class: 'qa-group' }, [p].concat(kids).map(function (c) {
          return h('button', {
            type: 'button', class: 'chip' + (c.parent_id ? ' sub' : ''), 'aria-pressed': String(c.id === s.categoryId),
            onclick: function () { s.categoryId = c.id; drawBody(); }
          }, (c.icon ? c.icon + ' ' : '') + c.name);
        })));
      });
      body.textContent = '';
      body.appendChild(box);
    }

    // ---- Ví, ngày, ghi chú ----
    var walletWrap = h('span');
    function drawWallet() {
      walletWrap.textContent = '';
      if (s.mode !== 'transfer') walletWrap.appendChild(walletSelect(s.walletId, function (v) { s.walletId = v; }, 'Ví'));
    }
    // Chip ngày hiện "Hôm nay / Hôm qua / dd/mm"; ô date thật nằm trong suốt phía trên để mở lịch của máy
    var dateLabel = h('span', null, VG.shortDate(s.date));
    var dateInput = h('input', { type: 'date', class: 'date-overlay', 'aria-label': 'Ngày', max: VG.today(), value: s.date });
    dateInput.addEventListener('change', function () {
      s.date = dateInput.value && dateInput.value <= VG.today() ? dateInput.value : VG.today();
      dateLabel.textContent = VG.shortDate(s.date);
    });
    dateInput.addEventListener('click', function () { try { dateInput.showPicker(); } catch (e) {} });
    var dateChip = h('label', { class: 'chip-select date-chip' }, h('span', { 'aria-hidden': 'true' }, '📅'), dateLabel, dateInput);
    var noteInput = h('input', { type: 'text', class: 'qa-note', placeholder: 'Ghi chú (không bắt buộc)', maxlength: '200', value: s.note, autocomplete: 'off' });
    var suggestBox = h('div', { class: 'chips' });
    var suggestTimer = null;
    noteInput.addEventListener('input', function () {
      s.note = noteInput.value;
      clearTimeout(suggestTimer);
      if (s.mode === 'transfer') return;
      suggestTimer = setTimeout(function () {
        var q = noteInput.value.trim();
        if (q.length < 2) { suggestBox.textContent = ''; return; }
        VG.api('GET', '/quickadd/suggest?q=' + encodeURIComponent(q)).then(function (d) {
          suggestBox.textContent = '';
          d.suggestions.filter(function (x) { return x.kind === s.mode && x.note.toLowerCase() !== q.toLowerCase(); }).forEach(function (x) {
            var c = catsById[x.category_id];
            suggestBox.appendChild(h('button', {
              type: 'button', class: 'chip suggest',
              onclick: function () {
                s.note = noteInput.value = x.note;
                if (c) s.categoryId = c.id;
                if (!s.digits) s.digits = String(x.amount);
                suggestBox.textContent = '';
                drawAmount(); drawBody();
              }
            }, x.note + (c ? ' · ' + c.name : '') + ' · ' + VG.fmt(x.amount)));
          });
        }).catch(function () {});
      }, 250);
    });
    var meta = h('div', { class: 'qa-meta' }, walletWrap, dateChip);

    // ---- Bàn phím số ----
    var msg = VG.message();
    var saveBtn = h('button', { type: 'button', class: 'key ok' }, editing ? 'Lưu' : 'Lưu');
    function press(k) {
      if (k === 'back') s.digits = s.digits.slice(0, -1);
      else if (k === 'clear') s.digits = '';
      else {
        var next = (s.digits + k).replace(/^0+/, '');
        if (next.length <= MAX_DIGITS) s.digits = next;
      }
      drawAmount();
    }
    function key(label, k, cls) {
      return h('button', { type: 'button', class: 'key' + (cls ? ' ' + cls : ''), onclick: function () { press(k); } }, label);
    }
    var keys = h('div', { class: 'keys' },
      key('1', '1'), key('2', '2'), key('3', '3'), key('⌫', 'back', 'fn'),
      key('4', '4'), key('5', '5'), key('6', '6'), saveBtn,
      key('7', '7'), key('8', '8'), key('9', '9'),
      key('000', '000'), key('0', '0'), key('C', 'clear', 'fn'));

    // Bàn phím thật (máy tính): số, Backspace, Enter
    function onKey(ev) {
      if (!panel.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
      if (/^\d$/.test(ev.key)) { press(ev.key); ev.preventDefault(); }
      else if (ev.key === 'Backspace') { press('back'); ev.preventDefault(); }
      else if (ev.key === 'Enter') { save(); ev.preventDefault(); }
      else if (ev.key === 'Escape') VG.closeSheet();
    }
    document.addEventListener('keydown', onKey);

    function save() {
      msg.hide();
      var amount = s.digits ? Number(s.digits) : 0;
      if (!amount) return msg.show('Nhập số tiền');
      var req;
      if (s.mode === 'transfer') {
        if (!s.fromId || !s.toId || s.fromId === s.toId) return msg.show('Chọn ví nguồn và ví đích khác nhau');
        if (editing) {
          var patchT = { amount: amount, note: s.note };
          if (s.date !== origDate) patchT.date = s.date;
          req = VG.api('PATCH', '/transactions/' + tx.id, patchT);
        } else {
          req = VG.api('POST', '/transfers', { from_wallet_id: s.fromId, to_wallet_id: s.toId, amount: amount, date: s.date, note: s.note });
        }
      } else {
        if (!s.categoryId) return msg.show('Chọn danh mục');
        if (!s.walletId) return msg.show('Chọn ví');
        if (editing) {
          var patch = { amount: amount, kind: s.mode, category_id: s.categoryId, wallet_id: s.walletId, note: s.note };
          if (s.date !== origDate) patch.date = s.date;
          req = VG.api('PATCH', '/transactions/' + tx.id, patch);
        } else {
          req = VG.api('POST', '/transactions', { kind: s.mode, amount: amount, wallet_id: s.walletId, category_id: s.categoryId, date: s.date, note: s.note });
        }
      }
      saveBtn.disabled = true;
      req.then(function (d) {
        // Đính ảnh hoá đơn vừa quét vào giao dịch mới
        if (attach && attach.input.checked && d.transaction && VG.uploadReceipt) {
          var img = scanBox.querySelector('.scan-thumb');
          if (img) VG.uploadReceipt(d.transaction.id, img.src.split(',')[1]).catch(function (e) { VG.toast('Đã lưu giao dịch nhưng chưa đính được ảnh: ' + e.message, { kind: 'warn' }); });
        }
        VG.closeSheet();
        refresh();
        var label = s.mode === 'transfer' ? 'chuyển tiền' : (catsById[s.categoryId] ? catsById[s.categoryId].name : '');
        var text = (editing ? 'Đã sửa ' : 'Đã lưu ') + VG.fmt(amount) + (label ? ' · ' + label : '');
        // Chi vượt số dư: vẫn lưu, báo bằng thông báo màu vàng lâu hơn
        VG.toast(d.warning ? text + '. ' + d.warning : text, d.warning ? { kind: 'warn', ms: 6000 } : null);
      }).catch(function (e) { msg.show(e.message); saveBtn.disabled = false; });
    }
    saveBtn.addEventListener('click', save);

    drawAmount(); drawBody(); drawWallet();
    segEl.addEventListener('click', drawWallet);
    panel.appendChild(h('div', { class: 'qa' }, head, scanBox, amountEl, quick, body, meta, noteInput, suggestBox, msg, keys));
    // Nút "Quét" ở Tổng quan: mở luôn camera / chọn ảnh
    if (opts.scan && !editing && VG.scanReceipt) scan();
  }
})(window.VG);
