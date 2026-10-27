// Kiểm dữ liệu đầu vào trước khi vào route.
// schema: { field: (value, body) => string|null } — trả chuỗi lỗi nếu sai.
function validateBody(schema) {
  return (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    for (const [field, check] of Object.entries(schema)) {
      const err = check(body[field], body);
      if (err) return res.status(400).json({ error: err, field });
    }
    next();
  };
}

module.exports = { validateBody };
