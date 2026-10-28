// Email service - SMTP từ env vars
// Nếu SMTP chưa cấu hình: dev → log ra console; production → báo lỗi (không "fake ok")
const nodemailer = require('nodemailer');
const config = require('../config');

const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

let transporter = null;
function getTransporter() {
  if (transporter !== null) return transporter;
  if (config.SMTP.host && config.SMTP.user && config.SMTP.pass) {
    transporter = nodemailer.createTransport({
      host: config.SMTP.host,
      port: config.SMTP.port,
      secure: config.SMTP.secure,
      auth: { user: config.SMTP.user, pass: config.SMTP.pass },
      // Timeout để request không bị treo khi SMTP chậm/chết
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return transporter;
}

// Escape HTML để tránh XSS trong email
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Khung email chung của Ví Gọn
function layout(title, bodyHtml) {
  return `
    <div style="font-family: 'Be Vietnam Pro', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #17211D;">
      <div style="font-weight: 700; font-size: 18px; color: #0D6B5E; margin-bottom: 16px;">Ví Gọn</div>
      <h2 style="font-size: 20px; margin: 0 0 12px;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      <p style="color:#5B6A63; font-size: 13px; margin-top: 24px;">Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
    </div>
  `;
}

function button(href, label) {
  return `<p style="margin: 20px 0;"><a href="${escapeHtml(href)}" style="background:#0D6B5E; color:#fff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; display: inline-block;">${escapeHtml(label)}</a></p>
    <p style="color:#5B6A63; font-size: 13px; word-break: break-all;">Hoặc mở link: ${escapeHtml(href)}</p>`;
}

async function send(toEmail, subject, html, devText) {
  const t = getTransporter();
  if (!t) {
    if (isProd) return { ok: false, err: 'SMTP chưa cấu hình' };
    console.log(`\n========== [DEV] Email ==========\nTo: ${toEmail}\nSubject: ${subject}\n${devText}\n=================================\n`);
    return { ok: true, dev: true };
  }
  try {
    await t.sendMail({ from: config.SMTP.from, to: toEmail, subject, html });
    return { ok: true };
  } catch (e) {
    console.error('Lỗi gửi email:', e.message);
    return { ok: false, err: e.message };
  }
}

// ============== XÁC MINH EMAIL (token 24h) ==============
async function sendVerifyEmail(toEmail, token, fullName) {
  const link = `${config.APP_URL}/#/verify?token=${encodeURIComponent(token)}`;
  const html = layout(`Xin chào ${fullName || ''}`.trim(), `
    <p>Cảm ơn bạn đã đăng ký Ví Gọn. Bấm nút dưới đây để xác minh email:</p>
    ${button(link, 'Xác minh email')}
    <p>Link có hiệu lực trong <strong>24 giờ</strong>.</p>
  `);
  return send(toEmail, '[Ví Gọn] Xác minh email', html, `Link: ${link}`);
}

// ============== QUÊN MẬT KHẨU (token 1h, dùng 1 lần) ==============
async function sendResetPassword(toEmail, token, fullName) {
  const link = `${config.APP_URL}/#/reset?token=${encodeURIComponent(token)}`;
  const html = layout(`Xin chào ${fullName || ''}`.trim(), `
    <p>Bạn vừa yêu cầu đặt lại mật khẩu Ví Gọn. Bấm nút dưới đây để đặt mật khẩu mới:</p>
    ${button(link, 'Đặt lại mật khẩu')}
    <p>Link có hiệu lực trong <strong>1 giờ</strong> và chỉ dùng được 1 lần.</p>
  `);
  return send(toEmail, '[Ví Gọn] Đặt lại mật khẩu', html, `Link: ${link}`);
}

// ============ NHẮC NGÂN SÁCH 80% / 100% ============
function vnd(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'; }
async function sendBudgetAlert(toEmail, fullName, b) {
  const over = b.spent > b.limit;
  const title = over ? `Đã vượt ngân sách ${b.name}` : `Ngân sách ${b.name} đã dùng ${b.percent}%`;
  const link = `${config.APP_URL}/#/plan`;
  const html = layout(title, `
    <p>Tháng ${escapeHtml(b.month.slice(5))}/${escapeHtml(b.month.slice(0, 4))}: đã chi <strong>${vnd(b.spent)}</strong> / ${vnd(b.limit)}.</p>
    ${over ? `<p>Vượt <strong>${vnd(b.spent - b.limit)}</strong>.</p>` : (b.per_day !== null ? `<p>Nên tiêu tối đa <strong>${vnd(b.per_day)}</strong>/ngày trong ${b.days_left} ngày còn lại.</p>` : '')}
    ${button(link, 'Xem kế hoạch')}
  `).replace('Nếu bạn không yêu cầu, vui lòng bỏ qua email này.', 'Tắt nhắc bằng cách xoá ngân sách trong mục Kế hoạch.');
  return send(toEmail, `[Ví Gọn] ${title}`, html, `${title}: ${vnd(b.spent)} / ${vnd(b.limit)}`);
}

// ============ MỜI VÀO SỔ CHUNG (link 7 ngày) ============
async function sendInvite(toEmail, inviterName, bookName, link) {
  const title = `${inviterName || 'Một người'} mời bạn vào sổ "${bookName}"`;
  const html = layout(title, `
    <p>Bấm nút dưới đây để cùng ghi chép sổ <strong>${escapeHtml(bookName)}</strong> trên Ví Gọn:</p>
    ${button(link, 'Vào sổ chung')}
    <p>Link có hiệu lực trong <strong>7 ngày</strong> và chỉ dùng được 1 lần.</p>
  `);
  return send(toEmail, `[Ví Gọn] ${title}`, html, `Link: ${link}`);
}

// ============ NHẮC NỢ (trước hạn 3 ngày / đúng hạn) ============
async function sendDebtReminder(toEmail, fullName, d) {
  const who = escapeHtml(d.person);
  const due = d.due_date.split('-').reverse().join('/');
  const title = d.kind === 'due'
    ? (d.direction === 'lend' ? `Hôm nay ${d.person} đến hạn trả bạn` : `Hôm nay đến hạn trả ${d.person}`)
    : (d.direction === 'lend' ? `Còn 3 ngày ${d.person} đến hạn trả bạn` : `Còn 3 ngày đến hạn trả ${d.person}`);
  const html = layout(title, `
    <p>${d.direction === 'lend' ? `${who} còn nợ bạn` : `Bạn còn nợ ${who}`} <strong>${vnd(d.remaining)}</strong>, hạn <strong>${due}</strong>.</p>
    ${button(`${config.APP_URL}/#/debts`, 'Mở sổ nợ')}
  `).replace('Nếu bạn không yêu cầu, vui lòng bỏ qua email này.', 'Bạn nhận email này vì đã đặt hạn cho khoản nợ trong Ví Gọn.');
  return send(toEmail, `[Ví Gọn] ${title}`, html, `${title}: ${vnd(d.remaining)}`);
}

module.exports = { sendVerifyEmail, sendResetPassword, sendBudgetAlert, sendInvite, sendDebtReminder, escapeHtml };
