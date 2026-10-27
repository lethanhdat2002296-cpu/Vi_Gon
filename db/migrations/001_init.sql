-- 001: bảng nền tảng — migration, người dùng, khoá đăng nhập, rate limit

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  full_name          TEXT NOT NULL DEFAULT '',
  pin_hash           TEXT,
  token_version      INTEGER NOT NULL DEFAULT 0,
  email_verified_at  TIMESTAMPTZ,
  theme              TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  hide_amounts       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Mỗi email một tài khoản (không phân biệt hoa thường)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (LOWER(email));

-- Khoá 15 phút sau 5 lần sai, theo email đã chuẩn hoá
CREATE TABLE IF NOT EXISTS login_attempts (
  email         TEXT PRIMARY KEY,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  locked_until  BIGINT NOT NULL DEFAULT 0
);

-- Rate limit chung theo key (IP / IP+route), thời gian tính bằng ms epoch
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  BIGINT NOT NULL DEFAULT 0
);
