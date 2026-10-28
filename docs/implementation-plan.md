# Kế hoạch triển khai Ví Gọn

Tài liệu này nói **làm theo thứ tự nào, mỗi bước làm gì, khi nào coi là xong**.
Đặc tả từng tính năng (F01–F16) nằm ở [plan.md](plan.md); giao diện mô phỏng ở [ui-mockups.html](ui-mockups.html).

Mỗi bước dưới đây là **một Pull Request** vào `main`. Đánh dấu `[x]` khi PR đã merge.

---

## Bước 0 · Chuẩn bị hạ tầng (chủ repo làm)

- [x] Tạo database **Neon mới** (không dùng chung với app 5AM). Lấy connection string dạng *pooled*.
- [x] Tạo project **Vercel mới**, nối với repo `Vi_Gon`, nhánh production là `main`.
- [x] Đặt biến môi trường trên Vercel (Production + Preview):

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon pooled connection string |
| `JWT_SECRET` | ✅ | chuỗi ngẫu nhiên ≥ 32 ký tự (`openssl rand -hex 32`) |
| `APP_URL` | ✅ | ví dụ `https://vi-gon.vercel.app`, dùng cho link trong email |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` | ✅ từ M1 | gửi email xác minh, quên mật khẩu |
| `CRON_SECRET` | từ M5 | bảo vệ `/api/cron/*` |
| `TIMEZONE` | | mặc định `Asia/Ho_Chi_Minh` |

> Bước 1 làm được trước khi có Neon/Vercel: code + test chạy local không cần DB thật (test thuần logic).

---

## Bước 1 · Bộ khung dự án (M0)

Mục tiêu: repo chạy được `npm run dev`, `npm test`, `npm run lint`; deploy lên Vercel ra trang trống và `/api/health`.

- [x] `package.json`: Node ≥ 20, Express 4, `@neondatabase/serverless`, `ws`, `bcryptjs`, `jsonwebtoken`, `nodemailer`, `dotenv`, `cors`; dev: `vitest`, `eslint`, `@eslint/js`.
- [x] Cấu trúc thư mục (theo đúng kiểu repo `Server`):
  ```
  app.js            # Express app dùng chung local + Vercel, security headers, /api/health
  server.js         # chạy local
  api/index.js      # entry Vercel
  config.js         # đọc env, chặn khởi động production nếu thiếu JWT_SECRET/DATABASE_URL
  lib/db.js         # Neon pool + query()
  db/migrations/    # file SQL đánh số 001_*.sql, 002_*.sql ...
  scripts/migrate.js# chạy migration chưa áp dụng (bảng schema_migrations)
  middleware/       # auth, validate
  routes/           # mỗi nhóm API một file
  services/         # logic nghiệp vụ thuần (tính số dư, ngân sách...) → dễ test
  utils/            # time, money, validators, ratelimit, email
  public/           # index.html (app), css/, js/
  tests/
  vercel.json
  ```
- [x] Chép và chỉnh từ repo `Server` (`lethanhdat2002296-cpu/Server`):

| Lấy từ `Server` | Sang `Vi_Gon` | Chỉnh gì |
|---|---|---|
| `lib/db.js` | `lib/db.js` | bỏ `initSchema`, thay bằng migration |
| `config.js` | `config.js` | bỏ biến check-in/COMPANY_DOMAIN, thêm `APP_URL` |
| `app.js` | `app.js` | giữ security headers + `/api/health`, đổi route |
| `api/index.js`, `server.js`, `vercel.json` | giữ nguyên | đổi cron cho M5 |
| `middleware/auth.js` | `middleware/auth.js` | bỏ `adminRequired`; **lỗi DB phải từ chối (fail-closed)**, không cho qua như bản 5AM |
| `utils/ratelimit.js`, `utils/time.js`, `utils/email.js` | `utils/` | đổi mẫu email sang Ví Gọn |
| `eslint.config.js` | giữ | bỏ global `Chart`, `XLSX`… khi chưa dùng |

- [x] `utils/money.js`: `parseVnd("45.000") → 45000`, `formatVnd(45000) → "45.000 ₫"`, chặn số âm/không nguyên/vượt 999.999.999.999.
- [x] Migration `001_init.sql`: bảng `schema_migrations`, `users`, `login_attempts`, `rate_limits`.
- [x] Test: `money`, `time`, `ratelimit`.

**Xong khi:** CI local xanh (test + lint), Vercel trả `{"ok":true,"db":"up"}` ở `/api/health`.

---

## Bước 2 · M1 Tài khoản (F01 + phần đầu F08)

API
- [ ] `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout`
- [ ] `POST /api/auth/verify-email` (token 24h) · `POST /api/auth/forgot` · `POST /api/auth/reset` (token 1h, dùng 1 lần)
- [ ] `GET/PATCH /api/me` · `POST /api/me/password` (tăng `token_version`)

Dữ liệu (`002_users.sql`): `users(id, email UNIQUE, password_hash, name, email_verified_at, token_version, pin_hash, created_at, deleted_at)`, `email_tokens(token_hash, user_id, kind, expires_at, used_at)`.

Giao diện: màn Đăng nhập, Đăng ký, Quên mật khẩu, luồng làm quen 3 bước (mô phỏng F01).

Quy tắc bắt buộc
- Mật khẩu bcrypt cost 10+; token email lưu dạng hash.
- Khoá 15 phút sau 5 lần sai; giới hạn đăng ký theo IP.
- Thông báo lỗi đăng nhập không tiết lộ email có tồn tại hay không.

**Xong khi:** đủ tiêu chí nghiệm thu F01; test API đăng ký/đăng nhập/khoá/đổi mật khẩu thu hồi token.

---

## Bước 3 · M2 Ví, danh mục, giao dịch (F05, F06, F03)

Dữ liệu (`003_core.sql`)
```sql
wallets(id, user_id, name, type, color, opening_balance BIGINT, exclude_from_total, archived_at, created_at)
categories(id, user_id, name, kind, parent_id, color, icon, sort_order, archived_at)
transactions(id, user_id, wallet_id, category_id NULL, kind, amount BIGINT CHECK (amount > 0),
             occurred_at TIMESTAMPTZ, note, source, external_ref, transfer_group UUID NULL,
             created_at, updated_at, deleted_at)
-- UNIQUE (user_id, external_ref) WHERE external_ref IS NOT NULL
-- INDEX (user_id, occurred_at DESC), (user_id, wallet_id), (user_id, category_id)
```
- Chuẩn bị cho sổ chung (F14): thêm cột `book_id` ngay từ đầu, M2 mặc định mỗi user có 1 sổ cá nhân. Truy vấn lọc theo `book_id` mà user là thành viên.

API
- [ ] `GET/POST/PATCH /api/wallets`, `POST /api/wallets/:id/adjust`, `POST /api/wallets/:id/archive`
- [ ] `GET/POST/PATCH/DELETE /api/categories`, `POST /api/categories/:id/merge`
- [ ] `POST /api/transactions` (chi/thu), `POST /api/transfers`, `PATCH/DELETE /api/transactions/:id`, `POST /api/transactions/:id/restore` (hoàn tác)
- [ ] Seed danh mục mặc định khi tạo tài khoản (danh sách trong plan.md F06).

Logic (`services/balance.js`, có test)
- Số dư ví = `opening_balance` + Σ thu − Σ chi ± chuyển tiền, chỉ tính bản ghi chưa xoá.
- Chuyển tiền: 2 bản ghi cùng `transfer_group`, ghi trong **một transaction SQL**.

Giao diện: bảng nhập nhanh (bàn phím số, phím `000`, nút 20k/50k/100k/200k), màn Ví, màn Danh mục.

**Xong khi:** đủ nghiệm thu F03, F05, F06; test chứng minh user A không đọc/sửa được ví, danh mục, giao dịch của user B.

---

## Bước 4 · M3 Tổng quan, Sổ, Báo cáo (F02, F04, F07)

API
- [ ] `GET /api/summary?month=YYYY-MM` → tổng số dư, thu, chi, 5 giao dịch gần nhất, cảnh báo
- [ ] `GET /api/transactions?from&to&wallet&category&kind&source&q&cursor` (phân trang theo con trỏ, 50 dòng)
- [ ] `GET /api/reports/by-category?from&to&wallet` · `GET /api/reports/monthly?months=6`
- [ ] `GET /api/export.xlsx?…` (cùng bộ lọc với Sổ)

Lưu ý
- Tìm kiếm không dấu: thêm cột `note_search` (chữ thường, bỏ dấu) hoặc dùng `unaccent`.
- Báo cáo bỏ chuyển tiền và điều chỉnh; tháng tính theo giờ Việt Nam.

Giao diện: trang Tổng quan, tab Sổ (nhóm theo ngày, lọc, tìm, vuốt xoá), trang Báo cáo (tròn + cột 6 tháng, Chart.js hoặc SVG tự vẽ).

**Xong khi:** đủ nghiệm thu F02, F04, F07; Tổng quan mở < 1,5 giây trên 4G.

---

## Bước 5 · M4 Bảo mật và dữ liệu (phần còn lại F08) → **phát hành MVP**

- [ ] PIN khoá app (băm bcrypt, kiểm ở client sau 5 phút không dùng + server xác nhận).
- [ ] Ẩn số tiền, chọn giao diện sáng/tối/theo máy.
- [ ] Xuất JSON/Excel toàn bộ; nhập JSON; nhập Excel theo file mẫu.
- [ ] Xoá tài khoản (nhập lại mật khẩu, xoá cứng mọi bảng).
- [ ] Rà soát: mọi route có `authRequired` + lọc `user_id`/`book_id`; test tổng hợp chống đọc chéo.

**Xong khi:** đủ nghiệm thu F08 → gắn tag `v0.1.0`, mời 5–20 người dùng thử.

---

## Bước 6 · M5 Kế hoạch (F09, F10, F11)

- [ ] `004_planning.sql`: `budgets`, `goals`, `recurring_rules`.
- [ ] API CRUD tương ứng + `GET /api/budgets/status?month=`.
- [ ] Cron `/api/cron/daily` (Vercel cron 1 lần/ngày, header `Authorization: Bearer CRON_SECRET`): tạo giao dịch định kỳ đến hạn (không trùng), gửi email ngân sách 80%/100%.
- [ ] Tab Kế hoạch với 3 phần: Ngân sách · Mục tiêu · Định kỳ.

**Xong khi:** đủ nghiệm thu F09–F11.

---

## Bước 7 · M6 Tự động hoá (F12, F13)

- [ ] Chốt SePay hay Casso (so giá, ngân hàng hỗ trợ, định dạng webhook).
- [ ] `005_bank.sql`: `bank_links`, `category_rules`, cột `status` (pending/confirmed) cho giao dịch tự động.
- [ ] `POST /api/hook/:linkId`: kiểm mã bí mật, chống trùng bằng `external_ref`, gợi ý danh mục, đưa vào "Chờ xác nhận".
- [ ] Luật từ khoá mặc định + học từ lần người dùng sửa.
- [ ] Quét hoá đơn: Tesseract chạy trên trình duyệt (tham khảo `public/js/payment.js`, `utils/receipt.js` của repo `Server`).

**Xong khi:** đủ nghiệm thu F12, F13.

---

## Bước 8 · M7 Dùng chung (F14, F15, F16)

- [ ] `006_sharing.sql`: `books`, `book_members`, `invites`, `groups`, `group_members`, `group_expenses`, `debts`, `debt_payments`.
- [ ] Sổ chung: mời, phân quyền, đổi sổ.
- [ ] Chia tiền nhóm: thuật toán tất toán ít lần chuyển nhất (có test), VietQR (tham khảo `public/js/qr.js` của `Server`).
- [ ] Sổ nợ + email nhắc hạn trong cron hằng ngày.

**Xong khi:** đủ nghiệm thu F14–F16.

---

## Quy ước làm việc

- Mỗi bước một nhánh + một PR; mô tả PR liệt kê tiêu chí nghiệm thu đã đạt, kèm ảnh chụp màn hình điện thoại.
- Trước khi push: `npm test` và `npm run lint` phải qua.
- Không commit `.env` hay bất kỳ bí mật nào.
- Tiền luôn là số nguyên VND; không dùng `float` cho tiền ở cả server lẫn client.
- Thay đổi database chỉ bằng file migration mới, không sửa migration đã chạy.
