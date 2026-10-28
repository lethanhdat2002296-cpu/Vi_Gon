# Ví Gọn

App quản lý tài chính cá nhân cho người Việt: ghi thu chi nhanh, ngân sách, mục tiêu tiết kiệm, tự ghi giao dịch từ biến động số dư ngân hàng.

Stack: Node.js + Express + Neon Postgres, deploy trên Vercel.

- Kế hoạch và đặc tả tính năng: [docs/plan.md](docs/plan.md)
- Kế hoạch triển khai từng bước: [docs/implementation-plan.md](docs/implementation-plan.md)
- Màn hình mô phỏng: [docs/ui-mockups.html](docs/ui-mockups.html) (tải về mở bằng trình duyệt) hoặc https://claude.ai/artifact/9juSSsiEHbunMYz86zVN6g

Trạng thái: Bước 1–4 xong (đang chạy ở https://walletapps-zeta.vercel.app). Đang làm Bước 5 (bảo mật và dữ liệu) → phát hành MVP `v0.1.0`.

## Chạy local

```bash
npm install
cp .env.example .env      # điền DATABASE_URL, JWT_SECRET...
npm run migrate           # tạo bảng (cần DATABASE_URL); bản Production trên Vercel tự chạy khi build
npm run dev               # http://localhost:3000
npm test && npm run lint  # chạy trước khi push
```

Test API với Postgres thật: đặt `TEST_DATABASE_URL` trỏ vào một database **trống dành riêng cho test** (test sẽ xoá sạch schema), ví dụ
`TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/vigon_test npm test`. Không đặt biến này thì các test đó được bỏ qua.
