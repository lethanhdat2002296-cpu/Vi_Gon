// Trợ lý AI tư vấn tiền (#/ai). Mô hình ngôn ngữ chạy NGAY TRÊN MÁY bằng WebLLM + WebGPU:
// không gọi dịch vụ AI nào, số liệu không rời khỏi máy. Máy chủ chỉ đưa số liệu tóm tắt (/api/ai/context).
// Lần đầu tải mô hình (~0,9–1,8 GB) từ Hugging Face; trình duyệt lưu lại cho lần sau.
(function (VG) {
  'use strict';
  var h = VG.h;
  var A = window.VGAi;
  // Phiên bản cố định của thư viện (ESM tự chứa, tải từ jsDelivr khi mở trợ lý lần đầu)
  var LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js';
  var MODELS = [
    { key: 'light', name: 'Nhẹ', size: '~0,9 GB', note: 'Nhanh, hợp hầu hết điện thoại', f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' },
    { key: 'smart', name: 'Thông minh hơn', size: '~1,8 GB', note: 'Trả lời tốt hơn, cần máy mạnh', f16: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-3B-Instruct-q4f32_1-MLC' }
  ];
  var CHAT_KEY = 'vigon_ai_chat', MODEL_KEY = 'vigon_ai_model';
  var HISTORY_TURNS = 6;
  var SUGGEST = [
    'Mình có 15 triệu, nên chia thế nào cho hợp lý?',
    'Lập kế hoạch chi tiêu cho những ngày còn lại của tháng',
    'Tháng này mình tiêu nhiều nhất vào đâu, nên cắt bớt gì?',
    'Muốn để dành 50 triệu trong 1 năm thì làm sao?'
  ];

  // Trạng thái giữ suốt phiên (mô hình đã nạp vẫn dùng được khi quay lại màn này)
  var S = { lib: null, engine: null, modelId: null, gpu: undefined, busy: false };

  function loadChat() { try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch (e) { return []; } }
  function saveChat(list) { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(list.slice(-30))); } catch (e) {} }
  function savedModel() { try { return localStorage.getItem(MODEL_KEY) || 'light'; } catch (e) { return 'light'; } }

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

  // Bỏ ký hiệu markdown đơn giản, cắt khối "KẾ HOẠCH:" (đã vẽ thành thẻ riêng)
  function cleanReply(text, hasPlan) {
    var t = String(text || '');
    if (hasPlan) { var i = A.fold(t).search(/ke hoach\s*:/); if (i > 0) t = t.slice(0, i); }
    return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();
  }

  VG.screens.ai = function () {
    var c = VG.shell('/me');
    var clearBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Xoá cuộc trò chuyện', title: 'Xoá cuộc trò chuyện' }, '↺');
    c.appendChild(VG.topbar('Trợ lý AI', { back: '/me', action: clearBtn }));
    var body = h('div', { class: 'stack' }, VG.loading());
    c.appendChild(body);
    clearBtn.addEventListener('click', function () { saveChat([]); VG.route(); });

    gpuInfo().then(function (gpu) {
      body.textContent = '';
      if (!gpu) {
        body.appendChild(VG.empty('🧠', 'Máy này chưa chạy được AI', 'Trợ lý chạy ngay trên máy nên cần WebGPU. Hãy mở Ví Gọn bằng Chrome bản mới (Android 12 trở lên) hoặc Chrome / Edge trên máy tính.'));
        return;
      }
      if (S.engine) return chat(body);
      setup(body, gpu);
    });
  };

  // ===== Tải / bật mô hình =====
  function setup(body, gpu) {
    var key = savedModel();
    var intro = h('div', { class: 'card hero ai-hero' },
      h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✨'),
      h('b', { class: 'big-sm' }, 'Hỏi cách dùng tiền của bạn'),
      h('span', { class: 'lbl' }, 'AI đọc số liệu thu chi trong Ví Gọn để tư vấn và lập kế hoạch. Chạy ngay trên điện thoại: số liệu không gửi đi đâu.'));
    body.appendChild(intro);
    var status = h('span', { class: 'lbl' });
    var btn = h('button', { type: 'button', class: 'btn' }, 'Tải và bật trợ lý');
    var bar = h('div', { class: 'prog hidden' }, h('i'));
    var pick = VG.chips(MODELS.map(function (m) { return [m.key, m.name + ' · ' + m.size]; }), key, function (k) { key = k; check(); });
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
      try { localStorage.setItem(MODEL_KEY, key); } catch (e) {}
      btn.disabled = true; pick.classList.add('dimmed');
      bar.className = 'prog';
      status.textContent = 'Đang tải thư viện…';
      var id = modelIdFor(key, gpu);
      lib().then(function (L) {
        return L.CreateMLCEngine(id, {
          initProgressCallback: function (r) {
            bar.firstChild.style.width = Math.round((r.progress || 0) * 100) + '%';
            status.textContent = progressText(r);
          }
        });
      }).then(function (engine) {
        S.engine = engine; S.modelId = id;
        VG.route();
      }).catch(function (e) {
        btn.disabled = false; pick.classList.remove('dimmed'); bar.className = 'prog hidden';
        status.textContent = '';
        VG.toast('Không bật được trợ lý: ' + (e && e.message ? e.message.slice(0, 160) : 'lỗi không rõ'), { kind: 'err' });
      });
    });
    body.appendChild(h('div', { class: 'card stack' }, h('b', null, 'Chọn mô hình'), pick, note, bar, status, btn));
  }
  function progressText(r) {
    var t = String(r.text || '');
    var m = t.match(/(\d+)MB fetched/);
    var pct = Math.round((r.progress || 0) * 100);
    if (/Fetching param cache|Loading model from cache/i.test(t)) return (m ? 'Đã tải ' + m[1] + ' MB' : 'Đang tải mô hình') + ' · ' + pct + '%';
    if (/shader|GPU|Loading GPU/i.test(t)) return 'Đang chuẩn bị trên GPU… ' + pct + '%';
    return 'Đang chuẩn bị… ' + pct + '%';
  }

  // ===== Trò chuyện =====
  function chat(body) {
    var list = loadChat();
    var box = h('div', { class: 'chat', 'aria-live': 'polite' });
    var input = h('textarea', { class: 'chat-input', rows: '1', placeholder: 'Hỏi về tiền của bạn…', maxlength: '500', 'aria-label': 'Câu hỏi' });
    var send = h('button', { type: 'button', class: 'chat-send', 'aria-label': 'Gửi' }, '➤');
    var ctx = null;
    body.appendChild(h('p', { class: 'lbl center-text' }, '✨ AI chạy trên máy · Gợi ý để tham khảo, bạn tự quyết định nhé.'));
    body.appendChild(box);
    var chips = h('div', { class: 'chips ai-suggest' }, SUGGEST.map(function (q) {
      return h('button', { type: 'button', class: 'chip', onclick: function () { ask(q); } }, q);
    }));
    body.appendChild(chips);
    body.appendChild(h('div', { class: 'chat-bar' }, input, send));
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
    send.addEventListener('click', function () {
      if (S.busy && S.engine) { S.engine.interruptGenerate(); return; }
      ask(input.value);
    });

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
    draw();

    function ask(q) {
      q = String(q || '').trim();
      if (!q || S.busy) return;
      input.value = ''; input.style.height = 'auto';
      var total = A.moneyIn(q);
      list.push({ role: 'user', content: q });
      draw();
      var live = h('div', { class: 'msg-row assistant' }, h('div', { class: 'bubble typing' }, 'Đang nghĩ…'));
      box.appendChild(live);
      live.scrollIntoView({ block: 'end', behavior: 'smooth' });
      S.busy = true; send.textContent = '■'; send.setAttribute('aria-label', 'Dừng');
      (ctx ? Promise.resolve(ctx) : VG.api('GET', '/ai/context', null, { fresh: true }).then(function (d) { ctx = d.context; return ctx; }))
        .then(function (cx) {
          var msgs = [{ role: 'system', content: A.systemPrompt(cx) }];
          list.slice(-HISTORY_TURNS - 1, -1).forEach(function (m) { msgs.push({ role: m.role, content: m.content }); });
          msgs.push({ role: 'user', content: q + (total ? '\n(Số tiền cần chia: ' + VG.fmt(total) + ')' : '') });
          return S.engine.chat.completions.create({ messages: msgs, stream: true, temperature: 0.6, max_tokens: 800 });
        })
        .then(function (stream) {
          var text = '';
          var it = stream[Symbol.asyncIterator]();
          function step() {
            return it.next().then(function (r) {
              if (r.done) return;
              var delta = r.value.choices[0] && r.value.choices[0].delta && r.value.choices[0].delta.content;
              if (delta) {
                text += delta;
                live.firstChild.className = 'bubble';
                live.firstChild.textContent = cleanReply(text, false);
              }
              return step();
            });
          }
          return step().then(function () { return text; });
        })
        .then(function (text) {
          list.push({ role: 'assistant', content: text || '(Không có câu trả lời)', total: total });
          saveChat(list);
        })
        .catch(function (e) {
          list.push({ role: 'assistant', content: 'Xin lỗi, mình gặp lỗi: ' + (e && e.message ? e.message.slice(0, 160) : 'không rõ') });
        })
        .then(function () {
          S.busy = false; send.textContent = '➤'; send.setAttribute('aria-label', 'Gửi');
          draw();
          var last = box.lastChild;
          if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
        });
    }
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
      var cats = r[0].categories.filter(function (x) { return x.kind === 'expense' && !x.parent_id && !x.archived; });
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
