// Đọc lại file .xlsx do utils/xlsx.js tạo (chỉ để test): giải zip + lấy các ô của sheet1.
import zlib from 'zlib';

export function unzip(buf) {
  const files = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 14);
    const csize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const data = buf.slice(p + 30 + nameLen + extra, p + 30 + nameLen + extra + csize);
    files[name] = { data: method === 8 ? zlib.inflateRawSync(data) : data, crc };
    p += 30 + nameLen + extra + csize;
  }
  return files;
}

// Trả mảng dòng, mỗi dòng là { A: giá trị, B: ... } (số → number, chữ → string)
export function readSheet(buf) {
  const xml = unzip(buf)['xl/worksheets/sheet1.xml'].data.toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)) {
    const row = { _r: Number(rm[1]) };
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
      const inner = cm[2] || '';
      const v = inner.match(/<v>(.*?)<\/v>/);
      const t = inner.match(/<t[^>]*>(.*?)<\/t>/);
      if (v) row[cm[1]] = Number(v[1]);
      else if (t) row[cm[1]] = t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    }
    rows.push(row);
  }
  return rows;
}
