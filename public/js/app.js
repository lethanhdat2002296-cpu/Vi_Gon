// Router theo hash. Trang công khai: #/login, #/register, #/forgot, #/reset?token=…, #/verify?token=…
// Còn lại cần đăng nhập; lần đầu tải /api/me rồi mới vẽ màn hình.
(function (VG) {
  'use strict';
  var h = VG.h;
  var S = VG.screens;

  var PUBLIC = { '/login': S.login, '/register': S.register, '/forgot': S.forgot, '/reset': S.reset, '/verify': S.verify };
  var PRIVATE = [
    [/^\/$/, S.home],
    [/^\/ledger$/, S.ledger],
    [/^\/reports$/, S.reports],
    [/^\/plan$/, S.plan],
    [/^\/me$/, S.me],
    [/^\/settings$/, S.settings],
    [/^\/bank$/, S.bank],
    [/^\/bank\/pending$/, S.bankPending],
    [/^\/wallets$/, S.wallets],
    [/^\/wallets\/new$/, S.walletNew],
    [/^\/wallets\/(\d+)$/, S.walletEdit],
    [/^\/categories$/, S.categories],
    [/^\/categories\/new$/, function () { S.categoryEdit(null); }],
    [/^\/categories\/(\d+)$/, S.categoryEdit],
    [/^\/onboarding$/, S.onboarding],
    [/^\/onboarding\/wallet$/, S.onboardingWallet],
    [/^\/onboarding\/categories$/, S.onboardingCategories],
    [/^\/books$/, S.books],
    [/^\/books\/(\d+)$/, S.bookDetail],
    [/^\/join\/([A-Za-z0-9_-]{20,64})$/, S.join],
    [/^\/groups$/, S.groups],
    [/^\/groups\/(\d+)$/, S.groupDetail],
    [/^\/debts$/, S.debts],
    [/^\/ai$/, S.ai]
  ];
  var JOIN_KEY = 'vigon_join';

  // Danh sách sổ + sổ đang chọn (sổ đã lưu không còn quyền → về sổ cá nhân)
  function loadBooks() {
    return VG.api('GET', '/books', null, { personal: true }).then(function (d) {
      VG.state.books = d.books;
      var want = VG.state.book ? VG.state.book.id : VG.savedBookId();
      VG.setBook(d.books.filter(function (b) { return b.id === want; })[0] || null);
    });
  }
  VG.loadBooks = loadBooks;

  function route() {
    var path = (location.hash.replace(/^#/, '').split('?')[0]) || '/';
    if (PUBLIC[path]) {
      // Đã đăng nhập mà mở trang đăng nhập/đăng ký → về trang chính
      if (VG.getToken() && (path === '/login' || path === '/register')) return VG.go('/');
      return PUBLIC[path]();
    }
    if (!VG.getToken()) {
      // Mở link mời khi chưa đăng nhập → nhớ lại, đăng nhập xong vào tiếp
      if (/^\/join\//.test(path)) { try { sessionStorage.setItem(JOIN_KEY, path); } catch (e) {} }
      return VG.go('/login');
    }
    var pendingJoin = null;
    try { pendingJoin = sessionStorage.getItem(JOIN_KEY); sessionStorage.removeItem(JOIN_KEY); } catch (e) {}
    if (pendingJoin && pendingJoin !== path) return VG.go(pendingJoin);
    var match = null, screen = S.home;
    PRIVATE.some(function (r) { match = path.match(r[0]); if (match) screen = r[1]; return !!match; });
    // Có PIN và đã lâu không dùng → màn khoá thay cho nội dung
    var run = function () { if (VG.checkLock()) return; screen.apply(null, match ? match.slice(1) : []); };
    if (VG.state.user && VG.state.books) return run();
    Promise.all([VG.state.user ? null : VG.api('GET', '/me', null, { personal: true }), loadBooks()])
      .then(function (r) { if (r[0]) { VG.state.user = r[0].user; VG.applyTheme(r[0].user); } run(); })
      .catch(function (e) {
        if (e.status === 401) return VG.go('/login');
        VG.render(h('div', { class: 'screen' }, h('div', { class: 'center' }, h('div', { class: 'logo' }, 'Ví Gọn'), h('p', { class: 'muted' }, e.message),
          h('button', { class: 'btn', type: 'button', onclick: route }, 'Thử lại'))));
      });
  }

  VG.route = route;
  window.addEventListener('hashchange', route);
  route();
})(window.VG);
