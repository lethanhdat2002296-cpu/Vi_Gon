// Địa chỉ gốc của app để tạo link (webhook, lời mời): APP_URL nếu đã đặt, không thì lấy từ request
const config = require('../config');

function baseUrl(req) {
  if (process.env.APP_URL) return config.APP_URL;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

module.exports = { baseUrl };
