// Cấu hình - đọc từ environment variables (Vercel + local .env)
// Khi chạy local: load .env qua dotenv (trong server.js)
// Khi chạy Vercel: env vars được set trong Vercel Project Settings

// JWT_SECRET: bắt buộc set thật trong production
const DEFAULT_JWT_SECRET = 'dev-secret-doi-thanh-cua-may-trong-env';
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
if (isProduction) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET bắt buộc phải set trong production. Vào Vercel → Settings → Environment Variables.');
  }
  if (process.env.JWT_SECRET === DEFAULT_JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET phải là chuỗi random 32+ ký tự, không dùng giá trị mặc định.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL bắt buộc phải set trong production (Neon connection string).');
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  JWT_SECRET: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  // Giữ đăng nhập 30 ngày (F01)
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',

  // Link trong email (xác minh, quên mật khẩu, nhắc…). Chưa đặt APP_URL thì dùng tên miền Production
  // Vercel tự cấp (VERCEL_PROJECT_PRODUCTION_URL) để link trong thư không trỏ về localhost.
  APP_URL: (process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')
  ).replace(/\/+$/, ''),

  // Khoá đăng nhập: 15 phút sau 5 lần sai (F01)
  MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  LOCKOUT_SECONDS: parseInt(process.env.LOCKOUT_SECONDS || '900', 10),

  // Bảo vệ /api/cron/* (từ M5)
  CRON_SECRET: process.env.CRON_SECRET || '',

  // Múi giờ app (Vercel chạy UTC, app tính theo giờ Việt Nam)
  TIMEZONE: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',

  // SMTP
  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Ví Gọn <noreply@vigon.local>'
  }
};
