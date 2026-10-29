// /api/ai/context: số liệu tóm tắt của sổ đang dùng cho trợ lý AI chạy trên máy (không gọi dịch vụ AI nào)
const express = require('express');
const { authRequired } = require('../middleware/auth');
const { bookRequired } = require('../middleware/book');
const advisor = require('../services/advisor');

const router = express.Router();
router.use(authRequired, bookRequired);

router.get('/context', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ context: await advisor.buildContext(req.bookId) });
  } catch (e) { next(e); }
});

module.exports = router;
