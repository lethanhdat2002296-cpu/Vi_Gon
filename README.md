# Ví Gọn

App quản lý tài chính cá nhân cho người Việt: ghi thu chi nhanh, ngân sách, mục tiêu tiết kiệm, tự ghi giao dịch từ biến động số dư ngân hàng.

Stack: Node.js + Express + Neon Postgres, deploy trên Vercel.

- Kế hoạch và đặc tả tính năng: [docs/plan.md](docs/plan.md)
- Kế hoạch triển khai từng bước: [docs/implementation-plan.md](docs/implementation-plan.md)
- Màn hình mô phỏng: [docs/ui-mockups.html](docs/ui-mockups.html) (tải về mở bằng trình duyệt) hoặc https://claude.ai/artifact/9juSSsiEHbunMYz86zVN6g

Trạng thái: Bước 1 (bộ khung dự án) đang review; chờ Neon/Vercel để kiểm `/api/health` thật.

## Chạy local

```bash
npm install
cp .env.example .env      # điền DATABASE_URL, JWT_SECRET...
npm run migrate           # tạo bảng (cần DATABASE_URL)
npm run dev               # http://localhost:3000
npm test && npm run lint  # chạy trước khi push
```
