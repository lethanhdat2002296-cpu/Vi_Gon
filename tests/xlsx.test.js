import { describe, it, expect } from 'vitest';
import xlsx from '../utils/xlsx.js';
import { unzip, readSheet } from './xlsx-read.js';
const { buildXlsx, crc32, colName, xmlText } = xlsx;

describe('xlsx', () => {
  it('crc32 đúng chuẩn', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xCBF43926);
  });
  it('tên cột', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('escape XML và bỏ ký tự điều khiển', () => {
    expect(xmlText('a<b & "c"\u0001')).toBe('a&lt;b &amp; &quot;c&quot;');
  });
  it('tạo file zip hợp lệ có đủ các phần, CRC khớp, đọc lại đúng ô', () => {
    const buf = buildXlsx({
      sheetName: 'Giao dịch',
      columns: [{ header: 'Ghi chú' }, { header: 'Số tiền', type: 'money' }],
      rows: [['Cà phê <sữa>', -45000], ['Lương', 15000000]],
      footer: [['Tổng', 14955000]]
    });
    const files = unzip(buf);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'
    ]);
    for (const f of Object.values(files)) expect(crc32(f.data)).toBe(f.crc);
    expect(readSheet(buf)).toEqual([
      { _r: 1, A: 'Ghi chú', B: 'Số tiền' },
      { _r: 2, A: 'Cà phê <sữa>', B: -45000 },
      { _r: 3, A: 'Lương', B: 15000000 },
      { _r: 5, A: 'Tổng', B: 14955000 }
    ]);
  });
});
