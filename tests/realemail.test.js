import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { checkRealEmail, suggestDomain } = require('../utils/realemail.js');
const { validatePassword } = require('../utils/validators.js');

const err = code => () => Promise.reject(Object.assign(new Error(code), { code }));

describe('kiểm email thật', () => {
  it('gợi ý sửa tên miền gõ nhầm, không đụng tên miền thật gần giống', () => {
    expect(suggestDomain('gmial.com')).toBe('gmail.com');
    expect(suggestDomain('gmail.co')).toBe('gmail.com');
    expect(suggestDomain('yahooo.com')).toBe('yahoo.com');
    expect(suggestDomain('hotmial.com')).toBe('hotmail.com');
    for (const d of ['gmail.com', 'ymail.com', 'mail.com', 'fpt.vn', 'congty.vn']) expect(suggestDomain(d)).toBeNull();
  });
  it('tên miền có MX → ổn; không tồn tại / không có MX / Null MX → từ chối', async () => {
    const mx = async () => [{ exchange: 'mx.congty.vn', priority: 10 }];
    expect(await checkRealEmail('an@congty.vn', { resolveMx: mx })).toBeNull();
    expect(await checkRealEmail('an@congty.vn', { resolveMx: err('ENOTFOUND') })).toMatch(/không nhận được email/);
    expect(await checkRealEmail('an@congty.vn', { resolveMx: err('ENODATA') })).toMatch(/không nhận được email/);
    expect(await checkRealEmail('an@congty.vn', { resolveMx: async () => [{ exchange: '.', priority: 0 }] })).toMatch(/không nhận được email/);
  });
  it('DNS lỗi tạm thời → cho qua (email xác minh chặn tiếp)', async () => {
    expect(await checkRealEmail('an@congty.vn', { resolveMx: err('ETIMEOUT') })).toBeNull();
  });
  it('quy tắc Gmail và email tạm thời', async () => {
    const mx = async () => [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }];
    expect(await checkRealEmail('le.thanh.dat@gmail.com', { resolveMx: mx })).toBeNull();
    expect(await checkRealEmail('abc@gmail.com', { resolveMx: mx })).toMatch(/quy tắc của Gmail/);
    expect(await checkRealEmail('dat_le@gmail.com', { resolveMx: mx })).toMatch(/quy tắc của Gmail/);
    expect(await checkRealEmail('x@yopmail.com', { resolveMx: mx })).toMatch(/email tạm thời/);
  });
});

describe('quy tắc mật khẩu', () => {
  it('đủ 5 điều kiện mới qua', () => {
    expect(validatePassword('Matkhau@123')).toBeNull();
    expect(validatePassword('matkhau123')).toBe('Mật khẩu cần có: chữ hoa, ký tự đặc biệt (vd: @ # ! . _)');
    expect(validatePassword('Ab1!')).toBe('Mật khẩu cần có: ít nhất 8 ký tự');
  });
});
