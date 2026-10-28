// Rà soát tự động: liệt kê MỌI route của app; trừ danh sách công khai, gọi khi chưa đăng nhập
// (hoặc với token giả) đều phải bị từ chối 401. Thêm route mới mà quên authRequired → test đỏ.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const app = require('../app.js');

const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/verify-email',
  'POST /api/auth/forgot', 'POST /api/auth/reset',
  // Webhook ngân hàng: không dùng JWT mà kiểm mã bí mật riêng của từng liên kết (test riêng)
  'POST /api/hook/:hookId'
]);

// Đường dẫn mount của router con từ regexp của Express 4
function mountPath(layer) {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    // Tham số trên đường mount (vd /api/transactions/:id/receipt)
    .split('(?:\\/([^/]+?))').join('/:param')
    .replace(/\\(.)/g, '$1');
}

function listRoutes(stack, prefix = '') {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${layer.route.path === '/' ? '' : layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle.stack) {
      out.push(...listRoutes(layer.handle.stack, prefix + mountPath(layer)));
    }
  }
  return out;
}

describe('rà soát: mọi API dữ liệu đều cần đăng nhập', () => {
  let server, base;
  const routes = listRoutes(app._router.stack).filter(r => r.split(' ')[1].startsWith('/api'));
  beforeAll(async () => {
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise(r => server.close(r)));

  it('liệt kê được đủ route (không bỏ sót router con)', () => {
    for (const r of ['GET /api/wallets', 'POST /api/transfers', 'PUT /api/transactions/:param/receipt', 'POST /api/bank/links', 'GET /api/export.xlsx', 'DELETE /api/me', 'POST /api/data/import.json', 'GET /api/reports/monthly']) {
      expect(routes).toContain(r);
    }
    expect(routes.length).toBeGreaterThan(40);
  });

  it('mọi route không công khai trả 401 khi không có token, token sai chữ ký, token hết hạn', async () => {
    const badSig = jwt.sign({ id: 1, tv: 0 }, 'khong-phai-secret-that');
    const expired = jwt.sign({ id: 1, tv: 0, exp: Math.floor(Date.now() / 1000) - 60 }, require('../config.js').JWT_SECRET);
    const checked = [];
    for (const r of routes) {
      if (PUBLIC.has(r)) continue;
      const [method, path] = r.split(' ');
      const url = base + path.replace(/:\w+/g, '1');
      for (const token of [null, badSig, expired]) {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: method === 'GET' ? undefined : '{}'
        });
        expect(res.status, `${r} (${token ? 'token xấu' : 'không token'})`).toBe(401);
      }
      checked.push(r);
    }
    expect(checked.length).toBeGreaterThan(35);
  });
});
