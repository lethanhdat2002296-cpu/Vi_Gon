import { describe, it, expect } from 'vitest';
import ai from '../public/js/ai-core.js';
const { moneyIn, amountsIn, parsePlan, fitPlan, matchCategory, systemPrompt } = ai;

describe('đọc số tiền trong câu hỏi', () => {
  it('nhiều cách viết', () => {
    expect(moneyIn('Mình đang có 15 triệu, nên chia sao?')).toBe(15_000_000);
    expect(moneyIn('có 15tr thôi')).toBe(15_000_000);
    expect(moneyIn('1,5 củ')).toBe(1_500_000);
    expect(moneyIn('lương 12.500.000đ')).toBe(12_500_000);
    expect(moneyIn('500k ăn sáng')).toBe(500_000);
    expect(moneyIn('2 tỷ')).toBe(2_000_000_000);
    expect(moneyIn('800 nghìn')).toBe(800_000);
    expect(moneyIn('tiết kiệm trong 12 tháng')).toBeNull();
    expect(amountsIn('thu 15 triệu, chi 9 triệu')).toEqual([15_000_000, 9_000_000]);
  });
});

describe('đọc kế hoạch mô hình trả về', () => {
  const reply = `Với 15.000.000 ₫, mình gợi ý như sau nhé:
Bạn nên ưu tiên các khoản thiết yếu trước.

KẾ HOẠCH:
- Nhà ở: 4.500.000 ₫
- **Ăn uống**: 3.500.000đ
- Đi lại: 1 triệu
- Tiết kiệm: 3.000.000
- Dự phòng: 2tr
- Giải trí: 1.000.000 VND
Tổng: 15.000.000 ₫`;
  it('đọc đủ dòng, bỏ dòng tổng', () => {
    expect(parsePlan(reply)).toEqual([
      { name: 'Nhà ở', amount: 4_500_000 }, { name: 'Ăn uống', amount: 3_500_000 }, { name: 'Đi lại', amount: 1_000_000 },
      { name: 'Tiết kiệm', amount: 3_000_000 }, { name: 'Dự phòng', amount: 2_000_000 }, { name: 'Giải trí', amount: 1_000_000 }
    ]);
  });
  it('không có kế hoạch → rỗng', () => {
    expect(parsePlan('Tháng này bạn chi nhiều nhất cho Ăn uống: 3.200.000 ₫.')).toEqual([]);
  });
  it('mô hình cộng sai → chỉnh cho tổng đúng bằng số tiền, tròn 1.000', () => {
    const fixed = fitPlan([{ name: 'A', amount: 5_000_000 }, { name: 'B', amount: 4_000_000 }, { name: 'C', amount: 7_333_333 }], 15_000_000);
    expect(fixed.reduce((s, x) => s + x.amount, 0)).toBe(15_000_000);
    fixed.forEach(x => expect(x.amount % 1000).toBe(0));
    expect(fixed.map(x => x.name)).toEqual(['A', 'B', 'C']);
  });
  it('khớp danh mục không phân biệt dấu', () => {
    const cats = [{ id: 1, name: 'Ăn uống' }, { id: 2, name: 'Đi lại' }, { id: 3, name: 'Nhà ở' }];
    expect(matchCategory('an uong', cats).id).toBe(1);
    expect(matchCategory('Tiền nhà ở', cats).id).toBe(3);
    expect(matchCategory('Tiết kiệm', cats)).toBeNull();
  });
});

describe('lời nhắc hệ thống', () => {
  it('có số liệu thật và yêu cầu khối kế hoạch', () => {
    const p = systemPrompt({
      today: '2026-10-29', days_left: 3, total_balance: 27_450_000, wallets: [{ name: 'Techcombank', balance: 25_000_000 }],
      this_month: { income: 15_000_000, expense: 6_830_000 }, history_months: 3, avg_month: { income: 15_000_000, expense: 9_000_000 },
      avg_by_category: [{ name: 'Ăn uống', amount: 3_500_000 }], budgets: [], goals: [{ name: 'Mua xe', saved: 18_500_000, target: 50_000_000, deadline: '2027-08', monthly_needed: 3_150_000 }],
      debts: { lent: 0, borrowed: 0 }, expense_categories: ['Ăn uống', 'Đi lại']
    });
    expect(p).toContain('27.450.000 ₫');
    expect(p).toContain('KẾ HOẠCH:');
    expect(p).toContain('Ăn uống 3.500.000 ₫');
    expect(p).toContain('Mua xe');
    expect(p).toContain('29/10/2026');
  });
});
