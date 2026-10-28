// Tính toán thuần cho Kế hoạch (dễ test): ngân sách (F09), mục tiêu (F10), lịch định kỳ (F11).
// Tháng dạng 'YYYY-MM', ngày dạng 'YYYY-MM-DD', tiền là số nguyên VND.

function monthIndex(m) {
  const [y, mm] = m.split('-').map(Number);
  return y * 12 + (mm - 1);
}
// Số tháng từ a đến b (b − a)
function monthsBetween(a, b) {
  return monthIndex(b) - monthIndex(a);
}
function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function pad(n) { return String(n).padStart(2, '0'); }

// ============ NGÂN SÁCH ============
// limit = hạn mức tháng (đã cộng phần chuyển sang nếu có), spent = đã chi trong tháng.
// Mức/ngày = phần còn lại ÷ số ngày còn lại tính cả hôm nay (chỉ cho tháng đang chạy).
function budgetStatus({ limit, spent }, month, today) {
  const pct = limit > 0 ? spent / limit : 0;
  const remaining = limit - spent;
  const level = spent > limit ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  let daysLeft = null, perDay = null;
  if (today.slice(0, 7) === month) {
    const [y, m, d] = today.split('-').map(Number);
    daysLeft = lastDayOfMonth(y, m) - d + 1;
    perDay = remaining > 0 ? Math.floor(remaining / daysLeft) : 0;
  }
  return { limit, spent, remaining, pct: Math.round(pct * 1000) / 1000, percent: Math.floor(pct * 100), level, days_left: daysLeft, per_day: perDay };
}

// Phần chưa tiêu của tháng trước được cộng sang (chỉ 1 tháng, không dồn nhiều tháng)
function carryOver(prevLimit, prevSpent) {
  return Math.max(0, prevLimit - prevSpent);
}

// Gợi ý hạn mức = trung bình chi 3 tháng, làm tròn lên bội 10.000 ₫
function suggestLimit(monthlySpends) {
  const xs = monthlySpends.filter(x => x > 0);
  if (!xs.length) return null;
  const avg = xs.reduce((s, x) => s + x, 0) / monthlySpends.length;
  return Math.ceil(avg / 10000) * 10000;
}

// ============ MỤC TIÊU ============
// Cần góp/tháng = phần thiếu ÷ số tháng còn lại (từ tháng sau đến tháng của hạn).
// Đúng tiến độ nếu đã có ≥ mức kỳ vọng (tăng đều từ lúc tạo tới hạn).
function goalStatus({ target, saved, startMonth, startAmount = 0, deadline }, currentMonth) {
  const have = Math.max(0, saved);
  const pct = target > 0 ? Math.min(1, have / target) : 0;
  const missing = Math.max(0, target - have);
  const monthsLeft = Math.max(0, monthsBetween(currentMonth, deadline));
  if (have >= target) {
    return { pct: 1, percent: 100, missing: 0, months_left: monthsLeft, monthly_needed: 0, status: 'achieved', shortfall: 0 };
  }
  const monthlyNeeded = monthsLeft > 0 ? Math.ceil(missing / monthsLeft) : missing;
  const total = monthsBetween(startMonth, deadline);
  const elapsed = Math.min(Math.max(0, monthsBetween(startMonth, currentMonth)), Math.max(total, 0));
  const expected = total > 0 ? startAmount + Math.floor((target - startAmount) * elapsed / total) : target;
  const overdue = monthsBetween(currentMonth, deadline) < 0;
  const behind = overdue || have < expected;
  return {
    pct: Math.round(pct * 1000) / 1000,
    percent: Math.floor(pct * 100),
    missing,
    months_left: monthsLeft,
    monthly_needed: monthlyNeeded,
    status: overdue ? 'overdue' : behind ? 'behind' : 'on_track',
    shortfall: behind ? Math.max(0, (overdue ? target : expected) - have) : 0
  };
}

// ============ LỊCH ĐỊNH KỲ ============
// Lần thứ k (k = 0 là ngày gốc). Ngày 31 với tháng ngắn → ngày cuối tháng; 29/02 năm thường → 28/02.
function occurrence(anchor, frequency, k) {
  const [y, m, d] = anchor.split('-').map(Number);
  if (frequency === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * k));
    return t.toISOString().slice(0, 10);
  }
  const idx = (y * 12 + (m - 1)) + (frequency === 'yearly' ? 12 * k : k);
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDayOfMonth(ny, nm)))}`;
}

// Lần đến hạn đầu tiên sau ngày `after` (không gồm `after`)
function nextAfter(anchor, frequency, after) {
  // Ước lượng k rồi tiến dần, tránh lặp dài
  const [ay, am] = anchor.split('-').map(Number);
  const [by, bm] = after.split('-').map(Number);
  let k;
  if (frequency === 'weekly') {
    k = Math.max(0, Math.floor((Date.UTC(by, bm - 1, Number(after.slice(8))) - Date.UTC(ay, am - 1, Number(anchor.slice(8)))) / (7 * 86400000)) - 1);
  } else {
    const months = (by * 12 + bm) - (ay * 12 + am);
    k = Math.max(0, Math.floor(months / (frequency === 'yearly' ? 12 : 1)) - 1);
  }
  let date = occurrence(anchor, frequency, k);
  while (date <= after) date = occurrence(anchor, frequency, ++k);
  return date;
}

// Các ngày đến hạn trong [from, to] (gồm 2 đầu), tối đa `limit` lần
function occurrencesBetween(anchor, frequency, from, to, limit = 60) {
  const out = [];
  let d = from <= anchor ? anchor : nextAfter(anchor, frequency, prevDay(from));
  while (d <= to && out.length < limit) {
    out.push(d);
    d = nextAfter(anchor, frequency, d);
  }
  return out;
}
function prevDay(date) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
// "Ngày 5 hằng tháng", "Thứ 2 hằng tuần", "Ngày 15/03 hằng năm"
function scheduleLabel(anchor, frequency) {
  const [, m, d] = anchor.split('-').map(Number);
  if (frequency === 'weekly') return `${WEEKDAYS[new Date(`${anchor}T12:00:00Z`).getUTCDay()]} hằng tuần`;
  if (frequency === 'yearly') return `Ngày ${pad(d)}/${pad(m)} hằng năm`;
  return d >= 29 ? `Ngày ${d} hằng tháng (tháng ngắn: cuối tháng)` : `Ngày ${d} hằng tháng`;
}

module.exports = {
  monthsBetween, lastDayOfMonth, budgetStatus, carryOver, suggestLimit, goalStatus,
  occurrence, nextAfter, occurrencesBetween, scheduleLabel
};
