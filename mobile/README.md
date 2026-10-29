# Ví Gọn cho Android (APK)

App Android là "vỏ" Capacitor mở thẳng bản web thật `https://walletapps-zeta.vercel.app`.
Giao diện, dữ liệu, AI đều lấy từ máy chủ, nên sửa web là app cập nhật theo, không cần cài lại APK.
Cần cài lại chỉ khi đổi phần Android (biểu tượng, quyền, sau này là đọc thông báo ngân hàng — B02).

- Mất mạng: hiện trang `www/offline.html` có nút "Thử lại".
- Nút Back của điện thoại quay lại màn trước; ở màn đầu thì thoát app.

## Build APK

Cần Node 20+, JDK 21, Android SDK (platform 35, build-tools 35).

```bash
cd mobile
npm install
export ANDROID_HOME=/đường/dẫn/android-sdk
npm run apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Maven Central báo 429 (quá nhiều yêu cầu) thì thêm `-I mirror.gradle` trỏ sang
`https://maven-central.storage-download.googleapis.com/maven2/`.

## Ký APK

Bản hiện tại là bản debug, ký bằng khoá debug của máy build. Build ở máy khác → khoá khác →
Android không cho cài đè, phải gỡ app cũ rồi cài lại (dữ liệu nằm trên máy chủ nên không mất, chỉ phải đăng nhập lại).
Khi cần cập nhật ổn định: tạo khoá release, giữ ngoài repo (không commit `*.keystore`), build bằng GitHub Actions với khoá đặt trong Secrets.
