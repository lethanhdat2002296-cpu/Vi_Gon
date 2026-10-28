-- 006: tự động hoá — liên kết ngân hàng qua SePay (F12), ảnh hoá đơn (F13)

-- Liên kết: mỗi liên kết có địa chỉ webhook riêng (hook_id ngẫu nhiên) + mã bí mật riêng (chỉ lưu SHA-256).
-- Chỉ đọc biến động số dư; chỉ lưu 4 số cuối tài khoản.
CREATE TABLE IF NOT EXISTS bank_links (
  id             BIGSERIAL PRIMARY KEY,
  book_id        BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  provider       TEXT NOT NULL DEFAULT 'sepay' CHECK (provider IN ('sepay')),
  hook_id        TEXT NOT NULL UNIQUE,
  secret_hash    TEXT NOT NULL,
  wallet_id      BIGINT NOT NULL REFERENCES wallets(id),
  account_last4  TEXT CHECK (account_last4 IS NULL OR account_last4 ~ '^\d{4}$'),
  auto_confirm   BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_event_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_links_book ON bank_links (book_id);

-- Nhật ký nhận webhook (cả lần bị từ chối) để người dùng tự kiểm khi chưa thấy giao dịch về
CREATE TABLE IF NOT EXISTS bank_events (
  id          BIGSERIAL PRIMARY KEY,
  link_id     BIGINT NOT NULL REFERENCES bank_links(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result      TEXT NOT NULL,          -- created | duplicate | ignored | rejected
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bank_events_link ON bank_events (link_id, received_at DESC);

-- Giao dịch tự động chờ người dùng xác nhận danh mục (vẫn tính vào số dư vì tiền đã thật sự đi/về)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (status IN ('pending', 'confirmed'));
-- Gợi ý khi chờ: có vẻ là chuyển sang ví khác / trùng khoản ghi tay
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS suggest_wallet_id BIGINT REFERENCES wallets(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS duplicate_of BIGINT REFERENCES transactions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions (book_id) WHERE status = 'pending' AND deleted_at IS NULL;

-- Luật từ khoá → danh mục, học từ lần người dùng sửa (luật mặc định nằm trong code)
CREATE TABLE IF NOT EXISTS category_rules (
  id           BIGSERIAL PRIMARY KEY,
  book_id      BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  keyword      TEXT NOT NULL,          -- đã bỏ dấu, chữ thường
  kind         TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  category_id  BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  hits         INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, kind, keyword)
);

-- Ảnh hoá đơn đính kèm (đã nén < 200 KB ở trình duyệt). Xoá hẳn giao dịch thì xoá ảnh.
CREATE TABLE IF NOT EXISTS transaction_receipts (
  transaction_id  BIGINT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  mime            TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp', 'image/png')),
  data            BYTEA NOT NULL CHECK (octet_length(data) <= 204800),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
