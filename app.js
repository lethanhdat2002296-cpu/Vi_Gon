// Express app - dùng chung cho local dev (server.js) và Vercel function (api/index.js)
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./lib/db');
const config = require('./config');

const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const walletRoutes = require('./routes/wallets');
const categoryRoutes = require('./routes/categories');
const transactionRoutes = require('./routes/transactions');
const quickaddRoutes = require('./routes/quickadd');
const onboardingRoutes = require('./routes/onboarding');
const { summary: summaryRoutes, reports: reportRoutes } = require('./routes/reports');
const exportRoutes = require('./routes/export');
const dataRoutes = require('./routes/data');
const planningRoutes = require('./routes/planning');
const cronRoutes = require('./routes/cron');
const bankRoutes = require('./routes/bank');
const receiptRoutes = require('./routes/receipts');
const bookRoutes = require('./routes/books');
const aiRoutes = require('./routes/ai');
const { groups: groupRoutes, debts: debtRoutes } = require('./routes/sharing');

const app = express();
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

// ============ SECURITY HEADERS ============
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  // CSP: cùng origin + Google Fonts (Be Vietnam Pro) + jsDelivr cho Tesseract quét hoá đơn (script, worker, wasm, dữ liệu chữ)
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; " +
    "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://img.vietqr.io; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// CORS: mặc định cùng origin. Đặt ALLOWED_ORIGINS để cho thêm domain cụ thể.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : false;
app.use(cors({ origin: allowedOrigins }));

// Nhập dữ liệu (JSON sao lưu, file Excel base64) cần body lớn hơn; Vercel giới hạn ~4,5 MB
app.use('/api/data', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '1mb' }));

// Khi chạy local thì serve static từ public/ (trên Vercel do CDN serve)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);  // đăng ký, đăng nhập, email, mật khẩu
app.use('/api/me', meRoutes);      // hồ sơ + cài đặt người đang đăng nhập
app.use('/api/wallets', walletRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/transactions/:id/receipt', receiptRoutes);   // ảnh hoá đơn (< 200 KB, nằm trong giới hạn 1 MB)
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfers', transactionRoutes.transfers);
app.use('/api/quickadd', quickaddRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/export.xlsx', exportRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/budgets', planningRoutes.budgets);
app.use('/api/goals', planningRoutes.goals);
app.use('/api/recurring', planningRoutes.rules);
app.use('/api/hook', bankRoutes.hook);        // CÔNG KHAI: SePay gọi (kiểm mã bí mật mỗi lần)
app.use('/api/bank', bankRoutes.router);
app.use('/api/books', bookRoutes.router);    // sổ chung, thành viên, lời mời
app.use('/api/invites', bookRoutes.invites);
app.use('/api/groups', groupRoutes);          // chia tiền nhóm
app.use('/api/debts', debtRoutes);            // sổ nợ
app.use('/api/ai', aiRoutes);                // số liệu tóm tắt cho trợ lý AI chạy trên máy
app.use('/api/cron', cronRoutes);          // job định kỳ (bảo vệ bằng CRON_SECRET)

// Health check: kiểm tra DB THẬT (uptime monitor phát hiện được sự cố)
// ?smtp=1: thử đăng nhập máy chủ thư (không gửi), kết quả giữ 30 giây để khỏi bị gọi dồn
let smtpCheck = null;
app.get('/api/health', async (req, res) => {
  let smtp;
  let aiHost;
  if (req.query.ai === '1') {
    const s = await aiRoutes.hostStatus();
    aiHost = { configured: s.configured, ok: s.ok, model: s.model || null, error: s.error || (s.ok ? undefined : s.status ? 'status ' + s.status : undefined) };
  }
  if (req.query.smtp === '1') {
    if (!smtpCheck || Date.now() - smtpCheck.at > 30000) smtpCheck = { at: Date.now(), result: await require('./utils/email').checkSmtp() };
    smtp = smtpCheck.result;
  }
  let dbState = 'down', latency = null, migration = null;
  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    dbState = 'up'; latency = Date.now() - t0;
    // Migration mới nhất đã chạy → biết DB đã cập nhật chưa
    const m = await db.query('SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1');
    migration = m.rows[0] ? m.rows[0].filename : null;
  } catch (e) { /* db down hoặc chưa có bảng schema_migrations */ }
  const ok = dbState === 'up';
  res.status(ok ? 200 : 503).json({
    ok,
    db: dbState,
    latency_ms: latency,
    migration,
    has_smtp: !!(config.SMTP.host && config.SMTP.user && config.SMTP.pass),
    app_url: config.APP_URL,   // gốc của link trong email
    smtp,
    ai_host: aiHost,
    server_time: new Date().toISOString()
  });
});

// API không tồn tại → JSON 404 (không trả trang HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Không tìm thấy' });
});

// Trang chính - chỉ áp dụng khi chạy local (Vercel tự xử qua public/)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler: KHÔNG lộ chi tiết lỗi (tên bảng/cột/SQL) ra client ở production
app.use((err, req, res, next) => {
  console.error('[ERR]', req.method, req.originalUrl, '-', (err && err.message) || err);
  const status = (err && (err.status || err.statusCode)) || 500;
  const expose = status < 500 || !isProd;
  res.status(status).json({
    error: expose ? ((err && err.message) || 'Lỗi máy chủ') : 'Lỗi máy chủ. Vui lòng thử lại sau.'
  });
});

module.exports = app;
