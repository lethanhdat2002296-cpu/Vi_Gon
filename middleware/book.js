// Gắn req.bookId = sổ đang dùng (đặt SAU authRequired).
// Hiện tại là sổ cá nhân; khi có sổ chung (F14) sẽ đọc header X-Book-Id và kiểm book_members.
// FAIL-CLOSED: không xác định được sổ (lỗi DB) thì từ chối.
const books = require('../services/books');

async function bookRequired(req, res, next) {
  try {
    const bookId = await books.ensurePersonalBook(req.user.id);
    const role = await books.memberRole(bookId, req.user.id);
    if (!role) return res.status(403).json({ error: 'Bạn không có quyền với sổ này' });
    req.bookId = bookId;
    req.bookRole = role;
    next();
  } catch (e) {
    console.error('Lỗi xác định sổ:', e.message);
    res.status(503).json({ error: 'Máy chủ đang bận, vui lòng thử lại sau.' });
  }
}

// Chặn ghi khi chỉ có quyền xem (dùng cho sổ chung sau này)
function canWrite(req, res, next) {
  if (req.bookRole === 'viewer') return res.status(403).json({ error: 'Bạn chỉ có quyền xem sổ này' });
  next();
}

module.exports = { bookRequired, canWrite };
