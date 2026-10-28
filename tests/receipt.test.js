import { describe, it, expect } from 'vitest';
import receipt from '../public/js/receipt.js';
const { parseReceipt, amountsIn } = receipt;

// Chữ OCR mẫu theo kiểu hoá đơn thật (có lỗi OCR thường gặp)
const SAMPLES = [
  ['Bách Hoá Xanh', `BÁCH HOÁ XANH
CN 245 Lê Văn Sỹ · Q3
27/10/2026 18:42
Rau muống ......... 12.000
Thịt ba chỉ 500g ... 79.000
Trứng gà 10 ......... 32.000
Sữa tươi 1L ........ 38.000
TỔNG CỘNG ...... 161.000
Tiền khách đưa 200.000
Tiền thừa 39.000`, 161000, '2026-10-27', 'BÁCH HOÁ XANH'],
  ['WinMart', `WinMart+
Đ/c: 12 Nguyễn Trãi, Q1
Ngày: 05/10/2026 09:15
Mì Hảo Hảo x5     22,500
Nước suối x2      10,000
Tổng tiền hàng:   32,500
Chiết khấu:       -2,500
Tổng thanh toán:  30,000
Khách đưa:        50,000`, 30000, '2026-10-05', 'WinMart+'],
  ['Co.op', `Co.opmart Cống Quỳnh
HD: 00123  Ngay 12-09-2026
SL  Don gia  Thanh tien
2   45000    90000
1   125000   125000
TONG CONG
215000
TIEN KHACH DUA 500000`, 215000, '2026-09-12', 'Co.opmart Cống Quỳnh'],
  ['quán ăn', `QUÁN PHỞ HÀ NỘI
DT: 0909 123 456
Phở bò tái   2   110.000
Trà đá       2    10.000
Cộng tiền hàng   120.000
VAT 8%           9.600
Thanh toán       129.600
Cảm ơn quý khách 01/10/26`, 129600, '2026-10-01', 'QUÁN PHỞ HÀ NỘI'],
  ['lỗi OCR O→0', `CIRCLE K
Total: 45.O00
Cash 100.000
Change 55.000`, 45000, null, 'CIRCLE K'],
  ['không có dòng tổng', `Tiệm tạp hoá Cô Ba
Gạo 10kg 180.000
Dầu ăn 52.000`, 180000, null, 'Tiệm tạp hoá Cô Ba']
];

describe('đọc hoá đơn', () => {
  for (const [name, text, amount, date, store] of SAMPLES) {
    it(name, () => {
      expect(parseReceipt(text)).toEqual({ amount, date, store });
    });
  }
  it('không đọc được → để trống', () => {
    expect(parseReceipt('')).toEqual({ amount: null, date: null, store: '' });
    expect(parseReceipt('ảnh mờ quá')).toMatchObject({ amount: null, date: null });
  });
  it('ngày sai bị bỏ', () => {
    expect(parseReceipt('31/02/2026\nTong 10.000').date).toBeNull();
  });
  it('tách số tiền', () => {
    expect(amountsIn('Phở 110.000 x 2 = 220,000 VAT 8%')).toEqual([110000, 220000]);
    expect(amountsIn('161 000 đ')).toEqual([161000]);
  });
});
