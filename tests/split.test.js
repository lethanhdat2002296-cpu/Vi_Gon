import { describe, it, expect } from 'vitest';
import split from '../services/split.js';
const { expenseShares, balances, settle, vietQrUrl } = split;

const D = 1, H = 2, M = 3, T = 4; // Đạt, Hà, Minh, Tú
const members = [{ id: D }, { id: H }, { id: M }, { id: T }];
const all = [D, H, M, T].map(id => ({ member_id: id, value: 1 }));
const sum = o => Object.values(o).reduce((s, x) => s + x, 0);

describe('chia một khoản', () => {
  it('chia đều, làm tròn 1.000, phần dư dồn cho người trả', () => {
    const s = expenseShares({ amount: 100_000, paid_by: D, split_mode: 'equal', shares: [D, H, M].map(id => ({ member_id: id, value: 1 })) });
    expect(s).toEqual({ [H]: 33_000, [M]: 33_000, [D]: 34_000 });
    expect(sum(s)).toBe(100_000);
  });
  it('người trả không cùng chia → dư dồn cho người có phần lớn nhất', () => {
    const s = expenseShares({ amount: 100_000, paid_by: T, split_mode: 'equal', shares: [D, H, M].map(id => ({ member_id: id, value: 1 })) });
    expect(sum(s)).toBe(100_000);
    expect(s[T]).toBeUndefined();
  });
  it('theo số tiền: phải cộng đúng tổng', () => {
    expect(expenseShares({ amount: 300_000, paid_by: D, split_mode: 'amount', shares: [{ member_id: D, value: 100_000 }, { member_id: H, value: 200_000 }] }))
      .toEqual({ [D]: 100_000, [H]: 200_000 });
    expect(() => expenseShares({ amount: 300_000, paid_by: D, split_mode: 'amount', shares: [{ member_id: D, value: 1 }] })).toThrow();
  });
  it('theo tỉ lệ 2:1:1', () => {
    const s = expenseShares({ amount: 1_000_000, paid_by: D, split_mode: 'ratio', shares: [{ member_id: D, value: 2 }, { member_id: H, value: 1 }, { member_id: M, value: 1 }] });
    expect(s).toEqual({ [H]: 250_000, [M]: 250_000, [D]: 500_000 });
  });
  it('không ai cùng chia → lỗi', () => {
    expect(() => expenseShares({ amount: 1000, paid_by: D, split_mode: 'equal', shares: [] })).toThrow();
  });
});

describe('tất toán', () => {
  it('nghiệm thu: 4 người, 6.000.000, Đạt trả 3.300.000, Hà 2.700.000 → Minh và Tú mỗi người trả 1.500.000, ≤ 3 lần chuyển', () => {
    const expenses = [
      { amount: 3_300_000, paid_by: D, split_mode: 'equal', shares: all },
      { amount: 2_700_000, paid_by: H, split_mode: 'equal', shares: all }
    ];
    const b = balances(members, expenses);
    expect(b.owed).toEqual({ [D]: 1_500_000, [H]: 1_500_000, [M]: 1_500_000, [T]: 1_500_000 });
    expect(b.balance).toEqual({ [D]: 1_800_000, [H]: 1_200_000, [M]: -1_500_000, [T]: -1_500_000 });
    const plan = settle(b.balance);
    expect(plan.length).toBeLessThanOrEqual(3);
    const pay = id => plan.filter(p => p.from === id).reduce((s, p) => s + p.amount, 0);
    const get = id => plan.filter(p => p.to === id).reduce((s, p) => s + p.amount, 0);
    expect(pay(M)).toBe(1_500_000);
    expect(pay(T)).toBe(1_500_000);
    expect(get(D)).toBe(1_800_000);
    expect(get(H)).toBe(1_200_000);
  });
  it('tổng phải trả = tổng phải nhận, mọi số dư về 0 sau tất toán (ngẫu nhiên)', () => {
    let seed = 7;
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 200; run++) {
      const n = 2 + rnd(7);
      const ms = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
      const ex = Array.from({ length: 1 + rnd(6) }, () => {
        const parts = ms.filter(() => rnd(3) > 0);
        return { amount: (1 + rnd(5000)) * 1000 + rnd(1000), paid_by: 1 + rnd(n), split_mode: rnd(2) ? 'equal' : 'ratio',
          shares: (parts.length ? parts : ms).map(m => ({ member_id: m.id, value: 1 + rnd(3) })) };
      });
      const b = balances(ms, ex).balance;
      expect(Object.values(b).reduce((s, x) => s + x, 0)).toBe(0);
      const plan = settle(b);
      const after = { ...b };
      plan.forEach(p => { after[p.from] += p.amount; after[p.to] -= p.amount; expect(p.amount).toBeGreaterThan(0); });
      expect(Object.values(after).every(x => x === 0)).toBe(true);
      const nonZero = Object.values(b).filter(x => x !== 0).length;
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
    }
  });
  it('đã trả một phần thì kế hoạch tất toán giảm theo', () => {
    const expenses = [{ amount: 3_300_000, paid_by: D, split_mode: 'equal', shares: all }, { amount: 2_700_000, paid_by: H, split_mode: 'equal', shares: all }];
    const b = balances(members, expenses, [{ from_member: M, to_member: D, amount: 1_500_000 }]).balance;
    expect(b[M]).toBe(0);
    expect(settle(b).reduce((s, p) => s + p.amount, 0)).toBe(1_500_000);
  });
  it('VietQR', () => {
    expect(vietQrUrl({ bank_code: 'TCB', account_no: '1903 666', account_name: 'NGUYEN VAN DAT', amount: 1_500_000, description: 'Da Lat 3N2D' }))
      .toBe('https://img.vietqr.io/image/TCB-1903%20666-compact2.png?amount=1500000&addInfo=Da%20Lat%203N2D&accountName=NGUYEN%20VAN%20DAT');
    expect(vietQrUrl({ bank_code: '', account_no: '1' })).toBeNull();
  });
});
