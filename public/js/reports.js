// Báo cáo (F07): chi theo danh mục (biểu đồ tròn), thu/chi 6 tháng (cột), bảng so với kỳ trước.
// Vẽ bằng SVG tự viết (CSP chỉ cho script cùng origin). Màu lấy từ bảng màu đã kiểm mù màu,
// gán theo thứ tự hiển thị; danh mục quá 5 gộp vào "Khác". Mọi màu đi kèm nhãn chữ + bảng số liệu.
(function (VG) {
  'use strict';
  var h = VG.h;
  var NS = 'http://www.w3.org/2000/svg';
  var SLICES = 5;

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    Array.prototype.slice.call(arguments, 2).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // Số gọn cho trục: 450k, 1,2tr (chỉ để hiển thị)
  function compact(n) {
    if (n >= 1000000) {
      var t = Math.round(n / 100000);
      return (t % 10 ? Math.floor(t / 10) + ',' + (t % 10) : String(t / 10)) + 'tr';
    }
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }
  function pct(share) { return (Math.round(share * 1000) / 10).toString().replace('.', ',') + '%'; }

  // ============ KỲ BÁO CÁO ============
  var state = { mode: 'month', anchor: null, from: '', to: '', wallet: '' };
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function range() {
    var a = state.anchor || VG.today();
    var y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
    if (state.mode === 'month') return { from: y + '-' + pad(m) + '-01', to: y + '-' + pad(m) + '-' + pad(lastDay(y, m)), label: VG.monthLabel(a.slice(0, 7)) };
    if (state.mode === 'quarter') {
      var q = Math.floor((m - 1) / 3);
      return { from: y + '-' + pad(q * 3 + 1) + '-01', to: y + '-' + pad(q * 3 + 3) + '-' + pad(lastDay(y, q * 3 + 3)), label: 'Quý ' + (q + 1) + '/' + y };
    }
    if (state.mode === 'year') return { from: y + '-01-01', to: y + '-12-31', label: 'Năm ' + y };
    return { from: state.from, to: state.to, label: fmtDate(state.from) + ' – ' + fmtDate(state.to) };
  }
  function fmtDate(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function shift(dir) {
    var a = state.anchor || VG.today();
    var y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
    var step = state.mode === 'month' ? 1 : state.mode === 'quarter' ? 3 : 12;
    var idx = y * 12 + (m - 1) + dir * step;
    var next = Math.floor(idx / 12) + '-' + pad((idx % 12) + 1) + '-01';
    if (next.slice(0, 7) > VG.today().slice(0, 7)) return;
    state.anchor = next;
    VG.route();
  }

  // ============ BIỂU ĐỒ TRÒN ============
  function arcPath(cx, cy, r0, r1, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var p = function (r, a) { return (cx + r * Math.sin(a)).toFixed(2) + ' ' + (cy - r * Math.cos(a)).toFixed(2); };
    if (a1 - a0 >= Math.PI * 2 - 1e-6) {
      // Đủ vòng: vẽ 2 nửa
      return 'M ' + p(r1, 0) + ' A ' + r1 + ' ' + r1 + ' 0 1 1 ' + p(r1, Math.PI) + ' A ' + r1 + ' ' + r1 + ' 0 1 1 ' + p(r1, 0) +
        ' M ' + p(r0, 0) + ' A ' + r0 + ' ' + r0 + ' 0 1 0 ' + p(r0, Math.PI) + ' A ' + r0 + ' ' + r0 + ' 0 1 0 ' + p(r0, 0) + ' Z';
    }
    return 'M ' + p(r1, a0) + ' A ' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + p(r1, a1) +
      ' L ' + p(r0, a1) + ' A ' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + p(r0, a0) + ' Z';
  }

  function slicesOf(data) {
    var top = data.categories.slice(0, SLICES);
    var rest = data.categories.slice(SLICES);
    var out = top.map(function (c, i) { return Object.assign({}, c, { color: 'var(--s' + (i + 1) + ')' }); });
    if (rest.length) {
      var amt = rest.reduce(function (s, c) { return s + c.amount; }, 0);
      out.push({ id: null, other: true, name: 'Khác (' + rest.length + ' danh mục)', amount: amt, share: data.total ? amt / data.total : 0, color: 'var(--s-other)' });
    }
    return out;
  }

  function donut(data, slices, onPick) {
    var size = 200, cx = 100, cy = 100, r1 = 92, r0 = 60;
    var root = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, class: 'donut', role: 'img', 'aria-label': 'Chi theo danh mục, tổng ' + VG.fmt(data.total) });
    var a = 0;
    slices.forEach(function (s) {
      var a1 = a + (s.amount / data.total) * Math.PI * 2;
      var path = svg('path', { d: arcPath(cx, cy, r0, r1, a, a1), class: 'slice', tabindex: '0' }, svg('title', {}, s.name + ': ' + VG.fmt(s.amount) + ' (' + pct(s.share) + ')'));
      path.style.fill = s.color;
      path.addEventListener('click', function () { onPick(s); });
      path.addEventListener('keydown', function (e) { if (e.key === 'Enter') onPick(s); });
      root.appendChild(path);
      a = a1;
    });
    root.appendChild(svg('text', { x: cx, y: cy - 4, class: 'donut-lbl', 'text-anchor': 'middle' }, 'Tổng chi'));
    root.appendChild(svg('text', { x: cx, y: cy + 16, class: 'donut-val', 'text-anchor': 'middle' }, VG.state.user.hide_amounts ? '••••••' : compact(data.total)));
    return root;
  }

  // ============ CỘT THU / CHI THEO THÁNG ============
  function bars(months, tip) {
    var W = 340, H = 180, padL = 36, padB = 22, padT = 8;
    var max = Math.max.apply(null, months.map(function (m) { return Math.max(m.income, m.expense); }).concat([1]));
    // Trục y: 3 vạch tròn số
    var stepRaw = max / 3;
    var mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
    var step = [1, 2, 2.5, 5, 10].map(function (k) { return k * mag; }).filter(function (s) { return s >= stepRaw; })[0];
    var top = step * 3;
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / top); };
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'bars', role: 'img', 'aria-label': 'Thu và chi ' + months.length + ' tháng gần nhất' });
    for (var i = 0; i <= 3; i++) {
      var gy = y(step * i);
      root.appendChild(svg('line', { x1: padL, x2: W, y1: gy, y2: gy, class: i ? 'grid' : 'axis' }));
      if (i) root.appendChild(svg('text', { x: padL - 6, y: gy + 4, class: 'tick', 'text-anchor': 'end' }, VG.state.user.hide_amounts ? '•' : compact(step * i)));
    }
    var gw = (W - padL) / months.length, bw = Math.min(14, gw / 3.2);
    months.forEach(function (m, idx) {
      var gx = padL + gw * idx + gw / 2;
      [['income', -bw / 2 - 1, 'bar-in'], ['expense', bw / 2 + 1, 'bar-out']].forEach(function (b) {
        var v = m[b[0]];
        if (!v) return;
        var x = gx + b[1] - bw / 2, top0 = y(v), base = y(0), r = Math.min(4, (base - top0) / 2, bw / 2);
        // Bo góc 4px ở đầu cột, đáy vuông nằm trên trục
        var d = 'M' + x + ' ' + base + 'V' + (top0 + r) + 'Q' + x + ' ' + top0 + ' ' + (x + r) + ' ' + top0 + 'H' + (x + bw - r) +
          'Q' + (x + bw) + ' ' + top0 + ' ' + (x + bw) + ' ' + (top0 + r) + 'V' + base + 'Z';
        root.appendChild(svg('path', { d: d, class: b[2] }));
      });
      root.appendChild(svg('text', { x: gx, y: H - 6, class: 'tick' + (m.partial ? ' strong' : ''), 'text-anchor': 'middle' }, 'T' + Number(m.month.slice(5)) + (m.partial ? '*' : '')));
      // Vùng bấm rộng hơn cột để xem số
      var hit = svg('rect', { x: gx - gw / 2, y: 0, width: gw, height: H, class: 'hit', tabindex: '0' });
      var show = function () { tip(m); };
      hit.addEventListener('click', show);
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      root.appendChild(hit);
    });
    return root;
  }

  // ============ MÀN BÁO CÁO ============
  VG.screens.reports = function () {
    var qm = VG.queryParam('month');
    if (qm && /^\d{4}-\d{2}$/.test(qm)) { state.mode = 'month'; state.anchor = qm + '-01'; }
    var c = VG.shell('/');
    c.appendChild(VG.topbar('Báo cáo', { back: '/' }));

    var r = range();
    if (state.mode === 'custom' && (!r.from || !r.to)) {
      state.to = VG.today(); state.from = VG.addDays(state.to, -29); r = range();
    }
    var seg = VG.seg([['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm'], ['custom', 'Tự chọn']], state.mode, function (m) {
      state.mode = m; VG.route();
    });
    c.appendChild(seg);
    var partial = r.to >= VG.today();
    if (state.mode === 'custom') {
      var fromI = h('input', { id: 'r-from', type: 'date', value: state.from, max: VG.today() });
      var toI = h('input', { id: 'r-to', type: 'date', value: state.to, max: VG.today() });
      var apply = h('button', { type: 'button', class: 'btn ghost' }, 'Xem');
      apply.addEventListener('click', function () {
        if (!fromI.value || !toI.value || fromI.value > toI.value) return VG.toast('Chọn khoảng ngày hợp lệ', { kind: 'err' });
        state.from = fromI.value; state.to = toI.value; VG.route();
      });
      c.appendChild(h('div', { class: 'split' }, VG.field('Từ ngày', fromI), VG.field('Đến ngày', toI)));
      c.appendChild(apply);
    } else {
      var nextDisabled = r.to >= VG.today();
      c.appendChild(h('div', { class: 'row-between period' },
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Kỳ trước', onclick: function () { shift(-1); } }, '‹'),
        h('div', { class: 'center-text' }, h('b', null, r.label), partial ? h('span', { class: 'lbl block' }, 'tính đến hôm nay') : null),
        h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Kỳ sau', disabled: nextDisabled, onclick: function () { shift(1); } }, '›')));
    }
    var walletSel = h('select', { id: 'r-wallet', 'aria-label': 'Lọc theo ví' }, h('option', { value: '' }, 'Mọi ví'));
    walletSel.addEventListener('change', function () { state.wallet = walletSel.value; VG.route(); });
    c.appendChild(h('div', { class: 'field' }, h('label', { for: 'r-wallet' }, 'Ví'), walletSel));

    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    var qs = 'from=' + r.from + '&to=' + r.to + (state.wallet ? '&wallet=' + state.wallet : '');
    var endMonth = (r.to < VG.today() ? r.to : VG.today()).slice(0, 7);
    Promise.all([
      VG.api('GET', '/reports/by-category?' + qs),
      VG.api('GET', '/reports/monthly?months=6&end=' + endMonth + (state.wallet ? '&wallet=' + state.wallet : '')),
      VG.api('GET', '/wallets?include_archived=1')
    ]).then(function (res) {
      var cat = res[0], monthly = res[1].months;
      res[2].wallets.forEach(function (w) {
        var o = h('option', { value: String(w.id) }, w.name);
        if (String(w.id) === state.wallet) o.selected = true;
        walletSel.appendChild(o);
      });
      body.textContent = '';

      // Bấm 1 phần → mở Sổ đã lọc theo danh mục và kỳ này
      function openLedger(s) {
        if (s.other) return;
        VG.setLedgerFilter({ period: 'custom', from: r.from, to: r.to > VG.today() ? VG.today() : r.to, category: s.id ? String(s.id) : 'none', kind: 'expense', wallet: state.wallet });
        VG.go('/ledger');
      }

      var card = h('div', { class: 'card' }, h('b', null, 'Chi theo danh mục'));
      if (!cat.total) {
        card.appendChild(h('p', { class: 'muted small' }, 'Chưa có khoản chi nào trong kỳ này.'));
      } else {
        var slices = slicesOf(cat);
        var legend = h('ul', { class: 'legend' }, slices.map(function (s) {
          var dot = h('i', { 'aria-hidden': 'true' });
          dot.style.background = s.color;
          return h('li', null, h('button', { type: 'button', class: 'legend-row', disabled: !!s.other, onclick: function () { openLedger(s); } },
            dot, h('span', { class: 'grow' }, s.name), h('span', { class: 'lbl' }, pct(s.share)), h('b', { class: 'amt' }, VG.show(s.amount, { symbol: false }))));
        }));
        card.appendChild(h('div', { class: 'donut-row' }, donut(cat, slices, openLedger), legend));
        card.appendChild(h('p', { class: 'lbl' }, 'Tổng chi ' + VG.show(cat.total) + ' · không tính chuyển giữa ví và điều chỉnh số dư. Bấm một phần để xem giao dịch.'));
      }
      body.appendChild(card);

      // Cột thu/chi 6 tháng + chú thích + ô số khi bấm
      var tipBox = h('p', { class: 'small tip' }, 'Bấm vào một tháng để xem số.');
      var tip = function (m) {
        tipBox.textContent = VG.monthLabel(m.month) + (m.partial ? ' (tính đến hôm nay)' : '') + ': thu ' + VG.show(m.income) + ' · chi ' + VG.show(m.expense);
      };
      body.appendChild(h('div', { class: 'card' },
        h('div', { class: 'row-between' }, h('b', null, 'Thu, chi 6 tháng'),
          h('span', { class: 'legend-inline' }, h('i', { class: 'bar-in-dot' }), 'Thu', h('i', { class: 'bar-out-dot' }), 'Chi')),
        bars(monthly, tip), tipBox));

      // Bảng danh mục: số tiền, tỉ lệ, tăng giảm so với kỳ trước
      if (cat.categories.length) {
        var table = h('table', { class: 'rtable' },
          h('thead', null, h('tr', null, h('th', null, 'Danh mục'), h('th', { class: 'num' }, 'Số tiền'), h('th', { class: 'num' }, 'Tỉ lệ'), h('th', { class: 'num' }, 'So kỳ trước'))),
          h('tbody', null, cat.categories.map(function (x) {
            var ch = x.change;
            return h('tr', null,
              h('td', null, (x.icon ? x.icon + ' ' : '') + x.name),
              h('td', { class: 'num' }, VG.show(x.amount, { symbol: false })),
              h('td', { class: 'num' }, pct(x.share)),
              h('td', { class: 'num ' + (ch > 0 ? 'out' : ch < 0 ? 'in' : 'muted') }, ch === 0 ? '—' : (ch > 0 ? '▲ +' : '▼ −') + VG.show(Math.abs(ch), { symbol: false })));
          })));
        body.appendChild(h('div', { class: 'card' }, h('b', null, 'Bảng danh mục'),
          h('p', { class: 'lbl' }, 'So với ' + fmtDate(cat.prev.from) + ' – ' + fmtDate(cat.prev.to) + ' (chi ' + VG.show(cat.prev_total) + ')'),
          h('div', { class: 'table-wrap' }, table)));
      }
    }).catch(function (e) { VG.fail(body, e); });
  };
})(window.VG);
