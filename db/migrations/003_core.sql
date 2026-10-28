-- 003: sổ, ví, danh mục, giao dịch (F03, F05, F06)
-- Mọi dữ liệu tài chính thuộc về một SỔ (book). Bây giờ mỗi người có 1 sổ cá nhân;
-- sổ chung (F14) sẽ thêm thành viên vào book_members, truy vấn không phải đổi.

CREATE TABLE IF NOT EXISTS books (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Sổ cá nhân',
  kind        TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'shared')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Mỗi người đúng 1 sổ cá nhân
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_personal ON books (owner_id) WHERE kind = 'personal';

CREATE TABLE IF NOT EXISTS book_members (
  book_id     BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_book_members_user ON book_members (user_id);

CREATE TABLE IF NOT EXISTS wallets (
  id                  BIGSERIAL PRIMARY KEY,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'ewallet', 'credit', 'savings')),
  color               TEXT NOT NULL DEFAULT '#0D6B5E',
  -- Số dư lúc tạo ví (thẻ tín dụng: số âm = dư nợ). Số dư hiện tại luôn tính, không lưu cứng.
  opening_balance     BIGINT NOT NULL DEFAULT 0 CHECK (opening_balance BETWEEN -999999999999 AND 999999999999),
  exclude_from_total  BOOLEAN NOT NULL DEFAULT FALSE,
  credit_limit        BIGINT CHECK (credit_limit IS NULL OR credit_limit BETWEEN 0 AND 999999999999),
  due_day             SMALLINT CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallets_book ON wallets (book_id);

CREATE TABLE IF NOT EXISTS categories (
  id          BIGSERIAL PRIMARY KEY,
  book_id     BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  -- Danh mục con 1 cấp
  parent_id   BIGINT REFERENCES categories(id) ON DELETE CASCADE,
  color       TEXT NOT NULL DEFAULT '#9AA79F',
  icon        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_book ON categories (book_id, kind, sort_order);

CREATE TABLE IF NOT EXISTS transactions (
  id              BIGSERIAL PRIMARY KEY,
  book_id         BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,   -- người ghi
  wallet_id       BIGINT NOT NULL REFERENCES wallets(id),
  category_id     BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  -- Chuyển tiền = 1 dòng expense ở ví nguồn + 1 dòng income ở ví đích, cùng transfer_group
  kind            TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount          BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
  occurred_at     TIMESTAMPTZ NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'adjust', 'transfer', 'bank', 'recurring', 'import')),
  external_ref    TEXT,
  transfer_group  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_external_ref ON transactions (book_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_book_time ON transactions (book_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_book_wallet ON transactions (book_id, wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_book_category ON transactions (book_id, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions (transfer_group) WHERE transfer_group IS NOT NULL;
