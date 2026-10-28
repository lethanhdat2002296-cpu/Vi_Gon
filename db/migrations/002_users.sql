-- 002: tài khoản (F01) — token email, làm quen, cửa sổ đếm sai đăng nhập

-- Mục đích dùng chọn ở bước 1 làm quen; onboarded_at = đã làm quen xong
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_purpose TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Token gửi qua email: chỉ lưu SHA-256 của token, dùng 1 lần
--   verify: xác minh email, hạn 24h · reset: đặt lại mật khẩu, hạn 1h
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_kind ON email_tokens (user_id, kind);

-- Lần sai gần nhất: sai rải rác cách nhau lâu thì đếm lại từ đầu
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS last_failed_at BIGINT NOT NULL DEFAULT 0;
