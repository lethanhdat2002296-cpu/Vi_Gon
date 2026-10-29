import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

// Đọc config trong tiến trình riêng với biến môi trường cho trước
function appUrl(env) {
  const clean = { PATH: process.env.PATH, ...env };
  return execFileSync(process.execPath, ['-e', "process.stdout.write(require('./config').APP_URL)"], { env: clean, cwd: process.cwd() }).toString();
}

describe('APP_URL (gốc link trong email)', () => {
  it('ưu tiên APP_URL, bỏ dấu / cuối', () => {
    expect(appUrl({ APP_URL: 'https://vigon.vn/', VERCEL_PROJECT_PRODUCTION_URL: 'walletapps-zeta.vercel.app' })).toBe('https://vigon.vn');
  });
  it('chưa đặt APP_URL trên Vercel → dùng tên miền Production, không về localhost', () => {
    expect(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'walletapps-zeta.vercel.app' })).toBe('https://walletapps-zeta.vercel.app');
  });
  it('chạy local không có gì → localhost', () => {
    expect(appUrl({})).toBe('http://localhost:3000');
  });
});
