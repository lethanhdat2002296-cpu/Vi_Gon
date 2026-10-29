import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const config = require('../config.js');
const email = require('../utils/email.js');

describe('kiểm SMTP (/api/health?smtp=1)', () => {
  it('chưa cấu hình → báo thiếu, không lộ mật khẩu', async () => {
    const old = { ...config.SMTP };
    Object.assign(config.SMTP, { host: '', user: '', pass: '' });
    const r = await email.checkSmtp();
    Object.assign(config.SMTP, old);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Chưa đặt/);
    expect(JSON.stringify(r)).not.toMatch(/pass"\s*:/);
  });
});
