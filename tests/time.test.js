import { describe, it, expect } from 'vitest';
import time from '../utils/time.js';
const { addDays, daysBetween, nowInTimezone, toLocalDateHour, currentMonth, monthRange, addMonths } = time;

describe('addDays', () => {
  it('cộng ngày trong cùng tháng', () => {
    expect(addDays('2026-06-02', 1)).toBe('2026-06-03');
  });
  it('cộng qua ranh giới tháng', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });
  it('trừ qua ranh giới tháng', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
  });
  it('cộng qua ranh giới năm', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('năm nhuận (2024-02-28 + 1 = 02-29)', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('daysBetween', () => {
  it('cùng ngày = 1 (inclusive)', () => {
    expect(daysBetween('2026-06-02', '2026-06-02')).toBe(1);
  });
  it('qua ranh giới tháng', () => {
    expect(daysBetween('2026-05-30', '2026-06-02')).toBe(4);
  });
});

describe('giờ Việt Nam (UTC+7)', () => {
  it('17:30 UTC đã sang ngày hôm sau ở VN', () => {
    const t = nowInTimezone(new Date('2026-06-30T17:30:00Z'));
    expect(t.date).toBe('2026-07-01');
    expect(t.time).toBe('00:30:00');
    expect(t.hour).toBe(0);
  });
  it('16:59 UTC vẫn là ngày cũ ở VN', () => {
    expect(nowInTimezone(new Date('2026-06-30T16:59:00Z')).date).toBe('2026-06-30');
  });
  it('toLocalDateHour đổi timestamp về giờ VN', () => {
    expect(toLocalDateHour('2026-01-01T02:00:00Z')).toEqual({ date: '2026-01-01', hour: 9 });
  });
  it('currentMonth theo giờ VN (giao thừa)', () => {
    expect(currentMonth(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01');
  });
});

describe('monthRange / addMonths', () => {
  it('tháng 2 năm thường và năm nhuận', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
  it('tháng 31 ngày', () => {
    expect(monthRange('2026-12').to).toBe('2026-12-31');
  });
  it('kỳ sai → null', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('2026-1')).toBeNull();
    expect(monthRange(undefined)).toBeNull();
  });
  it('cộng/trừ tháng qua năm', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-06', -6)).toBe('2025-12');
  });
});
