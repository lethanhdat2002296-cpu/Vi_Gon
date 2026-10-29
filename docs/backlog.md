# Backlog

Việc để làm sau, chủ repo chốt thứ tự khi bắt đầu. Mỗi mục khi làm thì tách thành PR riêng.

## B01 · Kết nối SePay thật (F12)

Code đã có (Bước 7: `/api/hook/:hookId`, màn Tôi → Liên kết ngân hàng). Còn phải cấu hình và kiểm trên tài khoản thật.

- [ ] Cài email gửi đi trên Vercel (Production): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL`; Redeploy. Kiểm `/api/health` báo `has_smtp: true`.
- [ ] Xác minh email tài khoản chính (liên kết ngân hàng yêu cầu đã xác minh).
- [ ] Trong app tạo liên kết: chọn ví, nhập 4 số cuối tài khoản, chép URL webhook + API Key (API Key chỉ hiện 1 lần).
- [ ] SePay → Webhooks → Thêm webhook: sự kiện **Cả hai**, URL ở trên, chọn đúng tài khoản ngân hàng, không đặt bộ lọc mã thanh toán, xác thực **API Key**.
- [ ] Nghiệm thu F12: chuyển thật 10.000 ₫ → trong 1 phút có giao dịch ở "Chờ xác nhận", đúng ví và số tiền; SePay gửi lại cùng dữ liệu không tạo trùng.
- [ ] Cân nhắc: có giữ điều kiện "phải xác minh email mới liên kết" không.

## B02 · App Android đọc thông báo ngân hàng

Phương án thay / bổ sung cho SePay, không qua bên thứ ba. Chỉ Android.

- [ ] Bọc app thành APK (Capacitor), build tự động trên GitHub Actions để tải về điện thoại.
- [ ] `NotificationListenerService`: chỉ đọc thông báo của app ngân hàng người dùng chọn.
- [ ] Bộ đọc mẫu thông báo theo từng ngân hàng (cần mẫu thật: VCB, Techcombank, MB…), có test.
- [ ] Gửi về API, đưa vào "Chờ xác nhận", chống trùng; giữ lại khi mất mạng rồi gửi sau.
- [ ] Hướng dẫn tắt tối ưu pin (Xiaomi, Oppo, Samsung).
- Cần chủ repo cung cấp: danh sách ngân hàng đang dùng, báo bằng thông báo app hay SMS, vài mẫu thông báo thật (che số tài khoản).
