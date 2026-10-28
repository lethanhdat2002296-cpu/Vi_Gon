import { describe, it, expect } from 'vitest';
import filters from '../services/filters.js';
const { amountQuery, previousPeriod, buildFilter, monthBounds } = filters;

describe('amountQuery', () => {
  it('nhận số tiền gõ tắt', () => {
    expect(amountQuery('45k')).toBe(45000);
    expect(amountQuery('45.000')).toBe(45000);
    expect(amountQuery('45000')).toBe(45000);
    expect(amountQuery('2tr')).toBe(2000000);
    expect(amountQuery('grab')).toBeNull();
    expect(amountQuery('4.5')).toBeNull();
  });
});

describe('previousPeriod', () => {
  it('trọn tháng → tháng trước (kể cả tháng 2)', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('quý, năm', () => {
    expect(previousPeriod('2026-04-01', '2026-06-30')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(previousPeriod('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
  it('tự chọn → lùi đúng số ngày', () => {
    expect(previousPeriod('2026-03-10', '2026-03-16')).toEqual({ from: '2026-03-03', to: '2026-03-09' });
  });
});

describe('buildFilter', () => {
  it('ngày theo giờ VN (+07:00)', () => {
    const f = buildFilter(1, monthBounds('2026-07'));
    expect(f.vals[1].toISOString()).toBe('2026-06-30T17:00:00.000Z');
    expect(f.vals[2].toISOString()).toBe('2026-07-31T17:00:00.000Z');
  });
  it('chặn tham số sai', () => {
    expect(buildFilter(1, { from: '2026-13-01' }).error).toBeTruthy();
    expect(buildFilter(1, { from: '2026-05-02', to: '2026-05-01' }).error).toBeTruthy();
    expect(buildFilter(1, { kind: 'x' }).error).toBeTruthy();
    expect(buildFilter(1, { source: 'x' }).error).toBeTruthy();
    expect(buildFilter(1, { wallet: 'abc' }).error).toBeTruthy();
  });
  it('báo cáo bỏ chuyển tiền và điều chỉnh', () => {
    const f = buildFilter(1, {}, { forReport: true });
    expect(f.where).toContain('t.transfer_group IS NULL');
    expect(f.where).toContain("t.source NOT IN ('adjust', 'debt')");
  });
});
