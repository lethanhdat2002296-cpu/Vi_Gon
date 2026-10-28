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
    if (t.source === 'debt') return t.note || 'Sổ nợ';
    return t.category_name || 'Chưa phân loại';
  }
  function txRow(t) {
    var neutral = !!t.transfer_group;
    var sub = [VG.state.book ? t.recorded_by : null, t.note && t.source !== 'adjust' && t.source !== 'debt' ? t.note : null,
      t.wallet_name].filter(Boolean).join(' · ');
    if (t.source === 'debt') neutral = true;
    return h('button', { type: 'button', class: 'tx', onclick: function (ev) {
      if (ev.currentTarget.swiped) return;
      if (t.source === 'debt') return VG.go('/debts');
      if (VG.canWrite()) VG.quickAdd({ tx: t });
    } },
      neutral ? h('span', { class: 'cat neutral', 'aria-hidden': 'true' }, t.source === 'debt' ? '🤝' : '⇄') : VG.badge(t.category_icon, t.category_color, txTitle(t)),
      h('span', { class: 't' }, h('b', null, txTitle(t)),
        h('span', { class: 'lbl' }, t.status === 'pending' ? h('span', { class: 'tag warn' }, 'Chờ xác nhận') : t.source === 'bank' ? h('span', { class: 'tag' }, 'Tự động') : null,
          t.has_receipt ? '🧾 ' : null, sub)),
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
        sums = h('span', { class: 'day-sum' });
        sums.inc = 0; sums.exp = 0;
        dayBox = h('div', { class: 'card tight day-card' },
          h('div', { class: 'day' }, h('span', { class: 'day-lbl' }, VG.dayLabel(d)), sums));
        into.appendChild(dayBox);
      }
      if (!t.transfer_group && t.source !== 'adjust' && t.source !== 'debt') {
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
    var b = h('button', { type: 'button', class: 'icon-btn eye-btn', 'aria-pressed': String(!!VG.state.user.hide_amounts), 'aria-label': 'Ẩn số tiền' },
      VG.state.user.hide_amounts ? '🙈' : '🐵');
    b.addEventListener('click', function () {
      var next = !VG.state.user.hide_amounts;
      VG.state.user.hide_amounts = next;
      VG.rerender();
      // Lưu lựa chọn ở nền, không xoá đệm dữ liệu
      VG.saveMe({ hide_amounts: next }).catch(function (e) {
        VG.state.user.hide_amounts = !next; VG.rerender(); VG.toast(e.message, { kind: 'err' });
      });
    });
    return b;
  }

  function monthLabel(m) { return 'Tháng ' + Number(m.slice(5)) + '/' + m.slice(0, 4); }
  VG.monthLabel = monthLabel;

  // ============ TỔNG QUAN ============
  var homeMonth = null;
  // Bảng điều khiển ở Tổng quan: chỉ số nhanh, chi theo danh mục, thu chi 6 tháng
  function drawDashboard(box, d) {
    var month = d.month;
    var last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    // Tháng đang chạy: tính đến hôm nay, để "so kỳ trước" so cùng số ngày
    var from = month + '-01', to = d.is_current ? VG.today() : month + '-' + String(last).padStart(2, '0');
    var daysGone = d.is_current ? Number(VG.today().slice(8)) : last;
    // Chỉ số nhanh
    var vsPrev = h('b', null, '…');
    var saveRate = d.income ? Math.round((d.income - d.expense) / d.income * 100) : null;
    box.appendChild(h('div', { class: 'sec-head' }, h('b', null, 'Bảng điều khiển'), h('a', { href: '#/reports?month=' + month, class: 'small' }, 'Báo cáo đầy đủ ›')));
    box.appendChild(h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', { class: 'lbl' }, 'Chi trung bình/ngày'), h('b', null, VG.show(Math.round(d.expense / Math.max(1, daysGone)), { symbol: false }))),
      h('div', { class: 'kpi' }, h('span', { class: 'lbl' }, 'Tỉ lệ để dành'),
        h('b', { class: saveRate === null ? '' : saveRate >= 0 ? 'in' : 'out' }, saveRate === null ? '—' : saveRate + '%')),
      h('div', { class: 'kpi' }, h('span', { class: 'lbl' }, d.is_current ? 'Chi so với ' + daysGone + ' ngày trước đó' : 'Chi so với tháng trước'), vsPrev)));
    var catCard = h('div', { class: 'card' }, h('b', null, 'Chi theo danh mục'), VG.loading());
    var tipBox = h('p', { class: 'small tip' }, 'Bấm vào một tháng để xem số.');
    var barCard = h('div', { class: 'card' },
      h('div', { class: 'row-between' }, h('b', null, 'Thu, chi 6 tháng'),
        h('span', { class: 'legend-inline' }, h('i', { class: 'bar-in-dot' }), 'Thu', h('i', { class: 'bar-out-dot' }), 'Chi')), VG.loading());
    box.appendChild(catCard);
    box.appendChild(barCard);
    Promise.all([VG.api('GET', '/reports/by-category?from=' + from + '&to=' + to), VG.api('GET', '/reports/monthly?months=6&end=' + month)]).then(function (r) {
      var C = VG.charts, cat = r[0];
      // So với kỳ liền trước cùng độ dài (API by-category trả prev_total)
      if (cat.prev_total) {
        var ch = Math.round((cat.total - cat.prev_total) / cat.prev_total * 100);
        vsPrev.textContent = (ch > 0 ? '▲ +' : ch < 0 ? '▼ ' : '') + ch + '%';
        vsPrev.className = ch > 0 ? 'out' : ch < 0 ? 'in' : '';
      } else vsPrev.textContent = '—';
      catCard.lastChild.remove();
      if (!cat.total) {
        catCard.appendChild(h('p', { class: 'muted small' }, 'Chưa có khoản chi nào trong tháng này.'));
      } else {
        var openLedger = function (s) {
          if (s.other) return;
          VG.setLedgerFilter({ period: 'custom', from: from, to: to, category: s.id ? String(s.id) : 'none', kind: 'expense' });
          VG.go('/ledger');
        };
        var slices = C.slicesOf(cat);
        var legend = h('ul', { class: 'legend' }, slices.map(function (s) {
          var dot = h('i', { 'aria-hidden': 'true' });
          dot.style.background = s.color;
          var fill = h('i');
          fill.style.width = Math.max(2, Math.round(s.share * 100)) + '%';
          fill.style.background = s.color;
          return h('li', null, h('button', { type: 'button', class: 'legend-row', disabled: !!s.other, onclick: function () { openLedger(s); } },
            h('span', { class: 'legend-top' }, dot, h('span', { class: 'grow' }, s.name), h('span', { class: 'lbl' }, C.pct(s.share)), h('b', { class: 'amt' }, VG.show(s.amount, { symbol: false }))),
            h('span', { class: 'share-bar', 'aria-hidden': 'true' }, fill)));
        }));
        catCard.appendChild(h('div', { class: 'donut-row' }, C.donut(cat, slices, openLedger), legend));
      }
      barCard.lastChild.remove();
      barCard.appendChild(C.bars(r[1].months, function (m) {
        tipBox.textContent = VG.monthLabel(m.month) + (m.partial ? ' (tính đến hôm nay)' : '') + ': thu ' + VG.show(m.income) + ' · chi ' + VG.show(m.expense);
      }));
      barCard.appendChild(tipBox);
    }).catch(function (e) { catCard.appendChild(h('p', { class: 'msg err' }, e.message)); });
  }

  VG.screens.home = function () {
    var u = VG.state.user;
    var c = VG.shell('/');
    var name = (u.full_name || '').trim();
    var hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date())) % 24;
    var greet = hour < 11 ? 'Chào buổi sáng,' : hour < 14 ? 'Chào buổi trưa,' : hour < 18 ? 'Chào buổi chiều,' : 'Chào buổi tối,';
    c.appendChild(h('div', { class: 'hello' },
      h('span', { class: 'ava', 'aria-hidden': 'true' }, (name.split(' ').pop() || 'V').charAt(0).toUpperCase()),
      h('div', { class: 'grow' }, h('span', { class: 'lbl' }, greet), h('h1', null, name ? name.split(' ').pop() : 'bạn')),
      eyeButton()));
    var books = VG.bookSwitch();
    if (books) c.appendChild(books);
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
      // Cột nhỏ: chi 7 ngày gần nhất (cột trắng là hôm nay)
      var max7 = Math.max.apply(null, (d.last7 || []).map(function (x) { return x.expense; }).concat([1]));
      var spark = h('div', { class: 'spark', 'aria-hidden': 'true' }, (d.last7 || []).map(function (x, i, arr) {
        var bar = h('i', { class: i === arr.length - 1 ? 'now' : null });
        bar.style.height = Math.max(10, Math.round(x.expense / max7 * 100)) + '%';
        return bar;
      }));
      var week = (d.last7 || []).reduce(function (s, x) { return s + x.expense; }, 0);
      body.appendChild(h('a', { href: '#/wallets', class: 'plain' }, h('div', { class: 'card hero' },
        h('span', { class: 'lbl' }, 'Tổng số dư · ' + d.wallet_count + ' ví'),
        h('span', { class: 'big' }, VG.bal(d.total_balance)),
        spark,
        h('div', { class: 'spark-lbl' }, h('span', null, 'Chi 7 ngày: ' + VG.show(week, { symbol: false })), h('span', null, 'Xem từng ví ›')))));

      // Nút nhanh
      if (VG.canWrite()) {
        var QI = { out: ['M12 5v14', 'M6 13l6 6 6-6'], in: ['M12 19V5', 'M6 11l6-6 6 6'], plan: ['M12 3.5a8.5 8.5 0 1 0 8.5 8.5', 'M12 7.5a4.5 4.5 0 1 0 4.5 4.5', 'M12 12l7-7', 'M16 5h3v3'],
          scan: ['M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8', 'M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8', 'M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16', 'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16', 'M4 12h16'] };
        var qicon = function (k) {
          var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
          QI[k].forEach(function (dd) { var pth = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pth.setAttribute('d', dd); s.appendChild(pth); });
          return s;
        };
        var qb = function (k, cls, label, opts) {
          return h('button', { type: 'button', onclick: function () { if (opts.go) VG.go(opts.go); else VG.quickAdd(opts); } }, h('span', { class: 'q ' + cls }, qicon(k)), label);
        };
        body.appendChild(h('div', { class: 'quick' },
          qb('out', 'exp', 'Chi', { mode: 'expense' }), qb('in', 'inc', 'Thu', { mode: 'income' }),
          qb('scan', 'wrn', 'Quét', { mode: 'expense', scan: true }), qb('plan', 'acc', 'Ngân sách', { go: '/plan?tab=budgets' })));
      }

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
      var ALERT_LINK = { bank_pending: '#/bank/pending', budget_warn: '#/plan?tab=budgets', budget_over: '#/plan?tab=budgets', recurring_pending: '#/plan?tab=recurring' };
      d.alerts.forEach(function (a) {
        var href = ALERT_LINK[a.kind] || '#/wallets/' + a.wallet_id;
        var cls = a.kind === 'budget_over' ? 'msg err plain-link' : (a.kind === 'recurring_pending' || a.kind === 'bank_pending') ? 'msg info plain-link' : 'msg warn plain-link';
        body.appendChild(h('a', { href: href, class: cls }, h('span', null, (a.kind === 'recurring_pending' || a.kind === 'bank_pending' ? '🔔 ' : '⚠️ ') + a.text), h('span', { 'aria-hidden': 'true' }, '›')));
      });
      // ===== Bảng điều khiển: biểu đồ ngay ở Tổng quan =====
      var dash = h('div', { class: 'stack' });
      body.appendChild(dash);
      drawDashboard(dash, d);

      // Định kỳ sắp tới trong 7 ngày
      if (d.upcoming && d.upcoming.length) {
        body.appendChild(h('a', { href: '#/plan?tab=recurring', class: 'card plain upcoming' },
          h('div', { class: 'row-between' }, h('b', null, 'Sắp tới trong 7 ngày'), h('span', { class: 'lbl' }, '›')),
          d.upcoming.map(function (x) {
            return h('div', { class: 'row-between small' }, h('span', null, VG.shortDate(x.date) + ' · ' + x.name),
              h('span', { class: 'amt ' + (x.kind === 'income' ? 'in' : 'out') }, (x.kind === 'income' ? '+' : '−') + VG.show(x.amount, { symbol: false })));
          })));
      }

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
  var KINDS = [['', 'Tất cả'], ['expense', 'Chi'], ['income', 'Thu']];
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
    var headers = VG.authHeaders();
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
    var books = VG.bookSwitch();
    if (books) c.appendChild(books);
    var search = h('input', { type: 'search', class: 'search', placeholder: 'Tìm ghi chú, danh mục, số tiền (45k)', value: f.q, 'aria-label': 'Tìm kiếm', enterkeyhint: 'search' });
    var n = activeCount(f);
    var filterBtn = h('button', { type: 'button', class: 'filter-btn' + (n ? ' on' : ''), 'aria-label': 'Bộ lọc' }, VG.icon('filter'), n ? h('b', null, String(n)) : null);
    c.appendChild(h('div', { class: 'search-row' }, h('label', { class: 'search-box' }, VG.icon('search'), search), filterBtn));
    // Lọc nhanh theo loại
    c.appendChild(h('div', { class: 'chips kind-chips' }, [['', 'Tất cả'], ['expense', 'Chi'], ['income', 'Thu']].map(function (k) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String((f.kind || '') === k[0]), onclick: function () {
        f.kind = k[0]; saveFilter(f); VG.rerender();
      } }, k[1]);
    })));
    // Tóm tắt bộ lọc: số giao dịch, thu, chi
    var stCount = h('span', { class: 'lbl' }, ''), stIn = h('b', { class: 'in' }, '…'), stOut = h('b', { class: 'out' }, '…');
    var sumLine = h('div', { class: 'stat-strip' },
      h('div', null, h('span', { class: 'lbl' }, 'Thu'), stIn),
      h('div', null, h('span', { class: 'lbl' }, 'Chi'), stOut),
      h('div', { class: 'stat-count' }, stCount));
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
          stCount.textContent = d.summary.count + ' giao dịch · không tính chuyển giữa ví';
          stIn.textContent = '+' + VG.show(d.summary.income, { symbol: false });
          stOut.textContent = '−' + VG.show(d.summary.expense, { symbol: false });
        }
        all = all.concat(d.transactions);
        cursor = d.next_cursor;
        list.textContent = '';
        if (!all.length) list.appendChild(VG.empty(qs ? '🔍' : '📒', qs ? 'Không có giao dịch khớp bộ lọc' : 'Chưa có giao dịch nào', qs ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá.' : 'Bấm nút + để ghi khoản đầu tiên.'));
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
