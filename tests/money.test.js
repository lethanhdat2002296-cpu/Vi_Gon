import { describe, it, expect } from 'vitest';
import money from '../utils/money.js';
const { parseVnd, formatVnd, isValidAmount, MAX_VND } = money;

describe('parseVnd', () => {
  it('đọc số có dấu chấm ngăn nghìn', () => {
    expect(parseVnd('45.000')).toBe(45000);
    expect(parseVnd('1.250.000')).toBe(1250000);
  });
  it('đọc số liền, dấu phẩy, kèm ký hiệu tiền', () => {
    expect(parseVnd('45000')).toBe(45000);
    expect(parseVnd('45,000')).toBe(45000);
    expect(parseVnd(' 45.000 ₫ ')).toBe(45000);
    expect(parseVnd('45.000đ')).toBe(45000);
    expect(parseVnd('45000 VND')).toBe(45000);
  });
  it('nhận number/bigint nguyên', () => {
    expect(parseVnd(45000)).toBe(45000);
    expect(parseVnd(45000n)).toBe(45000);
    expect(parseVnd(0)).toBe(0);
  });
  it('chặn số âm', () => {
    expect(parseVnd('-45000')).toBeNull();
    expect(parseVnd(-1)).toBeNull();
    expect(parseVnd(-1n)).toBeNull();
  });
  it('chặn số không nguyên / nhóm số sai', () => {
    expect(parseVnd(45000.5)).toBeNull();
    expect(parseVnd('45.5')).toBeNull();
    expect(parseVnd('1,5')).toBeNull();
    expect(parseVnd('4.50')).toBeNull();
    expect(parseVnd('1.000,000')).toBeNull();
    expect(parseVnd('1e5')).toBeNull();
    expect(parseVnd(NaN)).toBeNull();
    expect(parseVnd(Infinity)).toBeNull();
  });
  it('chặn rỗng / sai kiểu', () => {
    expect(parseVnd('')).toBeNull();
    expect(parseVnd('abc')).toBeNull();
    expect(parseVnd(null)).toBeNull();
    expect(parseVnd(undefined)).toBeNull();
    expect(parseVnd({})).toBeNull();
  });
  it('chặn vượt 999.999.999.999', () => {
    expect(parseVnd('999.999.999.999')).toBe(MAX_VND);
    expect(parseVnd('1.000.000.000.000')).toBeNull();
    expect(parseVnd(MAX_VND + 1)).toBeNull();
    expect(parseVnd('99999999999999999999999')).toBeNull();
  });
});

describe('isValidAmount', () => {
  it('> 0 và trong giới hạn', () => {
    expect(isValidAmount('45.000')).toBe(true);
    expect(isValidAmount(1)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount(MAX_VND + 1)).toBe(false);
  });
});

describe('formatVnd', () => {
  it('định dạng kiểu Việt Nam', () => {
    expect(formatVnd(45000)).toBe('45.000 ₫');
    expect(formatVnd(1250000)).toBe('1.250.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(999)).toBe('999 ₫');
    expect(formatVnd(MAX_VND)).toBe('999.999.999.999 ₫');
  });
  it('số âm', () => {
    expect(formatVnd(-45000)).toBe('-45.000 ₫');
  });
  it('nhận chuỗi BIGINT từ DB và bigint', () => {
    expect(formatVnd('45000')).toBe('45.000 ₫');
    expect(formatVnd(45000n)).toBe('45.000 ₫');
    expect(formatVnd('-0')).toBe('0 ₫');
  });
  it('bỏ ký hiệu khi cần', () => {
    expect(formatVnd(45000, { symbol: false })).toBe('45.000');
  });
  it('giá trị không hợp lệ → chuỗi rỗng', () => {
    expect(formatVnd(1.5)).toBe('');
    expect(formatVnd('abc')).toBe('');
    expect(formatVnd(null)).toBe('');
  });
  it('parse rồi format giữ nguyên', () => {
    expect(formatVnd(parseVnd('45.000'))).toBe('45.000 ₫');
  });
});
