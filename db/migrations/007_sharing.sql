-- 007: dùng chung — sổ chung (F14), chia tiền nhóm (F15), sổ nợ (F16)
-- books, book_members đã có từ 003.

-- Lời mời vào sổ chung: link có token (chỉ lưu hash), hạn 7 ngày, dùng 1 lần
CREATE TABLE IF NOT EXISTS invites (
  id           BIGSERIAL PRIMARY KEY,
  book_id      BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  email        TEXT,
  role         TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  accepted_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_book ON invites (book_id);

-- ============ CHIA TIỀN NHÓM ============
CREATE TABLE IF NOT EXISTS groups (
  id               BIGSERIAL PRIMARY KEY,
  book_id          BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_amount  BIGINT NOT NULL DEFAULT 0,   -- phần của mình đã ghi vào sổ
  archived_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_book ON groups (book_id);

-- Thành viên nhóm chỉ là tên (không cần tài khoản); tài khoản ngân hàng để tạo VietQR
CREATE TABLE IF NOT EXISTS group_members (
  id            BIGSERIAL PRIMARY KEY,
  group_id      BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  is_me         BOOLEAN NOT NULL DEFAULT FALSE,
  bank_code     TEXT,          -- mã ngân hàng VietQR (BIN 6 số hoặc tên viết tắt như TCB, VCB)
  account_no    TEXT,
  account_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);

CREATE TABLE IF NOT EXISTS group_expenses (
  id           BIGSERIAL PRIMARY KEY,
  group_id     BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
  paid_by      BIGINT NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  split_mode   TEXT NOT NULL CHECK (split_mode IN ('equal', 'amount', 'ratio')),
  occurred_on  DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses (group_id);

-- Phần của từng người trong 1 khoản: value = số tiền (amount) hoặc trọng số (ratio); equal thì value = 1
CREATE TABLE IF NOT EXISTS group_expense_shares (
  expense_id  BIGINT NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  member_id   BIGINT NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  value       BIGINT NOT NULL CHECK (value >= 0),
  PRIMARY KEY (expense_id, member_id)
);

-- Đã trả nhau (đánh dấu "đã trả")
CREATE TABLE IF NOT EXISTS group_settlements (
  id           BIGSERIAL PRIMARY KEY,
  group_id     BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member  BIGINT NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  to_member    BIGINT NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL CHECK (amount > 0),
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============ SỔ NỢ ============
-- Cho mượn / đi vay: tiền ra/vào ví ghi bằng giao dịch nguồn 'debt' (không tính là thu/chi)
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'adjust', 'transfer', 'bank', 'recurring', 'import', 'debt'));

CREATE TABLE IF NOT EXISTS debts (
  id              BIGSERIAL PRIMARY KEY,
  book_id         BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('lend', 'borrow')),
  person          TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
  wallet_id       BIGINT REFERENCES wallets(id),
  transaction_id  BIGINT REFERENCES transactions(id) ON DELETE SET NULL,
  start_date      DATE NOT NULL,
  due_date        DATE,
  note            TEXT NOT NULL DEFAULT '',
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_debts_book ON debts (book_id);

CREATE TABLE IF NOT EXISTS debt_payments (
  id              BIGSERIAL PRIMARY KEY,
  debt_id         BIGINT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  paid_on         DATE NOT NULL,
  wallet_id       BIGINT REFERENCES wallets(id),
  transaction_id  BIGINT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments (debt_id);

-- Đã gửi email nhắc nợ (trước hạn 3 ngày / đúng hạn), mỗi loại 1 lần
CREATE TABLE IF NOT EXISTS debt_reminders (
  debt_id  BIGINT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('before3', 'due')),
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (debt_id, kind)
);
