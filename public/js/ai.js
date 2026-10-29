// Trợ lý AI tư vấn tiền (#/ai + bong bóng chat). Mô hình ngôn ngữ chạy NGAY TRÊN MÁY bằng WebLLM + WebGPU:
// không gọi dịch vụ AI nào, số liệu không rời khỏi máy. Máy chủ chỉ đưa số liệu tóm tắt (/api/ai/context).
// Lần đầu tải mô hình (~0,9–1,8 GB) từ Hugging Face; trình duyệt lưu lại cho lần sau.
// Mô hình chạy trong Web Worker (public/js/ai-worker.js) để giao diện không bị đứng khi AI đang nghĩ.
(function (VG) {
  'use strict';
  var h = VG.h;
  var A = window.VGAi;
  // Phiên bản cố định của thư viện (ESM tự chứa, tải từ jsDelivr khi mở trợ lý lần đầu)
  var LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
  // Worker cùng phiên bản với file này (?v=… do bước build gắn) để không dính bản cũ trong cache
  var VERSION = (function () {
    var s = document.querySelector('script[src*="/js/ai.js"]');
    var m = s && s.getAttribute('src').match(/\?v=([\w-]+)/);
    return m ? m[1] : '';
  })();
  var WORKER = '/js/ai-worker.js' + (VERSION ? '?v=' + VERSION : '');
  var MODELS = [
    { key: 'light', name: 'Nhẹ', size: '~0,9 GB', note: 'Nhanh, hợp hầu hết điện thoại', f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' },
    { key: 'smart', name: 'Thông minh hơn', size: '~1,8 GB', note: 'Trả lời tốt hơn, cần máy mạnh', f16: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-3B-Instruct-q4f32_1-MLC' }
  ];
  var MODEL_KEY = 'vigon_ai_model', READY_KEY = 'vigon_ai_ready', HOST_KEY = 'vigon_ai_host';
  var HISTORY_TURNS = 6, KEEP_MESSAGES = 60;
  var SUGGEST = [
    'Mình có 15 triệu, nên chia thế nào cho hợp lý?',
    'Lập kế hoạch chi tiêu cho những ngày còn lại của tháng',
    'Tháng này mình tiêu nhiều nhất vào đâu, nên cắt bớt gì?',
    'Muốn để dành 50 triệu trong 1 năm thì làm sao?'
  ];

  // Trạng thái giữ suốt phiên: mô hình đã nạp dùng chung cho màn #/ai và bong bóng chat
  var S = { lib: null, engine: null, modelId: null, gpu: undefined, busy: false, loading: null, listeners: [], ctx: null, host: null, abort: null };

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  // Lịch sử chat lưu trên máy, riêng từng tài khoản (không gửi lên máy chủ)
  function chatKey() { return 'vigon_ai_chat_' + (VG.state.user ? VG.state.user.id : 'x'); }
  function loadChat() { try { return JSON.parse(localStorage.getItem(chatKey()) || '[]'); } catch (e) { return []; } }
  function saveChat(list) { store(chatKey(), JSON.stringify(list.slice(-KEEP_MESSAGES))); }
  function savedModel() { return read(MODEL_KEY) || 'light'; }

  // Đã tải mô hình trên máy này ít nhất 1 lần
  function deviceReady() { return !!S.engine || !!read(READY_KEY); }
  // Có AI dùng được (trên máy hoặc laptop của chủ app) → hiện bong bóng chat
  VG.aiReady = function () { return deviceReady() || read(HOST_KEY) === '1'; };

  // AI trên laptop của chủ app (tools/ai-host): hỏi máy chủ có nối được không, nhớ 60 giây
  function hostStatus(force) {
    if (!force && S.host && Date.now() - S.host.at < 60000) return Promise.resolve(S.host);
    return VG.api('GET', '/ai/host', null, { fresh: true }).then(function (d) {
      S.host = { at: Date.now(), ok: !!d.ok, configured: !!d.configured, model: d.model };
      store(HOST_KEY, d.ok ? '1' : null);
      return S.host;
    }).catch(function () { S.host = { at: Date.now(), ok: false }; return S.host; });
  }
  // Hỏi AI trên laptop: máy chủ tự gắn số liệu + lời nhắc; nhận chữ từng phần
  function askHost(turns, onText) {
    var ctrl = new window.AbortController();
    S.abort = ctrl;
    var headers = VG.authHeaders();
    headers['Content-Type'] = 'application/json';
    return fetch('/api/ai/chat', { method: 'POST', headers: headers, body: JSON.stringify({ messages: turns }), signal: ctrl.signal }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          var err = new Error(d.error || 'Laptop chưa trả lời được');
          err.hostDown = r.status === 503;
          throw err;
        });
      }
      var reader = r.body.getReader();
      var dec = new window.TextDecoder();
      var text = '';
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) return text;
          text += dec.decode(x.value, { stream: true });
          onText(text);
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (e.name === 'AbortError') return '';
      throw e;
    }).then(function (t) { S.abort = null; return t; }, function (e) { S.abort = null; throw e; });
  }

  // WebGPU + có hỗ trợ số thực 16-bit không (không có thì dùng bản q4f32)
  function gpuInfo() {
    if (S.gpu !== undefined) return Promise.resolve(S.gpu);
    if (!navigator.gpu) { S.gpu = null; return Promise.resolve(null); }
    return navigator.gpu.requestAdapter().then(function (ad) {
      S.gpu = ad ? { f16: ad.features.has('shader-f16') } : null;
      return S.gpu;
    }).catch(function () { S.gpu = null; return null; });
  }
  function lib() {
    if (S.lib) return Promise.resolve(S.lib);
    // import() động: tải thư viện chỉ khi người dùng mở trợ lý
    return import(LIB).then(function (m) { S.lib = m; return m; });
  }
  function modelIdFor(key, gpu) {
    var m = MODELS.filter(function (x) { return x.key === key; })[0] || MODELS[0];
    return gpu && gpu.f16 ? m.f16 : m.f32;
  }

  // Nạp mô hình (1 lần cho cả phiên). onProgress(report) nhận tiến độ; nhiều nơi chờ cùng lúc được.
  function ensureEngine(onProgress) {
    if (S.engine) return Promise.resolve(S.engine);
    if (onProgress) S.listeners.push(onProgress);
    if (S.loading) return S.loading;
    var progress = function (r) { S.listeners.forEach(function (f) { try { f(r); } catch (e) {} }); };
    S.loading = gpuInfo().then(function (gpu) {
      if (!gpu) throw new Error('Máy này chưa hỗ trợ WebGPU');
      var id = modelIdFor(savedModel(), gpu);
      return lib().then(function (L) {
        var cfg = { initProgressCallback: progress };
        var viaWorker;
        try {
          viaWorker = L.CreateWebWorkerMLCEngine(new window.Worker(WORKER, { type: 'module' }), id, cfg);
        } catch (e) { viaWorker = Promise.reject(e); }
        // Trình duyệt không chạy được worker dạng module → chạy ngay trên luồng chính
        return viaWorker.catch(function () { return L.CreateMLCEngine(id, cfg); });
      }).then(function (engine) {
        S.engine = engine; S.modelId = id;
        store(READY_KEY, id);
        return engine;
      });
    });
    S.loading.catch(function () {}).then(function () { S.loading = null; S.listeners = []; });
    return S.loading;
  }

  // Bỏ ký hiệu markdown đơn giản, cắt khối "KẾ HOẠCH:" (đã vẽ thành thẻ riêng)
  function cleanReply(text, hasPlan) {
    var t = String(text || '');
    if (hasPlan) { var i = A.fold(t).search(/ke hoach\s*:/); if (i > 0) t = t.slice(0, i); }
    return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();
  }
  function progressText(r) {
    var t = String(r.text || '');
    var m = t.match(/(\d+)MB fetched/);
    var pct = Math.round((r.progress || 0) * 100);
    if (/Fetching param cache|Loading model from cache/i.test(t)) return (m ? 'Đã tải ' + m[1] + ' MB' : 'Đang nạp mô hình') + ' · ' + pct + '%';
    if (/shader|GPU/i.test(t)) return 'Đang chuẩn bị trên GPU… ' + pct + '%';
    return 'Đang chuẩn bị… ' + pct + '%';
  }

  // ===== Màn #/ai =====
  VG.screens.ai = function () {
    var c = VG.shell('/me');
    var clearBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Xoá cuộc trò chuyện', title: 'Xoá cuộc trò chuyện' }, '↺');
    c.appendChild(VG.topbar('Trợ lý AI', { back: '/me', action: clearBtn }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    clearBtn.addEventListener('click', function () {
      if (!loadChat().length || window.confirm('Xoá toàn bộ cuộc trò chuyện?')) { saveChat([]); VG.route(); }
    });
    Promise.all([hostStatus(true), gpuInfo()]).then(function (r) {
      var host = r[0], gpu = r[1];
      body.textContent = '';
      if (host.ok || deviceReady()) return chatView(body, {});
      if (!gpu) {
        body.appendChild(VG.empty('🧠', host.configured ? 'Trợ lý đang nghỉ' : 'Máy này chưa chạy được AI', host.configured
          ? 'Laptop chạy AI đang tắt hoặc mất mạng, và máy này chưa chạy được AI trực tiếp. Thử lại sau nhé.'
          : 'Trợ lý chạy ngay trên máy nên cần WebGPU. Hãy mở Ví Gọn bằng Chrome bản mới (Android 12 trở lên) hoặc Chrome / Edge trên máy tính.'));
        return;
      }
      setup(body, gpu);
    });
  };

  // ===== Chọn + tải mô hình lần đầu =====
  function setup(body, gpu) {
    var key = savedModel();
    body.appendChild(h('div', { class: 'card hero ai-hero' },
      h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✨'),
      h('b', { class: 'big-sm' }, 'Hỏi cách dùng tiền của bạn'),
      h('span', { class: 'lbl' }, 'AI đọc số liệu thu chi trong Ví Gọn để tư vấn và lập kế hoạch. Chạy ngay trên điện thoại: số liệu không gửi đi đâu.')));
    var status = h('span', { class: 'lbl' });
    var btn = h('button', { type: 'button', class: 'btn' }, 'Tải và bật trợ lý');
    var bar = h('div', { class: 'prog hidden' }, h('i'));
    var pick = VG.chips(MODELS.map(function (m) { return [m.key, m.name + ' · ' + m.size]; }), key, function (k) { key = k; store(MODEL_KEY, k); check(); });
    var note = h('span', { class: 'muted small' });
    function check() {
      var m = MODELS.filter(function (x) { return x.key === key; })[0];
      note.textContent = m.note + '. Lần đầu tải ' + m.size + ' (nên dùng Wi-Fi), lần sau mở ngay.';
      lib().then(function (L) { return L.hasModelInCache(modelIdFor(key, gpu)); }).then(function (has) {
        btn.textContent = has ? 'Bật trợ lý (đã tải sẵn)' : 'Tải và bật trợ lý';
      }).catch(function () {});
    }
    check();
    btn.addEventListener('click', function () {
      store(MODEL_KEY, key);
      btn.disabled = true; pick.classList.add('dimmed');
      bar.className = 'prog';
      status.textContent = 'Đang tải thư viện…';
      ensureEngine(function (r) {
        bar.firstChild.style.width = Math.round((r.progress || 0) * 100) + '%';
        status.textContent = progressText(r);
      }).then(function () { VG.route(); }).catch(function (e) {
        btn.disabled = false; pick.classList.remove('dimmed'); bar.className = 'prog hidden';
        status.textContent = '';
        VG.toast('Không bật được trợ lý: ' + (e && e.message ? e.message.slice(0, 160) : 'lỗi không rõ'), { kind: 'err' });
      });
    });
    body.appendChild(h('div', { class: 'card stack' }, h('b', null, 'Chọn mô hình'), pick, note, bar, status, btn));
  }

  // ===== Trò chuyện (dùng cho cả màn #/ai và bong bóng chat) =====
  function chatView(body, opts) {
    var list = loadChat();
    var box = h('div', { class: 'chat', 'aria-live': 'polite' });
    var input = h('textarea', { class: 'chat-input', rows: '1', placeholder: 'Hỏi về tiền của bạn…', maxlength: '500', 'aria-label': 'Câu hỏi' });
    var send = h('button', { type: 'button', class: 'chat-send', 'aria-label': 'Gửi' }, '➤');
    var loadBar = h('div', { class: 'prog' }, h('i'));
    var loadText = h('span', { class: 'lbl' }, 'Đang mở trợ lý…');
    var loadBox = h('div', { class: 'card ai-loading hidden' }, loadText, loadBar);
    var useHost = function () { return !!(S.host && S.host.ok); };
    var source = h('p', { class: 'lbl center-text' });
    function drawSource() {
      source.textContent = (useHost() ? '💻 AI trên laptop' + (S.host.model ? ' · ' + S.host.model : '') : '✨ AI chạy trên máy') + ' · Gợi ý để tham khảo, bạn tự quyết định nhé.';
    }
    drawSource();
    body.appendChild(source);
    body.appendChild(loadBox);
    body.appendChild(box);
    var chips = h('div', { class: 'chips ai-suggest' }, SUGGEST.map(function (q) {
      return h('button', { type: 'button', class: 'chip', onclick: function () { ask(q); } }, q);
    }));
    body.appendChild(chips);
    body.appendChild(h('div', { class: 'chat-bar' }, input, send));
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
    send.addEventListener('click', function () {
      if (S.busy) {
        if (S.abort) S.abort.abort();
        else if (S.engine) S.engine.interruptGenerate();
        return;
      }
      ask(input.value);
    });

    // AI trên máy: nạp lại mô hình vào GPU (chỉ khi dùng tới; gõ câu hỏi trong lúc chờ được)
    var ready = null;
    function deviceEngine() {
      if (ready) return ready;
      if (!S.engine) loadBox.classList.remove('hidden');
      ready = ensureEngine(function (r) {
        loadBar.firstChild.style.width = Math.round((r.progress || 0) * 100) + '%';
        loadText.textContent = 'Đang mở trợ lý · ' + progressText(r);
      }).then(function (engine) { loadBox.classList.add('hidden'); return engine; });
      ready.catch(function (e) {
        loadText.textContent = 'Không mở được trợ lý: ' + (e && e.message ? e.message.slice(0, 160) : 'lỗi không rõ');
        loadBar.classList.add('hidden');
        // Bộ nhớ đệm mô hình bị xoá → quay lại bước tải
        store(READY_KEY, null);
      });
      return ready;
    }
    if (!useHost() && deviceReady()) deviceEngine();

    function bubble(m) {
      var el = h('div', { class: 'msg-row ' + m.role }, h('div', { class: 'bubble' }));
      var plan = m.role === 'assistant' ? A.parsePlan(m.content) : [];
      el.firstChild.textContent = m.role === 'assistant' ? cleanReply(m.content, plan.length) : m.content;
      if (plan.length) el.appendChild(planCard(A.fitPlan(plan, m.total || 0)));
      return el;
    }
    function draw() {
      box.textContent = '';
      if (!list.length) box.appendChild(h('div', { class: 'msg-row assistant' }, h('div', { class: 'bubble' },
        'Chào bạn 👋 Mình đã xem thu chi trong Ví Gọn. Bạn muốn chia một khoản tiền, lập kế hoạch tháng hay tìm chỗ tiết kiệm?')));
      list.forEach(function (m) { box.appendChild(bubble(m)); });
      chips.className = list.length ? 'hidden' : 'chips ai-suggest';
    }
    function toEnd() { var last = box.lastChild; if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
    draw();
    if (list.length) setTimeout(toEnd, 50);

    function ask(q) {
      q = String(q || '').trim();
      if (!q || S.busy) return;
      input.value = ''; input.style.height = 'auto';
      var total = A.moneyIn(q);
      list.push({ role: 'user', content: q });
      saveChat(list);
      draw();
      var live = h('div', { class: 'msg-row assistant' }, h('div', { class: 'bubble typing' }, useHost() || S.engine ? 'Đang nghĩ…' : 'Chờ trợ lý mở xong…'));
      box.appendChild(live);
      toEnd();
      S.busy = true; send.textContent = '■'; send.setAttribute('aria-label', 'Dừng');
      var onText = function (text) { live.firstChild.className = 'bubble'; live.firstChild.textContent = cleanReply(text, false); };
      // Laptop vừa bật / lâu không dùng phải nạp mô hình (~30 giây) → nói rõ để người dùng chờ
      setTimeout(function () {
        if (live.firstChild.className === 'bubble typing' && useHost()) live.firstChild.textContent = 'Laptop đang khởi động AI, chờ chút nhé (lần đầu ~30 giây)…';
      }, 8000);
      var turns = list.slice(-HISTORY_TURNS - 1, -1).map(function (m) { return { role: m.role, content: m.content }; });
      turns.push({ role: 'user', content: q + (total ? '\n(Số tiền cần chia: ' + VG.fmt(total) + ')' : '') });
      var answer = useHost() ? askHost(turns, onText).catch(function (e) {
        if (!e.hostDown) throw e;
        // Laptop tắt giữa chừng → đánh dấu, dùng AI trên máy nếu có
        S.host = { at: Date.now(), ok: false }; store(HOST_KEY, null); drawSource();
        if (!deviceReady()) throw new Error('Laptop chạy AI đang tắt. Thử lại sau nhé.');
        return askDevice();
      }) : askDevice();
      answer.then(function (text) {
        list.push({ role: 'assistant', content: text || '(Không có câu trả lời)', total: total });
      }).catch(function (e) {
        list.push({ role: 'assistant', content: 'Xin lỗi, mình gặp lỗi: ' + (e && e.message ? e.message.slice(0, 160) : 'không rõ') });
      }).then(function () {
        saveChat(list);
        S.busy = false; send.textContent = '➤'; send.setAttribute('aria-label', 'Gửi');
        draw();
        toEnd();
      });

      function askDevice() {
      var ctxP = S.ctx ? Promise.resolve(S.ctx) : VG.api('GET', '/ai/context', null, { fresh: true }).then(function (d) { S.ctx = d.context; return S.ctx; });
      return Promise.all([deviceEngine(), ctxP])
        .then(function (r) {
          var engine = r[0], cx = r[1];
          live.firstChild.textContent = 'Đang nghĩ…';
          var msgs = [{ role: 'system', content: A.systemPrompt(cx) }].concat(turns);
          return engine.chat.completions.create({ messages: msgs, stream: true, temperature: 0.6, max_tokens: 700 });
        })
        .then(function (stream) {
          var text = '';
          var it = stream[Symbol.asyncIterator]();
          function step() {
            return it.next().then(function (r) {
              if (r.done) return;
              var delta = r.value.choices[0] && r.value.choices[0].delta && r.value.choices[0].delta.content;
              if (delta) { text += delta; onText(text); }
              return step();
            });
          }
          return step().then(function () { return text; });
        });
      }
    }
    if (opts.focus) setTimeout(function () { input.focus(); }, 300);
  }

  // ===== Bong bóng chat nổi (khi đã tải mô hình) =====
  VG.aiBubble = function () {
    if (!VG.aiReady() || /^#\/ai\b/.test(location.hash)) return null;
    var b = h('button', { type: 'button', class: 'ai-fab', 'aria-label': 'Mở trợ lý AI', title: 'Trợ lý AI' }, '✨');
    b.addEventListener('click', openChatSheet);
    return b;
  };
  // Lần đầu mở app: hỏi laptop ở nền để biết có nên hiện bong bóng
  setTimeout(function () { if (VG.getToken()) hostStatus().catch(function () {}); }, 1500);
  function openChatSheet() {
    var body = h('div', { class: 'stack ai-sheet' });
    body.appendChild(h('div', { class: 'row-between' }, h('h2', null, '✨ Trợ lý AI'),
      h('a', { href: '#/ai', class: 'small' }, 'Toàn màn hình ›')));
    var wait = VG.loading();
    body.appendChild(wait);
    VG.openSheet(body);
    hostStatus().then(function () { wait.remove(); chatView(body, { focus: true }); });
  }

  // ===== Thẻ kế hoạch + áp thành ngân sách =====
  function planCard(items) {
    var total = items.reduce(function (s, x) { return s + x.amount; }, 0);
    var card = h('div', { class: 'card plan-ai' },
      h('div', { class: 'row-between' }, h('b', null, '📋 Kế hoạch'), h('b', { class: 'amt' }, VG.fmt(total))));
    items.forEach(function (x) {
      var fill = h('i');
      fill.style.width = Math.max(2, Math.round(x.amount / total * 100)) + '%';
      card.appendChild(h('div', { class: 'plan-line' },
        h('div', { class: 'row-between' }, h('span', null, x.name), h('span', { class: 'amt' }, VG.fmt(x.amount, { symbol: false }) + ' · ' + Math.round(x.amount / total * 100) + '%')),
        h('div', { class: 'prog' }, fill)));
    });
    if (VG.canWrite()) {
      card.appendChild(h('button', { type: 'button', class: 'btn sm', onclick: function () { applyPlan(items); } }, 'Đặt thành ngân sách tháng này'));
    }
    return card;
  }

  function applyPlan(items) {
    Promise.all([VG.api('GET', '/categories'), VG.api('GET', '/budgets/status', null, { fresh: true })]).then(function (r) {
      var cats = r[0].categories.filter(function (x) { return x.kind === 'expense' && !x.parent_id; });
      var byCat = {};
      r[1].budgets.forEach(function (b) { if (b.category_id) byCat[b.category_id] = b; });
      var todo = [], skip = [];
      items.forEach(function (x) {
        var c = A.matchCategory(x.name, cats);
        if (c) todo.push({ cat: c, amount: x.amount, existing: byCat[c.id] || null });
        else skip.push(x.name);
      });
      if (!todo.length) return VG.toast('Không có khoản nào trùng danh mục chi để đặt ngân sách', { kind: 'err' });
      var msg = VG.message();
      var ok = h('button', { type: 'button', class: 'btn' }, 'Đặt ' + todo.length + ' ngân sách');
      VG.openSheet(h('div', { class: 'stack' }, h('h2', null, 'Đặt ngân sách từ kế hoạch'),
        h('div', { class: 'card tight' }, todo.map(function (t) {
          return h('div', { class: 'tx' }, VG.badge(t.cat.icon, t.cat.color, t.cat.name),
            h('span', { class: 't' }, h('b', null, t.cat.name), h('span', { class: 'lbl' }, t.existing ? 'Đổi từ ' + VG.fmt(t.existing.limit) : 'Ngân sách mới')),
            h('span', { class: 'amt' }, VG.fmt(t.amount, { symbol: false })));
        })),
        skip.length ? h('p', { class: 'muted small' }, 'Không phải danh mục chi nên bỏ qua: ' + skip.join(', ') + '. Muốn để dành thì tạo Mục tiêu ở tab Kế hoạch.') : null,
        msg, ok));
      ok.addEventListener('click', function () {
        ok.disabled = true;
        var chain = Promise.resolve();
        todo.forEach(function (t) {
          chain = chain.then(function () {
            return t.existing ? VG.api('PATCH', '/budgets/' + t.existing.id, { amount: t.amount }) : VG.api('POST', '/budgets', { category_id: t.cat.id, amount: t.amount });
          });
        });
        chain.then(function () { VG.closeSheet(); VG.toast('Đã đặt ' + todo.length + ' ngân sách'); })
          .catch(function (e) { ok.disabled = false; msg.show(e.message); });
      });
    }).catch(function (e) { VG.toast(e.message, { kind: 'err' }); });
  }
})(window.VG);
