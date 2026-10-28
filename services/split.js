// Chia tiền nhóm (F15) — hàm thuần, tiền là số nguyên VND.
// Quy tắc: làm tròn 1.000 ₫, phần dư dồn cho người trả. Tổng phải trả = tổng phải nhận.

const ROUND = 1000;
const floorK = n => Math.floor(n / ROUND) * ROUND;

// Phần của từng người trong 1 khoản. shares: [{ member_id, value }]
//   equal: value bỏ qua; amount: value = số tiền (phải cộng đúng amount); ratio: value = trọng số
// Trả { [member_id]: số tiền } hoặc ném lỗi
function expenseShares({ amount, paid_by, split_mode, shares }) {
  const parts = shares.filter(s => split_mode !== 'ratio' || s.value > 0);
  if (!parts.length) throw new Error('Chọn ít nhất 1 người cùng chia');
  const out = {};
  if (split_mode === 'amount') {
    const sum = parts.reduce((s, x) => s + x.value, 0);
    if (sum !== amount) throw new Error(`Tổng các phần (${sum}) phải bằng số tiền (${amount})`);
    parts.forEach(x => { out[x.member_id] = x.value; });
    return out;
  }
  const weights = parts.map(x => (split_mode === 'ratio' ? x.value : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  // Người nhận phần dư: người trả nếu có cùng chia, không thì người có phần lớn nhất
  const payerIn = parts.some(x => Number(x.member_id) === Number(paid_by));
  let absorber = payerIn ? Number(paid_by) : Number(parts[weights.indexOf(Math.max(...weights))].member_id);
  let assigned = 0;
  parts.forEach((x, i) => {
    if (Number(x.member_id) === absorber) return;
    const v = floorK(amount * weights[i] / total);
    out[x.member_id] = v;
    assigned += v;
  });
  out[absorber] = amount - assigned;
  return out;
}

// Số dư từng người: đã trả − phải chịu (+ đã chuyển cho người khác − đã nhận)
//   expenses: [{ amount, paid_by, split_mode, shares }], settlements: [{ from_member, to_member, amount }]
function balances(members, expenses, settlements = []) {
  const bal = {}, paid = {}, owed = {};
  members.forEach(m => { bal[m.id] = 0; paid[m.id] = 0; owed[m.id] = 0; });
  for (const e of expenses) {
    const sh = expenseShares(e);
    paid[e.paid_by] = (paid[e.paid_by] || 0) + e.amount;
    bal[e.paid_by] = (bal[e.paid_by] || 0) + e.amount;
    for (const [mid, v] of Object.entries(sh)) {
      owed[mid] = (owed[mid] || 0) + v;
      bal[mid] = (bal[mid] || 0) - v;
    }
  }
  for (const s of settlements) {
    bal[s.from_member] = (bal[s.from_member] || 0) + s.amount;
    bal[s.to_member] = (bal[s.to_member] || 0) - s.amount;
  }
  return { balance: bal, paid, owed };
}

// Tất toán với ít lần chuyển: ghép đúng cặp bằng nhau trước, rồi ghép người nợ nhiều nhất với người
// được nhận nhiều nhất. Luôn ≤ (số người còn lệch − 1) lần. Trả [{ from, to, amount }]
function settle(balance) {
  const debtors = [], creditors = [];
  for (const [id, v] of Object.entries(balance)) {
    if (v < 0) debtors.push({ id: Number(id), amt: -v });
    else if (v > 0) creditors.push({ id: Number(id), amt: v });
  }
  const out = [];
  // 1) Cặp khớp đúng số tiền → 1 lần chuyển giải quyết 2 người
  for (const d of debtors) {
    const c = creditors.find(x => x.amt === d.amt && x.amt > 0);
    if (c && d.amt > 0) { out.push({ from: d.id, to: c.id, amount: d.amt }); c.amt = 0; d.amt = 0; }
  }
  // 2) Tham lam: lớn nhất với lớn nhất
  for (;;) {
    const d = debtors.filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt || a.id - b.id)[0];
    const c = creditors.filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt || a.id - b.id)[0];
    if (!d || !c) break;
    const amt = Math.min(d.amt, c.amt);
    out.push({ from: d.id, to: c.id, amount: amt });
    d.amt -= amt; c.amt -= amt;
  }
  return out;
}

// URL ảnh VietQR (img.vietqr.io) đúng số tiền + nội dung
function vietQrUrl({ bank_code, account_no, account_name, amount, description }) {
  if (!bank_code || !account_no) return null;
  return 'https://img.vietqr.io/image/' + encodeURIComponent(bank_code) + '-' + encodeURIComponent(account_no) + '-compact2.png'
    + '?amount=' + encodeURIComponent(amount || 0)
    + '&addInfo=' + encodeURIComponent(description || '')
    + '&accountName=' + encodeURIComponent(account_name || '');
}

module.exports = { ROUND, expenseShares, balances, settle, vietQrUrl };
