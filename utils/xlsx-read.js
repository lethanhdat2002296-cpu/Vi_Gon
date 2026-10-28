// Đọc file Excel (.xlsx) tối giản: sheet đầu tiên → mảng dòng { _r: số dòng, A: giá trị, B: ... }.
// Hỗ trợ chuỗi dùng chung (sharedStrings), chuỗi inline, số, đúng/sai. Đọc zip qua central directory
// nên chạy được cả file do Excel, LibreOffice, Google Sheets lưu.
const zlib = require('zlib');

const MAX_UNZIPPED = 30 * 1024 * 1024; // chặn "zip bomb"

function unzip(buf) {
  // Tìm End Of Central Directory từ cuối file
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Không phải file .xlsx hợp lệ');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('File .xlsx bị hỏng');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error('File quá lớn');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('File .xlsx bị hỏng');
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const raw = buf.slice(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : raw;
  }
  return files;
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&amp;/g, '&');
}

// Nội dung chữ của 1 phần tử chuỗi (<si> hoặc <is>): ghép mọi <t>, bỏ phần phiên âm <rPh>
function textOf(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

function firstSheetPath(files) {
  const wb = files['xl/workbook.xml'] && files['xl/workbook.xml'].toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels'] && files['xl/_rels/workbook.xml.rels'].toString('utf8');
  if (wb && rels) {
    const sheet = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || wb.match(/<sheet\b[^>]*\bid="([^"]+)"/);
    if (sheet) {
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${sheet[1]}"`));
      const target = rel && rel.match(/Target="([^"]+)"/);
      if (target) return target[1].startsWith('/') ? target[1].slice(1) : 'xl/' + target[1].replace(/^\.\//, '');
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

function readSheet(buf) {
  const files = unzip(buf);
  const path = firstSheetPath(files);
  if (!files[path]) throw new Error('Không tìm thấy sheet trong file');
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    for (const m of files['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }
  const xml = files[path].toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rNum = rm[1].match(/\br="(\d+)"/);
    const row = { _r: rNum ? Number(rNum[1]) : rows.length + 1 };
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/);
      if (!ref) continue;
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      const inner = cm[2] || '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      let val;
      if (type === 's') val = v ? shared[Number(v[1])] : undefined;
      else if (type === 'inlineStr') val = textOf((inner.match(/<is>([\s\S]*?)<\/is>/) || ['', ''])[1]);
      else if (type === 'str') val = v ? unescapeXml(v[1]) : '';
      else if (type === 'b') val = v ? v[1] === '1' : undefined;
      else if (type === 'e') val = undefined;
      else if (v) val = Number(v[1]);
      if (val !== undefined && val !== '') row[ref[1]] = val;
    }
    rows.push(row);
  }
  return rows;
}

// Số ngày kiểu Excel (hệ 1900) → 'YYYY-MM-DD' và 'HH:MM'
function excelSerialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (isNaN(d)) return null;
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

module.exports = { unzip, readSheet, excelSerialToDate };
