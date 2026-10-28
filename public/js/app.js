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
    [/^\/plan$/, S.plan],
    [/^\/me$/, S.me],
    [/^\/wallets$/, S.wallets],
    [/^\/wallets\/new$/, S.walletNew],
    [/^\/wallets\/(\d+)$/, S.walletEdit],
    [/^\/categories$/, S.categories],
    [/^\/categories\/new$/, function () { S.categoryEdit(null); }],
    [/^\/categories\/(\d+)$/, S.categoryEdit],
    [/^\/onboarding$/, S.onboarding],
    [/^\/onboarding\/wallet$/, S.onboardingWallet],
    [/^\/onboarding\/categories$/, S.onboardingCategories]
  ];

  function route() {
    var path = (location.hash.replace(/^#/, '').split('?')[0]) || '/';
    if (PUBLIC[path]) {
      // Đã đăng nhập mà mở trang đăng nhập/đăng ký → về trang chính
      if (VG.getToken() && (path === '/login' || path === '/register')) return VG.go('/');
      return PUBLIC[path]();
    }
    if (!VG.getToken()) return VG.go('/login');
    var match = null, screen = S.home;
    PRIVATE.some(function (r) { match = path.match(r[0]); if (match) screen = r[1]; return !!match; });
    var run = function () { screen.apply(null, match ? match.slice(1) : []); };
    if (VG.state.user) return run();
    VG.api('GET', '/me')
      .then(function (d) { VG.state.user = d.user; VG.applyTheme(d.user); run(); })
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
