// Quét hoá đơn (F13): chụp/chọn ảnh → đọc chữ bằng Tesseract ngay trên máy → điền sẵn bảng nhập nhanh.
// Ảnh đính kèm được nén < 200 KB trước khi gửi lên.
(function (VG) {
  'use strict';
  var h = VG.h;
  // Phiên bản cố định; tải từ jsDelivr lần đầu dùng (~5 MB, trình duyệt lưu đệm cho lần sau)
  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/';
  var CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1';
  var LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/vie/4.0.0_best_int';
  var MAX_ATTACH = 200 * 1024;
  var workerPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = resolve; s.onerror = function () { reject(new Error('Không tải được bộ đọc chữ. Kiểm tra mạng.')); };
      document.head.appendChild(s);
    });
  }
  function getWorker() {
    if (!workerPromise) {
      workerPromise = (window.Tesseract ? Promise.resolve() : loadScript(TESS + 'tesseract.min.js')).then(function () {
        return window.Tesseract.createWorker('vie', 1, { workerPath: TESS + 'worker.min.js', corePath: CORE, langPath: LANG });
      });
      workerPromise.catch(function () { workerPromise = null; });
    }
    return workerPromise;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { reject(new Error('Không mở được ảnh')); };
      img.src = url;
    });
  }
  function draw(img, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  // Nén JPEG, giảm chất lượng rồi kích thước tới khi < 200 KB. Trả base64 (không có tiền tố data:)
  function compress(img) {
    var sides = [1000, 800, 640, 480];
    for (var i = 0; i < sides.length; i++) {
      var c = draw(img, sides[i]);
      for (var q = 0.8; q >= 0.4; q -= 0.1) {
        var b64 = c.toDataURL('image/jpeg', q).split(',')[1];
        if (b64.length * 3 / 4 <= MAX_ATTACH) return b64;
      }
    }
    return null;
  }

  // Chọn ảnh → onResult({ amount, date, store, image }) ; onStatus(text) báo tiến độ
  VG.scanReceipt = function (onResult, onStatus) {
    var input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      onStatus('Đang mở ảnh…');
      loadImage(f).then(function (img) {
        var image = compress(img);
        onStatus(workerPromise ? 'Đang đọc hoá đơn…' : 'Đang tải bộ đọc chữ (lần đầu ~5 MB)…');
        return getWorker().then(function (w) {
          onStatus('Đang đọc hoá đơn…');
          return w.recognize(draw(img, 1600));
        }).then(function (res) {
          var r = window.VGReceipt.parseReceipt(res.data.text || '');
          r.image = image;
          r.text = res.data.text || '';
          onResult(r);
        });
      }).catch(function (e) { onStatus(''); VG.toast(e.message || 'Không đọc được hoá đơn', { kind: 'err' }); });
    });
    document.body.appendChild(input);
    input.click();
  };

  VG.uploadReceipt = function (txId, b64) {
    return VG.api('PUT', '/transactions/' + txId + '/receipt', { data: b64 });
  };

  // Xem ảnh hoá đơn đã đính (cần header đăng nhập nên tải bằng fetch)
  VG.showReceipt = function (txId) {
    fetch('/api/transactions/' + txId + '/receipt', { headers: VG.authHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('Không có ảnh hoá đơn');
      return r.blob();
    }).then(function (b) {
      var url = URL.createObjectURL(b);
      var del = h('button', { type: 'button', class: 'btn link danger' }, 'Xoá ảnh');
      del.addEventListener('click', function () {
        VG.api('DELETE', '/transactions/' + txId + '/receipt').then(function () { VG.closeSheet(); VG.toast('Đã xoá ảnh'); VG.route(); });
      });
      VG.openSheet(h('div', { class: 'stack' }, h('h2', null, 'Ảnh hoá đơn'), h('img', { src: url, alt: 'Ảnh hoá đơn', class: 'receipt-img' }), del),
        { onClose: function () { URL.revokeObjectURL(url); } });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  };
})(window.VG);
