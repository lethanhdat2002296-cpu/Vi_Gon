// Tổng quan (F02) và Sổ giao dịch (F04): tháng, cảnh báo, tìm kiếm, bộ lọc, vuốt xoá, xuất Excel
(function (VG) {
  'use strict';
  var h = VG.h;

  // ============ DÒNG GIAO DỊCH ============
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
    return h('button', { type: 'button', class: 'tx', onclick: function (ev) { if (!ev.currentTarget.swiped) VG.quickAdd({ tx: t }); } },
      neutral ? h('span', { class: 'cat neutral', 'aria-hidden': 'true' }, '⇄') : VG.badge(t.category_icon, t.category_color, txTitle(t)),
      h('span', { class: 't' }, h('b', null, txTitle(t)),
        h('span', { class: 'lbl' }, t.source === 'bank' ? h('span', { class: 'tag' }, 'Tự động') : null, sub)),
      h('span', { class: 'amt ' + (neutral ? '' : t.kind === 'income' ? 'in' : 'out') }, (t.kind === 'income' ? '+' : '−') + VG.show(t.amount, { symbol: false })));
  }

  // Vuốt trái để xoá (kèm hoàn tác). Vuốt chưa đủ xa thì trả về chỗ cũ.
  function swipeToDelete(row, t) {
    var wrap = h('div', { class: 'swipe' }, h('div', { class: 'swipe-bg', 'aria-hidden': 'true' }, 'Xoá'), row);
    var startX = null, startY = null, dx = 0, dragging = false;
    row.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dx = 0; dragging = false; row.swiped = false;
    });
    row.addEventListener('pointermove', function (e) {
      if (startX === null) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (!dragging && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my)) { dragging = true; row.setPointerCapture(e.pointerId); }
      if (!dragging) return;
      dx = Math.min(0, mx);
      row.style.transform = 'translateX(' + dx + 'px)';
    });
    function end() {
      if (startX === null) return;
      startX = null;
      if (!dragging) return;
      row.swiped = true;
      setTimeout(function () { row.swiped = false; }, 50);
      if (dx < -Math.min(120, wrap.offsetWidth * 0.35)) {
        row.style.transform = 'translateX(-100%)';
        VG.deleteTx(t);
      } else {
        row.style.transform = '';
      }
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', function () { startX = null; row.style.transform = ''; });
    return wrap;
  }

  // Nhóm theo ngày (giờ VN), mỗi ngày có tổng thu/chi (không tính chuyển tiền và điều chỉnh)
  function txGroups(list, into, opts) {
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
        sums.textContent = [sums.inc ? '+' + VG.show(sums.inc, { symbol: false }) : null, sums.exp ? '−' + VG.show(sums.exp, { symbol: false }) : null].filter(Boolean).join('  ');
      }
      var row = txRow(t);
      dayBox.appendChild(opts && opts.swipe ? swipeToDelete(row, t) : row);
    });
  }
  VG.txGroups = txGroups;

  // Nút ẩn/hiện số tiền (lưu vào tài khoản)
  function eyeButton() {
    var b = h('button', { type: 'button', class: 'icon-btn', 'aria-pressed': String(!!VG.state.user.hide_amounts), 'aria-label': 'Ẩn số tiền' },
      VG.state.user.hide_amounts ? '🙈' : '👁');
    b.addEventListener('click', function () {
      var next = !VG.state.user.hide_amounts;
      VG.state.user.hide_amounts = next;
      VG.route();
      VG.api('PATCH', '/me', { hide_amounts: next }).catch(function (e) {
        VG.state.user.hide_amounts = !next; VG.route(); VG.toast(e.message, { kind: 'err' });
      });
    });
    return b;
  }

  function monthLabel(m) { return 'Tháng ' + Number(m.slice(5)) + '/' + m.slice(0, 4); }
  VG.monthLabel = monthLabel;

  // ============ TỔNG QUAN ============
  var homeMonth = null;
  VG.screens.home = function () {
    var u = VG.state.user;
    var c = VG.shell('/');
    c.appendChild(h('div', { class: 'topbar' },
      h('div', { class: 'grow' }, h('span', { class: 'lbl' }, 'Xin chào'), h('h1', null, u.full_name || 'bạn')),
      eyeButton()));
    if (!u.onboarded) {
      c.appendChild(h('div', { class: 'card' }, h('b', null, 'Hoàn tất làm quen'),
        h('p', { class: 'muted small' }, 'Tạo ví đầu tiên để bắt đầu ghi thu chi.'),
        h('a', { href: '#/onboarding', class: 'btn' }, 'Tiếp tục')));
    }
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);

    var q = homeMonth ? '?month=' + homeMonth : '';
    VG.api('GET', '/summary' + q).then(function (d) {
      body.textContent = '';
      // Tổng số dư mọi ví (bấm để xem từng ví)
      body.appendChild(h('a', { href: '#/wallets', class: 'plain' }, h('div', { class: 'card hero' },
        h('span', { class: 'lbl' }, 'Tổng số dư'),
        h('span', { class: 'big' }, VG.show(d.total_balance)),
        h('span', { class: 'lbl' }, d.wallet_count + ' ví · xem từng ví ›'))));

      // Thu, chi, còn lại của tháng; ‹ › hoặc vuốt ngang để đổi tháng
      function goMonth(m) { if (m) { homeMonth = m; VG.route(); } }
      var prevBtn = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Tháng trước', onclick: function () { goMonth(d.prev_month); } }, '‹');
      var nextBtn = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Tháng sau', disabled: !d.next_month, onclick: function () { goMonth(d.next_month); } }, '›');
      var monthCard = h('div', { class: 'card month-card' },
        h('div', { class: 'row-between' }, prevBtn,
          h('div', { class: 'center-text' }, h('b', null, monthLabel(d.month)), d.is_current ? h('span', { class: 'lbl block' }, 'tính đến hôm nay') : null),
          nextBtn),
        h('div', { class: 'triple' },
          h('div', null, h('span', { class: 'lbl' }, 'Thu'), h('b', { class: 'in' }, VG.show(d.income, { symbol: false }))),
          h('div', null, h('span', { class: 'lbl' }, 'Chi'), h('b', { class: 'out' }, VG.show(d.expense, { symbol: false }))),
          h('div', null, h('span', { class: 'lbl' }, 'Còn lại'), h('b', null, VG.show(d.net, { symbol: false })))),
        h('a', { href: '#/reports?month=' + d.month, class: 'small' }, 'Xem báo cáo ' + monthLabel(d.month).toLowerCase() + ' ›'));
      var sx = null;
      monthCard.addEventListener('pointerdown', function (e) { sx = e.clientX; });
      monthCard.addEventListener('pointerup', function (e) {
        if (sx === null) return;
        var dx = e.clientX - sx; sx = null;
        if (dx > 60) goMonth(d.prev_month);
        else if (dx < -60 && d.next_month) goMonth(d.next_month);
      });
      body.appendChild(monthCard);

      // Thẻ cảnh báo
      d.alerts.forEach(function (a) {
        body.appendChild(h('a', { href: '#/wallets/' + a.wallet_id, class: 'msg warn plain-link' }, h('span', null, '⚠️ ' + a.text), h('span', { 'aria-hidden': 'true' }, '›')));
      });

      if (!u.email_verified) {
        var resend = h('button', { type: 'button', class: 'btn link' }, 'Gửi lại');
        var verifyBox = h('div', { class: 'msg warn' }, h('span', null, 'Kiểm tra hộp thư để xác minh email.'), resend);
        resend.addEventListener('click', function () {
          resend.disabled = true;
          VG.api('POST', '/auth/resend-verify')
            .then(function () { verifyBox.className = 'msg ok'; verifyBox.textContent = 'Đã gửi lại email xác minh.'; })
            .catch(function (e) { verifyBox.className = 'msg err'; verifyBox.textContent = e.message; });
        });
        body.appendChild(verifyBox);
      }

      body.appendChild(h('div', { class: 'row-between' }, h('b', null, 'Gần đây'), h('a', { href: '#/ledger', class: 'small' }, 'Xem tất cả')));
      if (!d.recent.length) {
        body.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Chưa có giao dịch. Bấm nút + để ghi khoản đầu tiên.')));
      } else {
        var list = h('div', { class: 'stack' });
        txGroups(d.recent, list);
        body.appendChild(list);
      }
    }).catch(function (e) { VG.fail(body, e); });
  };

  // ============ SỔ GIAO DỊCH ============
  // Bộ lọc giữ nguyên khi chuyển tab rồi quay lại (lưu trong phiên)
  var FILTER_KEY = 'vigon_ledger_filter';
  var EMPTY = { q: '', period: 'all', from: '', to: '', wallet: '', category: '', kind: '', source: '' };
  function loadFilter() {
    try { return Object.assign({}, EMPTY, JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}')); } catch (e) { return Object.assign({}, EMPTY); }
  }
  function saveFilter(f) { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch (e) {} }
  VG.setLedgerFilter = function (patch) { saveFilter(Object.assign({}, EMPTY, patch)); };

  function periodRange(f) {
    var t = VG.today();
    if (f.period === 'month') return { from: t.slice(0, 8) + '01', to: t };
    if (f.period === 'last') {
      var firstThis = t.slice(0, 8) + '01';
      var lastEnd = VG.addDays(firstThis, -1);
      return { from: lastEnd.slice(0, 8) + '01', to: lastEnd };
    }
    if (f.period === 'custom') return { from: f.from, to: f.to };
    return { from: '', to: '' };
  }
  function queryString(f) {
    var r = periodRange(f);
    var p = { q: f.q, from: r.from, to: r.to, wallet: f.wallet, category: f.category, kind: f.kind, source: f.source };
    return Object.keys(p).filter(function (k) { return p[k]; }).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
  }
  function activeCount(f) {
    return ['wallet', 'category', 'kind', 'source'].filter(function (k) { return f[k]; }).length + (f.period !== 'all' ? 1 : 0);
  }

  var SOURCES = [['', 'Mọi nguồn'], ['manual', 'Ghi tay'], ['transfer', 'Chuyển tiền'], ['adjust', 'Điều chỉnh'], ['bank', 'Tự động'], ['recurring', 'Định kỳ'], ['import', 'Nhập file']];
  var KINDS = [['', 'Tất cả'], ['expense', 'Chi'], ['income', 'Thu'], ['transfer', 'Chuyển']];
  var PERIODS = [['all', 'Mọi lúc'], ['month', 'Tháng này'], ['last', 'Tháng trước'], ['custom', 'Tự chọn']];

  function openFilterSheet(f, refs, onApply) {
    var draft = Object.assign({}, f);
    var custom = h('div', { class: 'split' + (draft.period === 'custom' ? '' : ' hidden') },
      VG.field('Từ ngày', h('input', { id: 'f-from', type: 'date', value: draft.from, max: VG.today() })),
      VG.field('Đến ngày', h('input', { id: 'f-to', type: 'date', value: draft.to, max: VG.today() })));
    var period = VG.chips(PERIODS, draft.period, function (v) { draft.period = v; custom.className = 'split' + (v === 'custom' ? '' : ' hidden'); });
    function select(id, options, value) {
      var sel = h('select', { id: id });
      options.forEach(function (o) { var opt = h('option', { value: o[0] }, o[1]); if (String(o[0]) === String(value)) opt.selected = true; sel.appendChild(opt); });
      return sel;
    }
    var walletSel = select('f-wallet', [['', 'Mọi ví']].concat(refs.wallets.map(function (w) { return [w.id, w.name + (w.archived ? ' (đã ẩn)' : '')]; })), draft.wallet);
    var catOpts = [['', 'Mọi danh mục'], ['none', 'Chưa phân loại']];
    ['expense', 'income'].forEach(function (k) {
      refs.categories.filter(function (c) { return c.kind === k && !c.parent_id; }).forEach(function (p) {
        catOpts.push([p.id, (k === 'income' ? 'Thu · ' : 'Chi · ') + p.name]);
        refs.categories.filter(function (c) { return c.parent_id === p.id; }).forEach(function (c) { catOpts.push([c.id, '    › ' + c.name]); });
      });
    });
    var catSel = select('f-cat', catOpts, draft.category);
    var kind = VG.chips(KINDS, draft.kind);
    var sourceSel = select('f-source', SOURCES, draft.source);
    var apply = h('button', { type: 'button', class: 'btn' }, 'Áp dụng');
    var clear = h('button', { type: 'button', class: 'btn ghost' }, 'Xoá lọc');
    var msg = VG.message();
    apply.addEventListener('click', function () {
      draft.from = custom.querySelector('#f-from').value;
      draft.to = custom.querySelector('#f-to').value;
      if (draft.period === 'custom' && (!draft.from || !draft.to)) return msg.show('Chọn đủ từ ngày và đến ngày');
      if (draft.period === 'custom' && draft.from > draft.to) return msg.show('Từ ngày phải trước đến ngày');
      draft.wallet = walletSel.value; draft.category = catSel.value; draft.kind = kind.value; draft.source = sourceSel.value;
      VG.closeSheet(); onApply(draft);
    });
    clear.addEventListener('click', function () { VG.closeSheet(); onApply(Object.assign({}, EMPTY, { q: f.q })); });
    VG.openSheet(h('div', { class: 'stack' },
      h('h2', null, 'Lọc giao dịch'),
      h('span', { class: 'lbl' }, 'Thời gian'), period, custom,
      h('div', { class: 'field' }, h('label', { for: 'f-wallet' }, 'Ví'), walletSel),
      h('div', { class: 'field' }, h('label', { for: 'f-cat' }, 'Danh mục'), catSel),
      h('span', { class: 'lbl' }, 'Loại'), kind,
      h('div', { class: 'field' }, h('label', { for: 'f-source' }, 'Nguồn'), sourceSel),
      msg, h('div', { class: 'split' }, clear, apply)));
  }

  // Tải file Excel bằng fetch (cần header đăng nhập) rồi lưu qua link tạm
  function downloadExcel(qs, btn) {
    btn.disabled = true;
    var headers = { Authorization: 'Bearer ' + VG.getToken() };
    fetch('/api/export.xlsx' + (qs ? '?' + qs : ''), { headers: headers }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Không xuất được file'); });
      var name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
      return r.blob().then(function (b) {
        var url = URL.createObjectURL(b);
        var a = h('a', { href: url, download: name ? name[1] : 'vi-gon.xlsx' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        VG.toast('Đã xuất ' + r.headers.get('X-Row-Count') + ' giao dịch ra Excel');
      });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); }).then(function () { btn.disabled = false; });
  }

  VG.screens.ledger = function () {
    var f = loadFilter();
    var c = VG.shell('/ledger');
    var exportBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Xuất Excel', title: 'Xuất Excel' }, '⤓');
    c.appendChild(VG.topbar('Sổ giao dịch', { action: exportBtn }));
    var search = h('input', { type: 'search', class: 'search', placeholder: 'Tìm ghi chú, danh mục hoặc số tiền (45k)', value: f.q, 'aria-label': 'Tìm kiếm', enterkeyhint: 'search' });
    var n = activeCount(f);
    var filterBtn = h('button', { type: 'button', class: 'chip' + (n ? ' on-soft' : '') }, '⚙ Lọc' + (n ? ' · ' + n : ''));
    c.appendChild(h('div', { class: 'search-row' }, search, filterBtn));
    var sumLine = h('p', { class: 'lbl' });
    var list = h('div', { class: 'stack' }, VG.loading());
    var more = h('button', { type: 'button', class: 'btn ghost hidden' }, 'Tải thêm');
    c.appendChild(sumLine);
    c.appendChild(list);
    c.appendChild(more);

    var refs = null;
    filterBtn.addEventListener('click', function () {
      var go = function () { openFilterSheet(f, refs, function (nf) { saveFilter(nf); VG.route(); }); };
      if (refs) return go();
      Promise.all([VG.api('GET', '/wallets?include_archived=1'), VG.api('GET', '/categories')]).then(function (r) {
        refs = { wallets: r[0].wallets, categories: r[1].categories }; go();
      }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
    });
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { f.q = search.value.trim(); saveFilter(f); reset(); load(); }, 300);
    });
    exportBtn.addEventListener('click', function () { downloadExcel(queryString(f), exportBtn); });

    var cursor = null, all = [], seq = 0;
    function reset() { cursor = null; all = []; }
    function load() {
      var my = ++seq;
      more.disabled = true;
      var qs = queryString(f);
      VG.api('GET', '/transactions?' + qs + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        if (my !== seq) return;
        if (d.summary) {
          sumLine.textContent = d.summary.count + ' giao dịch' +
            (d.summary.income ? ' · thu +' + VG.show(d.summary.income) : '') +
            (d.summary.expense ? ' · chi −' + VG.show(d.summary.expense) : '');
        }
        all = all.concat(d.transactions);
        cursor = d.next_cursor;
        list.textContent = '';
        if (!all.length) list.appendChild(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, qs ? 'Không có giao dịch khớp bộ lọc.' : 'Chưa có giao dịch nào.')));
        else txGroups(all, list, { swipe: true });
        if (all.length) list.appendChild(h('p', { class: 'lbl center-text' }, 'Vuốt trái để xoá · bấm để sửa'));
        more.className = 'btn ghost' + (cursor ? '' : ' hidden');
        more.disabled = false;
      }).catch(function (e) { VG.fail(list, e); });
    }
    more.addEventListener('click', load);
    load();
  };
})(window.VG);
