# Ví Gọn

App quản lý tài chính cá nhân cho người Việt. Node.js + Express + Neon Postgres, deploy Vercel.

## Đọc trước khi làm
- `docs/plan.md`: đặc tả 16 tính năng F01–F16 (chức năng, quy tắc, tiêu chí nghiệm thu). Đã được chủ repo duyệt.
- `docs/implementation-plan.md`: thứ tự triển khai theo bước, mỗi bước một PR. Xem ô `[ ]` nào chưa đánh dấu để biết đang ở đâu.
- `docs/ui-mockups.html`: màn hình mô phỏng cho từng tính năng; giao diện thật bám theo đây.

## Nguồn code dùng lại
Repo `lethanhdat2002296-cpu/Server` (app 5AM Check-in, đang chạy thật). Chỉ **đọc và chép** từ đó, không sửa repo đó trong lúc làm Ví Gọn. Bảng file cần chép nằm ở Bước 1 của `docs/implementation-plan.md`.

## Quy tắc
- Giao tiếp với chủ repo bằng tiếng Việt, ngắn gọn; chủ repo thường xem trên điện thoại.
- Tiền là số nguyên VND (`BIGINT`), không dùng số thực.
- Mọi truy vấn dữ liệu người dùng phải lọc theo người dùng/sổ đang đăng nhập; lỗi xác thực hoặc lỗi DB thì từ chối (fail-closed).
- Giờ tính theo `Asia/Ho_Chi_Minh`.
- Thay đổi schema bằng file migration mới trong `db/migrations/`.
- Trước khi push chạy `npm test` và `npm run lint`.
- Không commit `.env` hay bí mật. Thông tin Neon/Vercel do chủ repo cung cấp sau; khi chưa có thì làm phần không cần DB thật và nói rõ phần nào chưa kiểm được.
