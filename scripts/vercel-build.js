// Chạy khi Vercel build (vercel.json → buildCommand).
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
