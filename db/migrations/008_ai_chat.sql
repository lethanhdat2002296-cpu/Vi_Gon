-- Lịch sử trò chuyện với Trợ lý AI, mỗi tài khoản một bản (đồng bộ giữa web và app Android)
CREATE TABLE IF NOT EXISTS ai_chats (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
