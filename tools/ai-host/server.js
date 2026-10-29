// Cổng gác AI chạy trên laptop của chủ app (Windows / Mac / Linux). Không cần cài thư viện, chỉ cần Node.js 18+.
// Chỉ máy chủ Ví Gọn (biết AI_HOST_TOKEN) gọi được; chỉ mở đúng 2 đường:
//   GET  /health   → Ollama có chạy không, mô hình nào
//   POST /v1/chat  → { messages, max_tokens? } → chuyển sang Ollama, trả từng chữ (NDJSON của Ollama)
// Ollama KHÔNG được mở thẳng ra internet: cổng này nghe ở 127.0.0.1, Tailscale Funnel đưa ra ngoài.
//
// Chạy: node server.js   (đọc cấu hình từ file .env cạnh file này hoặc biến môi trường)
//   AI_HOST_TOKEN  bắt buộc, ≥ 32 ký tự (giống biến AI_HOST_TOKEN trên Vercel)
//   OLLAMA_MODEL   mặc định qwen2.5:7b
//   OLLAMA_URL     mặc định http://127.0.0.1:11434
//   PORT           mặc định 8787
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Đọc .env đơn giản (KEY=VALUE mỗi dòng)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* không có .env thì dùng biến môi trường */ }

const TOKEN = process.env.AI_HOST_TOKEN || '';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const PORT = parseInt(process.env.PORT || '8787', 10);
const MAX_BODY = 64 * 1024;
const MAX_TOKENS = 900;

if (TOKEN.length < 32) {
  console.error('✗ Thiếu AI_HOST_TOKEN (≥ 32 ký tự). Chạy: node server.js --new-token để tạo, rồi dán vào file .env');
  if (process.argv.includes('--new-token')) console.log('AI_HOST_TOKEN=' + crypto.randomBytes(24).toString('base64url'));
  process.exit(1);
}

function authorized(req) {
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from('Bearer ' + TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// Chỉ nhận đúng dạng tin nhắn chat, không cho đổi mô hình hay tham số khác từ bên ngoài
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > 20) return null;
  const out = [];
  for (const m of list) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 8000) return null;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    if (!authorized(req)) {
      const got = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (got) console.log('✗ Sai mật khẩu: nhận chuỗi dài', got.length, '· mã kiểm tra', crypto.createHash('sha256').update(got).digest('hex').slice(0, 8));
      return send(res, 401, { error: 'unauthorized' });
    }
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/health') {
      const r = await fetch(OLLAMA + '/api/tags').then(x => x.json()).catch(() => null);
      const models = r && r.models ? r.models.map(m => m.name) : [];
      return send(res, r ? 200 : 503, { ok: !!r && models.includes(MODEL), model: MODEL, installed: models.includes(MODEL), ollama: !!r });
    }
    if (req.method === 'POST' && url === '/v1/chat') {
      const body = JSON.parse(await readBody(req) || '{}');
      const messages = cleanMessages(body.messages);
      if (!messages) return send(res, 400, { error: 'bad_messages' });
      const ctrl = new AbortController();
      res.on('close', () => ctrl.abort());   // người dùng bấm dừng / đóng → dừng sinh chữ
      const up = await fetch(OLLAMA + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, stream: true, keep_alive: '24h',
          options: { temperature: 0.6, num_predict: Math.min(MAX_TOKENS, Number(body.max_tokens) || MAX_TOKENS), num_ctx: 8192 } }),
        signal: ctrl.signal
      });
      if (!up.ok || !up.body) return send(res, 502, { error: 'ollama_' + up.status });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      for await (const chunk of up.body) res.write(chunk);
      res.end();
      console.log(new Date().toLocaleTimeString('vi-VN'), 'trả lời xong sau', ((Date.now() - t0) / 1000).toFixed(1), 'giây');
      return;
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('Lỗi:', e.message);
    if (!res.headersSent) send(res, e.message === 'too_large' ? 413 : 500, { error: 'server_error' });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const check = crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0, 8);
  console.log(`✓ Cổng gác AI Ví Gọn đang chạy: http://127.0.0.1:${PORT} · mô hình ${MODEL}`);
  console.log(`  Mật khẩu: dài ${TOKEN.length}, mã kiểm tra ${check} (phải giống token_check ở /api/health?ai=1)`);
  console.log('  Mở ra internet bằng: tailscale funnel --bg ' + PORT);
  // Nạp sẵn mô hình vào RAM (lần hỏi đầu khỏi chờ ~30 giây), giữ 24 giờ
  console.log('  Đang nạp sẵn mô hình…');
  const t0 = Date.now();
  fetch(OLLAMA + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, keep_alive: '24h' }) })
    .then(r => r.text()).then(() => console.log('  ✓ Mô hình sẵn sàng sau', ((Date.now() - t0) / 1000).toFixed(1), 'giây'))
    .catch(e => console.log('  ✗ Chưa nạp được mô hình (Ollama đã chạy chưa?):', e.message));
});
