// Ví Gọn - client. Bước 1: chỉ kiểm tra /api/health.
(function () {
  var el = document.getElementById('health');
  if (!el) return;
  fetch('/api/health')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      el.textContent = d.ok ? 'Máy chủ: hoạt động' : 'Máy chủ: chưa kết nối được dữ liệu';
      el.className = 'status ' + (d.ok ? 'ok' : 'bad');
    })
    .catch(function () {
      el.textContent = 'Máy chủ: không phản hồi';
      el.className = 'status bad';
    });
})();
