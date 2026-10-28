import { describe, it, expect } from 'vitest';
import balance from '../services/balance.js';
const { computeBalance, totalBalance } = balance;

describe('computeBalance', () => {
  it('số dư đầu + thu − chi', () => {
    expect(computeBalance(1_000_000, [
      { kind: 'income', amount: 500_000 },
      { kind: 'expense', amount: 45_000 },
      { kind: 'expense', amount: '5000' }
    ])).toBe(1_450_000n);
  });
  it('bỏ qua bản ghi đã xoá', () => {
    expect(computeBalance(0, [{ kind: 'expense', amount: 10, deleted_at: new Date() }, { kind: 'income', amount: 3 }])).toBe(3n);
  });
  it('số dư đầu âm (thẻ tín dụng) và BIGINT dạng chuỗi', () => {
    expect(computeBalance('-4340000', [{ kind: 'income', amount: '340000' }])).toBe(-4_000_000n);
  });
  it('số lớn không mất chính xác', () => {
    expect(computeBalance(999_999_999_999, [{ kind: 'income', amount: 999_999_999_999 }])).toBe(1_999_999_999_998n);
  });
});

describe('totalBalance', () => {
  it('bỏ ví ẩn và ví "không tính vào tổng"', () => {
    expect(totalBalance([
      { balance: '100' }, { balance: '50', exclude_from_total: true }, { balance: '7', archived_at: new Date() }, { balance: '-30' }
    ])).toBe(70n);
  });
});
