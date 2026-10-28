// Gắn req.bookId = sổ đang dùng (đặt SAU authRequired).
// Mặc định là sổ cá nhân; header X-Book-Id chọn sổ chung (F14) — phải là thành viên của sổ đó.
// FAIL-CLOSED: không xác định được sổ (lỗi DB) thì từ chối.
const books = require('../services/books');
const { toId } = require('../utils/params');

async function bookRequired(req, res, next) {
  try {
    const personal = await books.ensurePersonalBook(req.user.id);
    const header = req.headers['x-book-id'];
    let bookId = personal;
    if (header !== undefined && header !== '') {
      bookId = toId(header);
      if (!bookId) return res.status(400).json({ error: 'Sổ không hợp lệ' });
    }
    const info = await books.membership(bookId, req.user.id);
    if (!info) return res.status(403).json({ error: 'Bạn không có quyền với sổ này' });
    req.bookId = bookId;
    req.bookRole = info.role;
    req.bookKind = info.kind;
    req.personalBookId = personal;
    next();
  } catch (e) {
    console.error('Lỗi xác định sổ:', e.message);
    res.status(503).json({ error: 'Máy chủ đang bận, vui lòng thử lại sau.' });
  }
}

// Chặn ghi khi chỉ có quyền xem
function canWrite(req, res, next) {
  if (req.bookRole === 'viewer') return res.status(403).json({ error: 'Bạn chỉ có quyền xem sổ này' });
  next();
}

// Chỉ chủ sổ (đổi tên sổ, liên kết ngân hàng, mời/đổi quyền thành viên…)
function ownerOnly(req, res, next) {
  if (req.bookRole !== 'owner') return res.status(403).json({ error: 'Chỉ chủ sổ làm được việc này' });
  next();
}

module.exports = { bookRequired, canWrite, ownerOnly };
