# Nghiên cứu: Đăng nhập bằng Google (Gmail)

Trạng thái: **mới nghiên cứu, chưa làm**. Chủ repo chốt thì tách thành PR riêng (backlog B04).

## Cách hoạt động

```
Bấm "Đăng nhập với Google"
   → Google hỏi chọn tài khoản Gmail (cửa sổ của Google, Ví Gọn không thấy mật khẩu Gmail)
   → Google trả về "ID token" (JWT ký bởi Google: email, tên, ảnh, sub = mã tài khoản Google)
   → App gửi ID token lên POST /api/auth/google
   → Máy chủ kiểm chữ ký bằng khoá công khai của Google + aud = Client ID của Ví Gọn + iss + hạn + email_verified
   → Tìm / tạo tài khoản Ví Gọn → trả token Ví Gọn như đăng nhập thường
```

- Không cần thư viện lớn: máy chủ kiểm JWT bằng `jsonwebtoken` (đã có) + tải khoá công khai của Google
  (`https://www.googleapis.com/oauth2/v3/certs`, nhớ đệm theo `Cache-Control`). Hoặc dùng `google-auth-library`.
- Miễn phí. Không cần màn đồng ý "xem Gmail" vì chỉ xin `openid email profile`.

## Web và APK khác nhau

| | Bản web (trình duyệt) | App Android (APK) |
|---|---|---|
| Cách làm | Google Identity Services (nút "Sign in with Google", script `accounts.google.com/gsi/client`) | Google **chặn** đăng nhập trong WebView (lỗi `403 disallowed_useragent`). Phải dùng đăng nhập gốc của Android (Credential Manager) qua plugin Capacitor, ví dụ `@capgo/capacitor-social-login` |
| Cần thêm | Client ID loại Web, khai báo nguồn `https://walletapps-zeta.vercel.app` | Client ID loại Android: tên gói `vn.vigon.app` + **SHA-1 của khoá ký APK** → cần khoá ký release cố định (hiện là khoá debug) |
| CSP | Thêm `accounts.google.com` vào `script-src`, `frame-src`, `connect-src` | Không đổi |
| Phải cài lại APK | — | Có |

Gợi ý: làm bản web trước, APK làm sau cùng lúc với khoá ký release.

## Thay đổi phía máy chủ

- Migration: `users.google_sub TEXT UNIQUE`; `password_hash` cho phép NULL (tài khoản chỉ dùng Google).
- `POST /api/auth/google { id_token }`: kiểm như trên, giới hạn lượt theo IP, lỗi kiểm → từ chối (fail-closed).
- Tài khoản tạo bằng Google: `email_verified_at = NOW()` luôn (Google đã xác minh email), bỏ qua bước gửi mail xác minh.
- Các thao tác đang bắt nhập lại mật khẩu (bật PIN, đổi email, xoá tài khoản): tài khoản không có mật khẩu
  → xác nhận lại bằng Google (gửi ID token mới) hoặc cho đặt mật khẩu trước.
- Màn Cài đặt: "Liên kết Google" / "Gỡ liên kết" (chỉ gỡ được khi đã có mật khẩu).

## Rủi ro cần chặn

- **Chiếm trước tài khoản**: kẻ xấu đăng ký trước bằng email của nạn nhân (chưa xác minh) rồi chờ nạn nhân bấm
  "Đăng nhập với Google" → nếu gộp thẳng theo email, kẻ xấu vẫn biết mật khẩu cũ. Cách chặn: email đã có tài khoản
  **chưa xác minh** → khi gộp với Google thì xoá mật khẩu cũ + thu hồi mọi phiên (tăng `token_version`).
  Email đã xác minh → gộp (cùng một người sở hữu hộp thư).
- Chỉ nhận ID token có `aud` đúng Client ID của Ví Gọn (chống token cấp cho app khác).
- Không lưu ID token; chỉ lưu `google_sub`.

## Chủ repo cần làm (khi chốt)

1. Google Cloud Console → tạo project → **OAuth consent screen** (External, tên "Ví Gọn", email hỗ trợ).
2. **Credentials → OAuth client ID** loại *Web application*, Authorized JavaScript origins: `https://walletapps-zeta.vercel.app`.
3. Đặt biến Vercel `GOOGLE_CLIENT_ID` (không phải bí mật, nhưng không có thì nút Google ẩn đi).
4. (APK) tạo khoá ký release, gửi SHA-1 để tạo Client ID loại Android.

## Ước lượng

- Bản web: 1 PR (migration, API, nút ở màn Đăng nhập/Đăng ký, test kiểm JWT bằng khoá giả).
- APK: 1 PR (plugin, khoá ký release, build lại APK).

Nguồn:
- Google chặn OAuth trong WebView: https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html
- Plugin Capacitor Credential Manager: https://capgo.app/docs/plugins/social-login
