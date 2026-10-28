-- 004: tìm kiếm không dấu cho Sổ (F04)
-- vn_fold('Cà PHÊ Đá') = 'ca phe da': chữ thường + bỏ dấu tiếng Việt (kể cả đ/Đ).
-- Dùng translate() thay cho extension unaccent để hàm IMMUTABLE → dùng được cho cột sinh tự động.
CREATE OR REPLACE FUNCTION vn_fold(s TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(
    lower(COALESCE(s, '')),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'
  )
$$;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note_search TEXT GENERATED ALWAYS AS (vn_fold(note)) STORED;

-- Báo cáo theo kỳ: lọc nhanh theo sổ + thời gian, chỉ bản ghi chưa xoá
CREATE INDEX IF NOT EXISTS idx_transactions_book_time_live ON transactions (book_id, occurred_at DESC) WHERE deleted_at IS NULL;
