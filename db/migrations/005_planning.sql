-- 005: kế hoạch — ngân sách (F09), mục tiêu tiết kiệm (F10), giao dịch định kỳ (F11)

-- Ngân sách tháng: áp cho mọi tháng từ start_month; category_id NULL = ngân sách tổng
CREATE TABLE IF NOT EXISTS budgets (
  id           BIGSERIAL PRIMARY KEY,
  book_id      BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id  BIGINT REFERENCES categories(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
  rollover     BOOLEAN NOT NULL DEFAULT FALSE,   -- cộng phần chưa tiêu của tháng trước
  start_month  TEXT NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Mỗi danh mục (và ngân sách tổng) chỉ 1 ngân sách
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_category ON budgets (book_id, COALESCE(category_id, 0));

-- Đã báo mốc 80% / 100% của tháng nào (mỗi mốc 1 lần/tháng)
CREATE TABLE IF NOT EXISTS budget_alerts (
  budget_id  BIGINT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  level      SMALLINT NOT NULL CHECK (level IN (80, 100)),
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (budget_id, month, level)
);

-- Mục tiêu tiết kiệm: tiền đã có = số dư ví giữ tiền
CREATE TABLE IF NOT EXISTS goals (
  id             BIGSERIAL PRIMARY KEY,
  book_id        BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  target_amount  BIGINT NOT NULL CHECK (target_amount > 0 AND target_amount <= 999999999999),
  deadline_month TEXT NOT NULL CHECK (deadline_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  wallet_id      BIGINT NOT NULL REFERENCES wallets(id),
  -- Mốc bắt đầu để tính "đúng tiến độ / chậm"
  start_month    TEXT NOT NULL,
  start_amount   BIGINT NOT NULL DEFAULT 0,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_book ON goals (book_id);

-- Quy tắc định kỳ: mẫu giao dịch + lịch lặp
CREATE TABLE IF NOT EXISTS recurring_rules (
  id             BIGSERIAL PRIMARY KEY,
  book_id        BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount         BIGINT NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
  wallet_id      BIGINT NOT NULL REFERENCES wallets(id),
  category_id    BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  note           TEXT NOT NULL DEFAULT '',
  frequency      TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  -- Ngày gốc của lịch (ngày 31 giữ nguyên 31, tháng ngắn thì lùi về cuối tháng)
  anchor_date    DATE NOT NULL,
  next_date      DATE NOT NULL,
  end_date       DATE,
  mode           TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm')),
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_rules (next_date) WHERE active;
CREATE INDEX IF NOT EXISTS idx_recurring_book ON recurring_rules (book_id);

-- Mỗi lần đến hạn của 1 quy tắc: đã ghi (transaction_id), chờ xác nhận (pending) hoặc bỏ qua
CREATE TABLE IF NOT EXISTS recurring_occurrences (
  rule_id         BIGINT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('created', 'pending', 'skipped')),
  transaction_id  BIGINT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, due_date)   -- chạy cron lại không tạo trùng
);
CREATE INDEX IF NOT EXISTS idx_recurring_pending ON recurring_occurrences (rule_id) WHERE status = 'pending';
