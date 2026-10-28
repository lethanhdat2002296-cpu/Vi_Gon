import { describe, it, expect } from 'vitest';
import bank from '../services/bank.js';
const { learnKeyword, suggestCategory, suggestTransferWallet, parseSepay, hashSecret, checkApiKey } = bank;

const cats = [
  { id: 1, name: 'Ăn uống', kind: 'expense', parent_id: null }, { id: 2, name: 'Ăn ngoài', kind: 'expense', parent_id: 1 },
  { id: 3, name: 'Cà phê', kind: 'expense', parent_id: 1 }, { id: 4, name: 'Đi lại', kind: 'expense', parent_id: null },
  { id: 5, name: 'Grab, taxi', kind: 'expense', parent_id: 4 }, { id: 6, name: 'Mua sắm', kind: 'expense', parent_id: null },
  { id: 7, name: 'Lương', kind: 'income', parent_id: null }, { id: 8, name: 'Điện', kind: 'expense', parent_id: 9 },
  { id: 9, name: 'Nhà ở', kind: 'expense', parent_id: null }
];

describe('gợi ý danh mục', () => {
  it('GRAB → Đi lại (Grab, taxi), SHOPEE → Mua sắm, "luong" → Lương', () => {
    expect(suggestCategory('GRAB*A-7Q2XK HCM', 'expense', cats).category_id).toBe(5);
    expect(suggestCategory('SHOPEEPAY THANH TOAN DON HANG', 'expense', cats).category_id).toBe(6);
    expect(suggestCategory('CTY ABC CHUYEN LUONG THANG 10', 'income', cats).category_id).toBe(7);
  });
  it('từ khoá dài thắng: GRABFOOD → Ăn ngoài, không phải Grab', () => {
    expect(suggestCategory('GRABFOOD ORDER 123', 'expense', cats).category_id).toBe(2);
  });
  it('có dấu / không dấu như nhau; thiếu mục con thì về danh mục cha', () => {
    expect(suggestCategory('Thanh toán tiền điện EVN HCMC', 'expense', cats).category_id).toBe(8);
    const noCafe = cats.filter(c => c.name !== 'Cà phê');
    expect(suggestCategory('HIGHLANDS COFFEE Q3', 'expense', noCafe).category_id).toBe(1);
  });
  it('luật đã học thắng luật mặc định; không khớp thì null', () => {
    expect(suggestCategory('GRAB*XYZ', 'expense', cats, [{ keyword: 'grab', kind: 'expense', category_id: 6, hits: 2 }])).toMatchObject({ category_id: 6, by: 'learned' });
    expect(suggestCategory('NGUYEN VAN A CHUYEN TIEN', 'expense', cats)).toBeNull();
    expect(suggestCategory('GRAB', 'income', cats)).toBeNull();
  });
  it('từ khoá để học bỏ từ phổ biến, số', () => {
    expect(learnKeyword('GRAB*A-7Q2XK HCM')).toBe('grab');
    expect(learnKeyword('HIGHLANDS COFFEE Q3')).toBe('highlands');
    expect(learnKeyword('THANH TOAN THE VPBANK')).toBe('vpbank');
    expect(learnKeyword('CK 123456')).toBeNull();
  });
  it('nhận ra chuyển sang ví khác của mình', () => {
    const wallets = [{ id: 1, name: 'Techcombank' }, { id: 2, name: 'Thẻ VPBank' }, { id: 3, name: 'Tiền mặt' }];
    expect(suggestTransferWallet('THANH TOAN THE VPBANK', wallets, 1)).toBe(2);
    expect(suggestTransferWallet('GRAB HCM', wallets, 1)).toBeNull();
    expect(suggestTransferWallet('TECHCOMBANK', wallets, 1)).toBeNull();
  });
});

describe('payload SePay', () => {
  const sample = {
    id: 92704, gateway: 'Vietcombank', transactionDate: '2024-07-02 11:08:33', accountNumber: '1017588888', subAccount: '',
    code: null, content: 'GRAB*A-7Q2XK HCM', transferType: 'out', description: 'GRAB*A-7Q2XK HCM', transferAmount: 56000, accumulated: 105000000, referenceCode: 'FT24012345678'
  };
  it('đọc đúng: mã duy nhất, loại, số tiền, giờ VN, 4 số cuối', () => {
    const p = parseSepay(sample);
    expect(p).toMatchObject({ ref: 'sepay:92704', kind: 'expense', amount: 56000, note: 'GRAB*A-7Q2XK HCM', account_last4: '8888' });
    expect(p.occurred_at.toISOString()).toBe('2024-07-02T04:08:33.000Z');
    expect(parseSepay({ ...sample, transferType: 'in' }).kind).toBe('income');
  });
  it('chặn dữ liệu sai', () => {
    for (const bad of [null, {}, { ...sample, id: undefined }, { ...sample, transferType: 'x' }, { ...sample, transferAmount: -5 },
      { ...sample, transferAmount: 1.5 }, { ...sample, transferAmount: '56000' }]) {
      expect(parseSepay(bad).error).toBeTruthy();
    }
  });
  it('kiểm Apikey', () => {
    const h = hashSecret('bi-mat');
    expect(checkApiKey('Apikey bi-mat', h)).toBe(true);
    expect(checkApiKey('apikey  bi-mat ', h)).toBe(true);
    expect(checkApiKey('Apikey sai', h)).toBe(false);
    expect(checkApiKey('Bearer bi-mat', h)).toBe(false);
    expect(checkApiKey(undefined, h)).toBe(false);
  });
});
