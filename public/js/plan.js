// Tab Kế hoạch: Ngân sách (F09) · Mục tiêu (F10) · Định kỳ (F11)
(function (VG) {
  'use strict';
  var h = VG.h;
  var NS = 'http://www.w3.org/2000/svg';
  var tab = 'budgets';
  var FREQ = [['monthly', 'Hằng tháng'], ['weekly', 'Hằng tuần'], ['yearly', 'Hằng năm']];
  var MODES = [['auto', 'Tự ghi'], ['confirm', 'Nhắc tôi xác nhận']];

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    Array.prototype.slice.call(arguments, 2).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function money(n) { return VG.show(n, { symbol: false }); }
  function bar(pct, level) {
    var fill = h('i', { class: level });
    fill.style.width = Math.min(100, Math.round(pct * 100)) + '%';
    return h('div', { class: 'prog', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct * 100)) }, fill);
  }
  function selectEl(id, options, value) {
    var sel = h('select', { id: id });
    options.forEach(function (o) { var opt = h('option', { value: String(o[0]) }, o[1]); if (String(o[0]) === String(value)) opt.selected = true; sel.appendChild(opt); });
    return sel;
  }
  function categoryOptions(cats, kind, extra) {
    var out = extra ? extra.slice() : [];
    cats.filter(function (c) { return c.kind === kind && !c.parent_id; }).forEach(function (p) {
      out.push([p.id, (p.icon ? p.icon + ' ' : '') + p.name]);
      cats.filter(function (c) { return c.parent_id === p.id; }).forEach(function (c) { out.push([c.id, '    › ' + c.name]); });
    });
    return out;
  }
  function sheetForm(title, fields, submitLabel, onSubmit, extraButtons) {
    var msg = VG.message();
    var btn = h('button', { type: 'submit', class: 'btn' }, submitLabel);
    var form = h('form', { class: 'stack', novalidate: true }, h('h2', null, title), fields, msg, btn, extraButtons || null);
    VG.onSubmit(form, btn, msg, function () { return onSubmit(form, msg); });
    VG.openSheet(form);
    var first = form.querySelector('input:not([type=checkbox]), select');
    if (first) first.focus();
    return form;
  }
  function refs() {
    return Promise.all([VG.api('GET', '/categories'), VG.api('GET', '/wallets')]).then(function (r) { return { cats: r[0].categories, wallets: r[1].wallets }; });
  }

  // ============ NGÂN SÁCH ============
  function budgetCard(b, onEdit) {
    var sub;
    if (b.level === 'over') sub = h('span', { class: 'lbl out' }, 'Đã vượt ' + VG.show(b.spent - b.limit));
    else if (b.per_day !== null) sub = h('span', { class: 'lbl' + (b.level === 'warn' ? ' warn-text' : '') }, 'Còn ' + VG.show(b.remaining) + ' · nên tiêu tối đa ' + VG.show(b.per_day) + '/ngày');
    else sub = h('span', { class: 'lbl' }, 'Còn ' + VG.show(b.remaining));
    var chip = b.level === 'ok' ? null : h('span', { class: 'chip ' + (b.level === 'over' ? 'bad' : 'warn') }, b.percent + '%');
    return h('button', { type: 'button', class: 'card plan-card', onclick: function () { onEdit(b); } },
      h('div', { class: 'row-between' }, h('span', { class: 'name' }, (b.icon ? b.icon + ' ' : '') + b.name), chip),
      h('div', { class: 'row-between' }, h('b', { class: 'amt' }, money(b.spent) + ' / ' + money(b.limit)), h('span', { class: 'lbl' }, b.level === 'ok' ? b.percent + '%' : '')),
      bar(b.pct, b.level === 'over' ? 'b' : b.level === 'warn' ? 'w' : ''),
      sub,
      b.carry ? h('span', { class: 'lbl' }, 'Gồm ' + VG.show(b.carry) + ' chuyển từ tháng trước') : null);
  }

  function budgetForm(b, done) {
    refs().then(function (r) {
      var isNew = !b;
      var amount = VG.moneyInput({ id: 'b-amount', value: b ? b.amount : null, placeholder: '0' });
      var catSel = isNew ? selectEl('b-cat', categoryOptions(r.cats, 'expense', [['', '💰 Tổng chi tiêu (mọi danh mục)']]), '') : null;
      var hint = h('button', { type: 'button', class: 'btn link small' }, 'Gợi ý theo 3 tháng trước');
      hint.addEventListener('click', function () {
        var cid = isNew ? catSel.value : (b.category_id || '');
        VG.api('GET', '/budgets/suggest' + (cid ? '?category_id=' + cid : '')).then(function (d) {
          if (!d.suggested) return VG.toast('Chưa có khoản chi nào trong 3 tháng trước');
          amount.value = VG.fmt(d.suggested, { symbol: false });
          hint.textContent = 'Trung bình 3 tháng: ' + VG.fmt(d.suggested);
        }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
      });
      var roll = VG.toggle('Chuyển phần chưa tiêu sang tháng sau', b && b.rollover);
      var del = !isNew ? h('button', { type: 'button', class: 'btn link danger' }, 'Xoá ngân sách') : null;
      if (del) del.addEventListener('click', function () {
        VG.api('DELETE', '/budgets/' + b.id).then(function () { VG.closeSheet(); VG.toast('Đã xoá ngân sách'); done(); })
          .catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
      });
      sheetForm(isNew ? 'Thêm ngân sách tháng' : 'Ngân sách ' + b.name, [
        catSel ? h('div', { class: 'field' }, h('label', { for: 'b-cat' }, 'Danh mục (gồm cả mục con)'), catSel) : null,
        h('div', { class: 'field big-field' }, h('label', { for: 'b-amount' }, 'Hạn mức mỗi tháng'), amount),
        hint, roll
      ], isNew ? 'Thêm' : 'Lưu', function () {
        var v = VG.parseAmount(amount.value);
        if (!v) throw new Error('Nhập hạn mức');
        var body = { amount: v, rollover: roll.input.checked };
        if (isNew) body.category_id = catSel.value ? Number(catSel.value) : null;
        return VG.api(isNew ? 'POST' : 'PATCH', isNew ? '/budgets' : '/budgets/' + b.id, body).then(function () {
          VG.closeSheet(); VG.toast(isNew ? 'Đã thêm ngân sách' : 'Đã lưu'); done();
        });
      }, del);
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  }

  function budgetsView(box) {
    VG.api('GET', '/budgets/status').then(function (d) {
      box.textContent = '';
      var head = h('div', { class: 'row-between' }, h('b', null, VG.monthLabel(d.month) + (d.days_left ? ' · còn ' + d.days_left + ' ngày' : '')),
        h('button', { type: 'button', class: 'btn sm', onclick: function () { budgetForm(null, VG.route); } }, '+ Ngân sách'));
      box.appendChild(head);
      if (!d.budgets.length) {
        box.appendChild(h('div', { class: 'card empty' }, h('b', null, 'Chưa có ngân sách'),
          h('p', { class: 'muted small' }, 'Đặt trần chi cho từng danh mục (ví dụ Ăn uống 4.000.000 ₫/tháng). Ví Gọn nhắc khi chạm 80% và 100%.')));
        return;
      }
      d.budgets.forEach(function (b) { box.appendChild(budgetCard(b, function (x) { budgetForm(x, VG.route); })); });
      box.appendChild(h('p', { class: 'lbl center-text' }, 'Xanh dưới 80% · vàng từ 80% · đỏ khi vượt. Không tính chuyển giữa ví.'));
    }).catch(function (e) { VG.fail(box, e); });
  }

  // ============ MỤC TIÊU ============
  var STATUS = { on_track: ['ok', 'Đúng tiến độ'], behind: ['warn', 'Chậm'], achieved: ['ok', 'Đã đạt'], overdue: ['bad', 'Quá hạn'] };
  function ring(pct) {
    var r = 40, c = 2 * Math.PI * r;
    var fg = svg('circle', { cx: 50, cy: 50, r: r, fill: 'none', class: 'ring-fg', 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-dasharray': (c * pct).toFixed(1) + ' ' + c.toFixed(1), transform: 'rotate(-90 50 50)' });
    return svg('svg', { viewBox: '0 0 100 100', class: 'ring', role: 'img', 'aria-label': 'Đạt ' + Math.floor(pct * 100) + '%' },
      svg('circle', { cx: 50, cy: 50, r: r, fill: 'none', class: 'ring-bg', 'stroke-width': 12 }), pct > 0 ? fg : null,
      svg('text', { x: 50, y: 57, 'text-anchor': 'middle', class: 'ring-txt' }, Math.floor(pct * 100) + '%'));
  }
  function monthText(m) { return m.slice(5) + '/' + m.slice(0, 4); }

  function goalCard(g) {
    var st = STATUS[g.status];
    var chip = h('span', { class: 'chip ' + st[0] }, st[1] + (g.status === 'behind' || g.status === 'overdue' ? ' ' + money(g.shortfall) : ''));
    var contribute = h('button', { type: 'button', class: 'btn sm' }, 'Góp thêm');
    contribute.addEventListener('click', function () { contributeForm(g); });
    var title = h('button', { type: 'button', class: 'plain-btn', onclick: function () { goalForm(g, VG.route); } }, h('b', null, g.name), h('span', { class: 'lbl' }, ' ✎'));
    return h('div', { class: 'card' },
      h('div', { class: 'row-between' }, title, chip),
      h('div', { class: 'goal-row' }, ring(g.pct),
        h('ul', { class: 'kv' },
          h('li', null, h('span', { class: 'lbl' }, 'Đã có'), h('b', { class: 'amt' }, money(g.saved))),
          h('li', null, h('span', { class: 'lbl' }, 'Cần'), h('b', { class: 'amt' }, money(g.target_amount))),
          h('li', null, h('span', { class: 'lbl' }, 'Hạn'), h('b', null, monthText(g.deadline_month))),
          h('li', null, h('span', { class: 'lbl' }, 'Ví'), h('span', null, g.wallet_name)))),
      g.status === 'achieved' ? h('div', { class: 'msg ok' }, '🎉 Đã đạt mục tiêu!') :
        h('div', { class: 'msg info' }, g.months_left > 0 ? 'Góp ' + VG.show(g.monthly_needed) + ' mỗi tháng để kịp hạn' : 'Đến hạn: còn thiếu ' + VG.show(g.missing)),
      g.status === 'achieved' ? null : contribute);
  }

  function contributeForm(g) {
    VG.api('GET', '/wallets').then(function (d) {
      var others = d.wallets.filter(function (w) { return w.id !== g.wallet_id; });
      if (!others.length) return VG.toast('Cần một ví khác để chuyển tiền vào mục tiêu', { kind: 'err' });
      var from = selectEl('g-from', others.map(function (w) { return [w.id, w.name + ' · ' + VG.fmt(w.balance)]; }), others[0].id);
      var amount = VG.moneyInput({ id: 'g-amt', value: g.monthly_needed || null, placeholder: '0' });
      sheetForm('Góp vào "' + g.name + '"', [
        h('div', { class: 'field' }, h('label', { for: 'g-from' }, 'Lấy từ ví'), from),
        h('div', { class: 'field big-field' }, h('label', { for: 'g-amt' }, 'Số tiền'), amount),
        h('p', { class: 'lbl' }, 'Ghi là chuyển tiền sang ví ' + g.wallet_name + ', không tính là khoản chi.')
      ], 'Góp', function () {
        var v = VG.parseAmount(amount.value);
        if (!v) throw new Error('Nhập số tiền');
        return VG.api('POST', '/goals/' + g.id + '/contribute', { from_wallet_id: Number(from.value), amount: v }).then(function (r) {
          VG.closeSheet(); VG.toast('Đã góp ' + VG.fmt(v) + (r.warning ? '. ' + r.warning : ''), r.warning ? { kind: 'warn', ms: 6000 } : null); VG.route();
        });
      });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  }

  function goalForm(g, done) {
    VG.api('GET', '/wallets').then(function (d) {
      var isNew = !g;
      var thisMonth = VG.today().slice(0, 7);
      var name = h('input', { id: 'g-name', type: 'text', maxlength: '60', value: g ? g.name : '', placeholder: 'Ví dụ: Mua xe máy' });
      var target = VG.moneyInput({ id: 'g-target', value: g ? g.target_amount : null, placeholder: '0' });
      var deadline = h('input', { id: 'g-deadline', type: 'month', min: thisMonth, value: g ? g.deadline_month : VG.addDays(VG.today(), 365).slice(0, 7) });
      var walletSel = isNew ? selectEl('g-wallet', [['new', '➕ Tạo ví tiết kiệm riêng']].concat(d.wallets.map(function (w) { return [w.id, w.name + ' · ' + VG.fmt(w.balance)]; })), 'new') : null;
      var del = !isNew ? h('div', { class: 'split' },
        h('button', { type: 'button', class: 'btn ghost', onclick: function () {
          VG.api('PATCH', '/goals/' + g.id, { archived: true }).then(function () { VG.closeSheet(); VG.toast('Đã ẩn mục tiêu'); done(); });
        } }, 'Ẩn'),
        h('button', { type: 'button', class: 'btn link danger', onclick: function () {
          VG.api('DELETE', '/goals/' + g.id).then(function () { VG.closeSheet(); VG.toast('Đã xoá mục tiêu (ví và tiền vẫn giữ nguyên)'); done(); });
        } }, 'Xoá')) : null;
      sheetForm(isNew ? 'Mục tiêu mới' : 'Sửa mục tiêu', [
        VG.field('Tên mục tiêu', name),
        h('div', { class: 'field big-field' }, h('label', { for: 'g-target' }, 'Số tiền cần'), target),
        VG.field('Hạn (tháng/năm)', deadline),
        walletSel ? h('div', { class: 'field' }, h('label', { for: 'g-wallet' }, 'Ví giữ tiền'), walletSel) : null,
        isNew ? h('p', { class: 'lbl' }, 'Tiền đã có = số dư ví giữ tiền. Nên dùng ví riêng để không lẫn với tiền tiêu.') : null
      ], isNew ? 'Tạo mục tiêu' : 'Lưu', function () {
        var v = VG.parseAmount(target.value);
        if (!v) throw new Error('Nhập số tiền cần');
        var body = { name: name.value, target_amount: v, deadline_month: deadline.value };
        if (isNew) {
          if (walletSel.value === 'new') body.new_wallet_name = ('Quỹ ' + name.value).slice(0, 60);
          else body.wallet_id = Number(walletSel.value);
        }
        return VG.api(isNew ? 'POST' : 'PATCH', isNew ? '/goals' : '/goals/' + g.id, body).then(function () {
          VG.closeSheet(); VG.toast(isNew ? 'Đã tạo mục tiêu' : 'Đã lưu'); done();
        });
      }, del);
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  }

  function goalsView(box) {
    VG.api('GET', '/goals').then(function (d) {
      box.textContent = '';
      box.appendChild(h('div', { class: 'row-between' }, h('b', null, d.goals.length ? d.goals.length + ' mục tiêu' : 'Mục tiêu tiết kiệm'),
        h('button', { type: 'button', class: 'btn sm', onclick: function () { goalForm(null, VG.route); } }, '+ Mục tiêu')));
      if (!d.goals.length) {
        box.appendChild(h('div', { class: 'card empty' }, h('b', null, 'Chưa có mục tiêu'),
          h('p', { class: 'muted small' }, 'Đặt số tiền cần và hạn, Ví Gọn tính mỗi tháng cần góp bao nhiêu.')));
        return;
      }
      d.goals.forEach(function (g) { box.appendChild(goalCard(g)); });
    }).catch(function (e) { VG.fail(box, e); });
  }

  // ============ ĐỊNH KỲ ============
  // prefill: { kind, amount, category_id, wallet_id, note } (tạo từ giao dịch có sẵn)
  VG.ruleForm = function (rule, prefill, done) {
    done = done || VG.route;
    refs().then(function (r) {
      var isNew = !rule;
      var src = rule || prefill || {};
      var kind = src.kind || 'expense';
      var amount = VG.moneyInput({ id: 'r-amt', value: src.amount || null, placeholder: '0' });
      var catBox = h('div');
      var catSel;
      function drawCats() {
        catSel = selectEl('r-cat', categoryOptions(r.cats, kind, [['', '— Chưa chọn —']]), src.kind === kind ? (src.category_id || '') : '');
        catBox.textContent = '';
        catBox.appendChild(h('div', { class: 'field' }, h('label', { for: 'r-cat' }, 'Danh mục'), catSel));
      }
      drawCats();
      var kindSeg = VG.seg([['expense', 'Chi'], ['income', 'Thu']], kind, function (k) { kind = k; drawCats(); });
      var walletSel = selectEl('r-wallet', r.wallets.map(function (w) { return [w.id, w.name]; }), src.wallet_id || (r.wallets[0] && r.wallets[0].id));
      var note = h('input', { id: 'r-note', type: 'text', maxlength: '200', value: src.note || '', placeholder: 'Ví dụ: Tiền nhà, Netflix' });
      var freq = VG.chips(FREQ, rule ? rule.frequency : 'monthly');
      var start = h('input', { id: 'r-start', type: 'date', value: rule ? rule.anchor_date : VG.today() });
      var end = h('input', { id: 'r-end', type: 'date', value: rule && rule.end_date ? rule.end_date : '' });
      var mode = VG.chips(MODES, rule ? rule.mode : 'auto');
      var extra = null;
      if (!isNew) {
        extra = h('div', { class: 'split' },
          h('button', { type: 'button', class: 'btn ghost', onclick: function () {
            VG.api('PATCH', '/recurring/' + rule.id, { active: !rule.active }).then(function () { VG.closeSheet(); VG.toast(rule.active ? 'Đã tạm dừng' : 'Đã chạy lại'); done(); });
          } }, rule.active ? 'Tạm dừng' : 'Chạy lại'),
          h('button', { type: 'button', class: 'btn link danger', onclick: function () {
            VG.api('DELETE', '/recurring/' + rule.id).then(function () { VG.closeSheet(); VG.toast('Đã xoá quy tắc (giao dịch đã ghi vẫn giữ)'); done(); });
          } }, 'Xoá'));
      }
      if (!r.wallets.length) return VG.toast('Tạo ví trước đã', { kind: 'err' });
      sheetForm(isNew ? 'Giao dịch định kỳ' : 'Sửa định kỳ', [
        kindSeg,
        h('div', { class: 'field big-field' }, h('label', { for: 'r-amt' }, 'Số tiền'), amount),
        catBox,
        h('div', { class: 'field' }, h('label', { for: 'r-wallet' }, 'Ví'), walletSel),
        VG.field('Ghi chú', note),
        h('span', { class: 'lbl' }, 'Lặp lại'), freq,
        h('div', { class: 'split' }, VG.field('Bắt đầu từ', start), VG.field('Kết thúc (không bắt buộc)', end)),
        h('span', { class: 'lbl' }, 'Khi đến hạn'), mode,
        h('p', { class: 'lbl' }, 'Ngày 29–31 với tháng ngắn sẽ ghi vào ngày cuối tháng. Ghi lúc 7 giờ sáng ngày đến hạn.')
      ], isNew ? 'Tạo' : 'Lưu', function () {
        var v = VG.parseAmount(amount.value);
        if (!v) throw new Error('Nhập số tiền');
        if (!start.value) throw new Error('Chọn ngày bắt đầu');
        var body = {
          kind: kind, amount: v, category_id: catSel.value ? Number(catSel.value) : null, wallet_id: Number(walletSel.value),
          note: note.value, frequency: freq.value, start_date: start.value, end_date: end.value || null, mode: mode.value
        };
        return VG.api(isNew ? 'POST' : 'PATCH', isNew ? '/recurring' : '/recurring/' + rule.id, body).then(function (d) {
          VG.closeSheet(); VG.toast((isNew ? 'Đã tạo: ' : 'Đã lưu: ') + d.rule.schedule); done();
        });
      }, extra);
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  };

  function ruleRow(r) {
    var sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': r.active ? 'Tạm dừng' : 'Chạy lại' });
    sw.checked = r.active;
    sw.addEventListener('click', function (ev) { ev.stopPropagation(); });
    sw.addEventListener('change', function () {
      VG.api('PATCH', '/recurring/' + r.id, { active: sw.checked }).then(function () { VG.toast(sw.checked ? 'Đã chạy lại' : 'Đã tạm dừng'); VG.route(); })
        .catch(function (e) { sw.checked = !sw.checked; VG.toast(e.message, { kind: 'err' }); });
    });
    var title = r.note || r.category_name || 'Định kỳ';
    return h('div', { class: 'tx' + (r.active ? '' : ' dimmed') },
      VG.badge(r.category_icon, r.category_color, title),
      h('button', { type: 'button', class: 't plain-btn', onclick: function () { VG.ruleForm(r); } },
        h('b', null, title),
        h('span', { class: 'lbl' }, r.schedule + ' · ' + (r.mode === 'auto' ? 'tự ghi' : 'nhắc xác nhận') + (r.active ? ' · lần tới ' + VG.shortDate(r.next_date) : ' · đang dừng'))),
      h('span', { class: 'amt ' + (r.kind === 'income' ? 'in' : 'out') }, (r.kind === 'income' ? '+' : '−') + money(r.amount)),
      sw);
  }

  function recurringView(box) {
    VG.api('GET', '/recurring').then(function (d) {
      box.textContent = '';
      box.appendChild(h('div', { class: 'row-between' }, h('b', null, 'Giao dịch định kỳ'),
        h('button', { type: 'button', class: 'btn sm', onclick: function () { VG.ruleForm(null); } }, '+ Định kỳ')));
      if (d.rules.length) {
        box.appendChild(h('div', { class: 'msg info' }, VG.monthLabel(d.projection.month) + ' dự kiến: thu ' + VG.show(d.projection.income) + ', chi cố định ' + VG.show(d.projection.expense)));
      }
      if (d.pending.length) {
        box.appendChild(h('b', null, 'Chờ xác nhận'));
        box.appendChild(h('div', { class: 'card tight' }, d.pending.map(function (p) {
          var ok = h('button', { type: 'button', class: 'btn sm' }, 'Ghi');
          var skip = h('button', { type: 'button', class: 'btn sm ghost' }, 'Bỏ qua');
          ok.addEventListener('click', function () {
            ok.disabled = skip.disabled = true;
            VG.api('POST', '/recurring/' + p.rule_id + '/pending/' + p.due_date + '/confirm', {}).then(function () { VG.toast('Đã ghi ' + VG.fmt(p.amount)); VG.route(); })
              .catch(function (e) { ok.disabled = skip.disabled = false; VG.toast(e.message, { kind: 'err' }); });
          });
          skip.addEventListener('click', function () {
            VG.api('POST', '/recurring/' + p.rule_id + '/pending/' + p.due_date + '/skip').then(function () { VG.toast('Đã bỏ qua'); VG.route(); });
          });
          return h('div', { class: 'tx' },
            h('span', { class: 't' }, h('b', null, p.name), h('span', { class: 'lbl' }, VG.dayLabel(p.due_date) + ' · ' + p.wallet_name)),
            h('span', { class: 'amt ' + (p.kind === 'income' ? 'in' : 'out') }, money(p.amount)), ok, skip);
        })));
      }
      if (!d.rules.length) {
        box.appendChild(h('div', { class: 'card empty' }, h('b', null, 'Chưa có giao dịch định kỳ'),
          h('p', { class: 'muted small' }, 'Tiền nhà, lương, cước điện thoại, Netflix… tạo một lần, Ví Gọn tự ghi mỗi kỳ.')));
        return;
      }
      box.appendChild(h('div', { class: 'card tight' }, d.rules.map(ruleRow)));
    }).catch(function (e) { VG.fail(box, e); });
  }

  VG.screens.plan = function () {
    var q = VG.queryParam('tab');
    if (q) tab = q;
    var c = VG.shell('/plan');
    c.appendChild(VG.topbar('Kế hoạch'));
    c.appendChild(VG.seg([['budgets', 'Ngân sách'], ['goals', 'Mục tiêu'], ['recurring', 'Định kỳ']], tab, function (t) {
      tab = t;
      if (location.hash !== '#/plan') location.hash = '/plan'; else VG.route();
    }));
    var box = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(box);
    ({ budgets: budgetsView, goals: goalsView, recurring: recurringView }[tab] || budgetsView)(box);
  };
})(window.VG);
