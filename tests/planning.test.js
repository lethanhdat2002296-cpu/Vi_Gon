import { describe, it, expect } from 'vitest';
import planning from '../services/planning.js';
const { budgetStatus, carryOver, suggestLimit, goalStatus, occurrence, nextAfter, occurrencesBetween, scheduleLabel, monthsBetween } = planning;

describe('ngân sách (F09)', () => {
  it('nghiệm thu: Ăn uống 4.000.000, đã chi 3.440.000 ngày 27/10 → 86%, vàng, ≤ 112.000 ₫/ngày', () => {
    const s = budgetStatus({ limit: 4_000_000, spent: 3_440_000 }, '2026-10', '2026-10-27');
    expect(s.percent).toBe(86);
    expect(s.level).toBe('warn');
    expect(s.days_left).toBe(5);
    expect(s.per_day).toBe(112_000);
  });
  it('xanh < 80%, vàng ≥ 80%, đỏ > 100%', () => {
    expect(budgetStatus({ limit: 1000, spent: 799 }, '2026-10', '2026-10-01').level).toBe('ok');
    expect(budgetStatus({ limit: 1000, spent: 800 }, '2026-10', '2026-10-01').level).toBe('warn');
    expect(budgetStatus({ limit: 1000, spent: 1000 }, '2026-10', '2026-10-01').level).toBe('warn');
    expect(budgetStatus({ limit: 1000, spent: 1001 }, '2026-10', '2026-10-01').level).toBe('over');
  });
  it('đã vượt → mức/ngày 0; tháng cũ không có mức/ngày', () => {
    expect(budgetStatus({ limit: 1000, spent: 1500 }, '2026-10', '2026-10-31')).toMatchObject({ remaining: -500, per_day: 0, days_left: 1 });
    expect(budgetStatus({ limit: 1000, spent: 100 }, '2026-09', '2026-10-05')).toMatchObject({ per_day: null, days_left: null });
  });
  it('chuyển phần chưa tiêu, gợi ý hạn mức', () => {
    expect(carryOver(1000, 300)).toBe(700);
    expect(carryOver(1000, 1300)).toBe(0);
    expect(suggestLimit([3_210_000, 3_500_000, 3_420_000])).toBe(3_380_000);
    expect(suggestLimit([0, 0, 0])).toBeNull();
  });
});

describe('mục tiêu (F10)', () => {
  it('nghiệm thu: 50.000.000, hạn 08/2027, đã có 18.500.000 vào 10/2026 → 37%, cần 3.150.000/tháng', () => {
    const g = goalStatus({ target: 50_000_000, saved: 18_500_000, startMonth: '2026-10', startAmount: 18_500_000, deadline: '2027-08' }, '2026-10');
    expect(g.percent).toBe(37);
    expect(g.months_left).toBe(10);
    expect(g.monthly_needed).toBe(3_150_000);
    expect(g.status).toBe('on_track');
  });
  it('chậm tiến độ kèm số thiếu', () => {
    // Tạo 01/2027 với 0đ, hạn 11/2027 (10 tháng), tới 06/2027 mới có 8.000.000 / 30.000.000
    const g = goalStatus({ target: 30_000_000, saved: 8_000_000, startMonth: '2027-01', startAmount: 0, deadline: '2027-11' }, '2027-06');
    expect(g.status).toBe('behind');
    expect(g.shortfall).toBe(15_000_000 - 8_000_000);
  });
  it('đã đạt; quá hạn chưa đạt', () => {
    expect(goalStatus({ target: 100, saved: 150, startMonth: '2026-01', deadline: '2026-12' }, '2026-05').status).toBe('achieved');
    const late = goalStatus({ target: 100, saved: 40, startMonth: '2026-01', deadline: '2026-03' }, '2026-05');
    expect(late).toMatchObject({ status: 'overdue', months_left: 0, monthly_needed: 60, shortfall: 60 });
  });
  it('hạn là tháng này → cần góp hết phần thiếu', () => {
    expect(goalStatus({ target: 1000, saved: 400, startMonth: '2026-01', deadline: '2026-10' }, '2026-10').monthly_needed).toBe(600);
  });
  it('monthsBetween', () => {
    expect(monthsBetween('2026-10', '2027-08')).toBe(10);
    expect(monthsBetween('2026-12', '2027-01')).toBe(1);
  });
});

describe('lịch định kỳ (F11)', () => {
  it('ngày 31 với tháng ngắn → cuối tháng, rồi quay lại 31', () => {
    const a = '2026-01-31';
    expect([0, 1, 2, 3, 4].map(k => occurrence(a, 'monthly', k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
  it('29/02 hằng năm → 28/02 năm thường', () => {
    expect(occurrence('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
    expect(occurrence('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
  });
  it('hằng tuần', () => {
    expect(occurrence('2026-10-26', 'weekly', 1)).toBe('2026-11-02');
  });
  it('nextAfter: lần kế tiếp sau một ngày', () => {
    expect(nextAfter('2026-01-05', 'monthly', '2026-10-05')).toBe('2026-11-05');
    expect(nextAfter('2026-01-05', 'monthly', '2026-10-04')).toBe('2026-10-05');
    expect(nextAfter('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(nextAfter('2026-10-26', 'weekly', '2026-12-31')).toBe('2027-01-04');
    expect(nextAfter('2020-03-15', 'yearly', '2026-03-15')).toBe('2027-03-15');
  });
  it('các lần trong một khoảng', () => {
    expect(occurrencesBetween('2026-01-05', 'monthly', '2026-11-01', '2026-11-30')).toEqual(['2026-11-05']);
    expect(occurrencesBetween('2026-10-26', 'weekly', '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
    expect(occurrencesBetween('2026-12-05', 'monthly', '2026-11-01', '2026-11-30')).toEqual([]);
  });
  it('mô tả lịch', () => {
    expect(scheduleLabel('2026-01-05', 'monthly')).toBe('Ngày 5 hằng tháng');
    expect(scheduleLabel('2026-10-26', 'weekly')).toBe('Thứ 2 hằng tuần');
    expect(scheduleLabel('2026-03-15', 'yearly')).toBe('Ngày 15/03 hằng năm');
  });
});
