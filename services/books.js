// Sổ (book): đơn vị sở hữu dữ liệu tài chính. Mỗi người có 1 sổ cá nhân, tạo lúc cần lần đầu.
const db = require('../lib/db');

// Bộ danh mục mặc định kiểu Việt (F06). [tên, biểu tượng, màu, [danh mục con]]
const DEFAULT_CATEGORIES = {
  expense: [
    ['Ăn uống', '🍜', '#D08A2E', ['Đi chợ', 'Ăn ngoài', 'Cà phê']],
    ['Đi lại', '🛵', '#5E6FB8', ['Xăng', 'Grab, taxi', 'Gửi xe']],
    ['Nhà ở', '🏠', '#0D6B5E', ['Thuê nhà', 'Điện', 'Nước', 'Mạng']],
    ['Mua sắm', '🛍️', '#B6452A', ['Quần áo', 'Đồ gia dụng']],
    ['Sức khoẻ', '💊', '#1C7C45', []],
    ['Học tập', '📚', '#5E6FB8', []],
    ['Giải trí', '🎬', '#A86A12', []],
    ['Hiếu hỉ', '🎁', '#B6452A', ['Đám cưới', 'Đám giỗ', 'Thăm ốm']],
    ['Gửi bố mẹ', '👪', '#0D6B5E', []],
    ['Con cái', '🧸', '#D08A2E', []],
    ['Khác', '•', '#9AA79F', []]
  ],
  income: [
    ['Lương', '💼', '#1C7C45', []],
    ['Thưởng', '🎉', '#D08A2E', []],
    ['Kinh doanh', '🏪', '#0D6B5E', []],
    ['Được cho', '🧧', '#B6452A', []],
    ['Lãi tiết kiệm', '🏦', '#5E6FB8', []],
    ['Khác', '•', '#9AA79F', []]
  ]
};

async function seedCategories(client, bookId) {
  for (const kind of ['expense', 'income']) {
    let order = 0;
    for (const [name, icon, color, children] of DEFAULT_CATEGORIES[kind]) {
      const r = await client.query(
        `INSERT INTO categories (book_id, name, kind, color, icon, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [bookId, name, kind, color, icon, order++]
      );
      let childOrder = 0;
      for (const child of children) {
        await client.query(
          `INSERT INTO categories (book_id, name, kind, parent_id, color, icon, sort_order) VALUES ($1, $2, $3, $4, $5, '', $6)`,
          [bookId, child, kind, r.rows[0].id, color, childOrder++]
        );
      }
    }
  }
}

// Trả id sổ cá nhân của user; chưa có thì tạo + seed danh mục (1 transaction SQL).
// An toàn khi 2 request chạy cùng lúc: unique index uq_books_personal + ON CONFLICT.
async function ensurePersonalBook(userId) {
  const found = await db.query(`SELECT id FROM books WHERE owner_id = $1 AND kind = 'personal'`, [userId]);
  if (found.rows[0]) return Number(found.rows[0].id);
  return db.withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO books (owner_id, kind) VALUES ($1, 'personal')
       ON CONFLICT (owner_id) WHERE kind = 'personal' DO NOTHING RETURNING id`,
      [userId]
    );
    if (!ins.rows[0]) {
      const again = await client.query(`SELECT id FROM books WHERE owner_id = $1 AND kind = 'personal'`, [userId]);
      return Number(again.rows[0].id);
    }
    const bookId = Number(ins.rows[0].id);
    await client.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [bookId, userId]);
    await seedCategories(client, bookId);
    return bookId;
  });
}

// Quyền của user trong sổ, hoặc null nếu không phải thành viên
async function memberRole(bookId, userId) {
  const r = await db.query('SELECT role FROM book_members WHERE book_id = $1 AND user_id = $2', [bookId, userId]);
  return r.rows[0] ? r.rows[0].role : null;
}

module.exports = { DEFAULT_CATEGORIES, ensurePersonalBook, memberRole };
