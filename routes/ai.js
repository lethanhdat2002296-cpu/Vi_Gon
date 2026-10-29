// Trợ lý AI
//   GET  /api/ai/context  số liệu tóm tắt của sổ (cho AI chạy trên điện thoại)
//   GET  /api/ai/host     laptop của chủ app có đang trả lời không (B03)
//   POST /api/ai/chat     hỏi AI trên laptop: máy chủ gắn số liệu + lời nhắc, chuyển qua cổng gác, trả từng chữ
// Không gọi dịch vụ AI bên ngoài nào; laptop chỉ nhận được qua AI_HOST_URL + AI_HOST_TOKEN.
const express = require('express');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const advisor = require('../services/advisor');
const { checkRateLimit } = require('../utils/ratelimit');
const { systemPrompt } = require('../public/js/ai-core');

const router = express.Router();
router.use(authRequired, bookRequired);

const DAY = 24 * 60 * 60 * 1000;
const CHAT_PER_DAY = 80;
const MAX_TURNS = 12;
const MAX_CHARS = 2000;

router.get('/context', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ context: await advisor.buildContext(req.bookId) });
  } catch (e) { next(e); }
});

// Hỏi cổng gác trên laptop; giữ kết quả 20 giây
let hostCache = null;
async function hostStatus() {
  if (!config.AI_HOST_URL || !config.AI_HOST_TOKEN) return { configured: false, ok: false };
  if (hostCache && Date.now() - hostCache.at < 20000) return hostCache.value;
  let value;
  try {
    const r = await fetch(config.AI_HOST_URL + '/health', {
      headers: { Authorization: 'Bearer ' + config.AI_HOST_TOKEN }, signal: AbortSignal.timeout(4000)
    });
    const d = await r.json().catch(() => ({}));
    value = { configured: true, ok: r.ok && !!d.ok, model: d.model || null, installed: d.installed, status: r.status };
  } catch (e) {
    value = { configured: true, ok: false, error: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
  hostCache = { at: Date.now(), value };
  return value;
}

router.get('/host', async (req, res, next) => {
  try {
    const s = await hostStatus();
    res.json({ configured: s.configured, ok: s.ok, model: s.ok ? s.model : null });
  } catch (e) { next(e); }
});

// Chỉ nhận user/assistant từ app; lời nhắc hệ thống do máy chủ tự tạo (không tin dữ liệu gửi lên)
function cleanTurns(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_TURNS) return null;
  const out = [];
  for (const m of list) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, MAX_CHARS);
    if (!content) return null;
    out.push({ role: m.role, content });
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

router.post('/chat', async (req, res, next) => {
  try {
    const turns = cleanTurns((req.body || {}).messages);
    if (!turns) return res.status(400).json({ error: 'Câu hỏi không hợp lệ' });
    if (!config.AI_HOST_URL || !config.AI_HOST_TOKEN) return res.status(503).json({ error: 'Chưa nối trợ lý trên laptop', host: false });
    const rl = await checkRateLimit(`ai-chat:${req.user.id}`, CHAT_PER_DAY, DAY);
    if (!rl.allowed) return res.status(rl.error ? 503 : 429).json({ error: `Đã hỏi ${CHAT_PER_DAY} câu hôm nay, mai hỏi tiếp nhé.` });
    const ctx = await advisor.buildContext(req.bookId);
    const messages = [{ role: 'system', content: systemPrompt(ctx) }, ...turns];

    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort());   // người dùng bấm dừng → dừng laptop sinh chữ
    let up;
    try {
      up = await fetch(config.AI_HOST_URL + '/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.AI_HOST_TOKEN },
        body: JSON.stringify({ messages, max_tokens: 800 }),
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(280000)])
      });
    } catch (e) {
      hostCache = null;
      return res.status(503).json({ error: 'Laptop đang tắt hoặc mất mạng', host: false });
    }
    if (!up.ok || !up.body) { hostCache = null; return res.status(503).json({ error: 'Laptop chưa sẵn sàng (' + up.status + ')', host: false }); }

    // Ollama trả NDJSON { message: { content }, done } → gửi về app chữ thuần, từng phần
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of up.body) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let d;
          try { d = JSON.parse(line); } catch (e) { continue; }
          if (d.message && d.message.content) res.write(d.message.content);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError' && e.name !== 'TimeoutError') console.error('Lỗi đọc trả lời AI:', e.message);
    }
    res.end();
  } catch (e) { next(e); }
});

router.hostStatus = hostStatus;
module.exports = router;
