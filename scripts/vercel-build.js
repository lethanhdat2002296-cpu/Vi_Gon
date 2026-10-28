// Chạy khi Vercel build (vercel.json → buildCommand).
// 1. Gắn ?v=<commit> vào link JS/CSS trong index.html → trình duyệt được giữ file lâu (vercel.json
//    đặt cache 1 năm cho /js, /css) mà bản mới vẫn tải file mới.
// 2. Chạy migration (chỉ Production).
const fs = require('fs');
const path = require('path');
const version = (process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 12);
const indexPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8').replace(/(src|href)="(\/(?:js|css)\/[^"?]+)"/g, `$1="$2?v=${version}"`);
fs.writeFileSync(indexPath, html);
console.log(`Gắn phiên bản tài nguyên: ${version}`);

// Chỉ bản Production mới chạy migration: Preview dùng chung DB nên không được đổi schema
// trước khi PR được merge. Migration lỗi → build lỗi → bản cũ vẫn chạy, không lên bản lệch schema.
if (process.env.VERCEL_ENV !== 'production') {
  console.log(`Bỏ qua migration (VERCEL_ENV=${process.env.VERCEL_ENV || 'local'}).`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('✗ Production thiếu DATABASE_URL.');
  process.exit(1);
}
const { migrate } = require('./migrate');
const pool = require('../lib/db').getPool();
migrate({ pool })
  .then(() => pool.end())
  .catch(e => { console.error('✗', e.message); pool.end().finally(() => process.exit(1)); });
