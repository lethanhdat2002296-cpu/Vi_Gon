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

## B02 · App Android đọc thông báo ngân hàng (chạy song song với SePay)

Lý do: gói miễn phí SePay chỉ 50 giao dịch/tháng; quá số đó giao dịch không về app. Đọc thông báo
ngân hàng trên điện thoại không giới hạn, không qua bên thứ ba. Chỉ Android.

```
Giao dịch ngân hàng
   ├─→ SePay (≤ 50/tháng)
   └─→ App Android đọc thông báo (không giới hạn)
              ↓
   Ví Gọn gộp: 1 giao dịch chỉ ghi 1 lần → "Chờ xác nhận"
```

Máy chủ (làm được ngay, không cần mẫu thông báo)
- [ ] API nhận dữ liệu từ điện thoại, khoá riêng cho từng máy (giống webhook SePay: chỉ lưu hash, thu hồi được).
- [ ] Gộp hai nguồn, chống trùng: cùng ví + cùng số tiền + cùng chiều vào/ra + lệch giờ ≤ vài phút → giữ 1 bản,
      bổ sung thông tin còn thiếu (mã tham chiếu SePay, nội dung đầy đủ). Có test cho các ca: SePay trước / thông báo
      trước / hai khoản cùng số tiền gần nhau là 2 giao dịch thật.
- [ ] Màn Liên kết ngân hàng hiện nguồn của từng giao dịch, cảnh báo khi SePay sắp hết lượt trong tháng.

App Android
- [ ] Bọc app thành APK (Capacitor), giao diện giữ nguyên; build tự động trên GitHub Actions để tải về điện thoại
      (nếu phiên làm việc không đẩy được file workflow, chủ repo tạo file theo hướng dẫn).
- [ ] `NotificationListenerService`: chỉ đọc thông báo của app ngân hàng được chọn, bỏ qua app khác.
- [ ] Mất mạng thì giữ hàng đợi trên máy, có mạng gửi lại.
- [ ] Hướng dẫn tắt tối ưu pin theo hãng máy.

Bộ đọc thông báo theo ngân hàng (cần mẫu thật)
- [ ] Mỗi ngân hàng 1 bộ đọc: số tiền, vào/ra, nội dung, giờ, 4 số cuối tài khoản; có test bằng mẫu thật.

Cần chủ repo cung cấp
- Danh sách ngân hàng đang dùng.
- Ngân hàng báo bằng thông báo app hay SMS (SMS cần thêm quyền đọc tin nhắn).
- Mỗi ngân hàng 2–3 ảnh thông báo thật (1 tiền vào, 1 tiền ra), che số tài khoản và tên người.
- Hãng điện thoại + bản Android.

## B03 · Trợ lý AI chạy trên laptop của chủ repo (thay cho AI chạy trên điện thoại)

Lý do: mô hình chạy trên điện thoại chậm, lag. Laptop có GPU / RAM lớn chạy mô hình to hơn (Qwen2.5 7B–14B), nhanh và giỏi tiếng Việt hơn; chi phí chỉ là tiền điện; số liệu chỉ đi tới laptop của chính chủ repo.

```
Điện thoại → Máy chủ Ví Gọn (Vercel: đăng nhập, gắn số liệu, giới hạn lượt) → Cloudflare Tunnel + mật khẩu riêng → Laptop (Ollama)
```

Đổi Cloudflare Tunnel → **Tailscale Funnel** (địa chỉ https cố định miễn phí, không cần tên miền). Hướng dẫn: `tools/ai-host/README.md`.

Phía chủ repo
- [x] Laptop Windows, chip AMD Ryzen + card AMD. Đã cài Ollama, Node.js, Tailscale.
- [ ] `ollama pull qwen2.5:7b` (chậm thì `qwen2.5:3b`), thử `ollama run`.
- [ ] Tạo `.env` cho cổng gác, bật `tailscale funnel --bg 8787`, chạy `start.bat`.
- [ ] Đặt biến Vercel `AI_HOST_URL`, `AI_HOST_TOKEN`; Redeploy; kiểm `/api/health?ai=1`.
- [ ] Tắt ngủ khi cắm sạc; cho `start.bat` tự chạy khi bật máy.

Phía code
- [x] Cổng gác `tools/ai-host/server.js` (không cần thư viện): mật khẩu, chỉ `/health` + `/v1/chat`, mô hình cố định, nghe 127.0.0.1.
- [x] `POST /api/ai/chat`: máy chủ tự tạo lời nhắc + số liệu, chuyển sang laptop, trả từng chữ; 80 câu/người/ngày; `maxDuration` 60 giây.
- [x] `GET /api/ai/host`, `/api/health?ai=1`: laptop có đang trả lời không.
- [x] App tự dùng laptop khi bật (không cần WebGPU), laptop tắt thì quay về AI trên máy hoặc báo "Trợ lý đang nghỉ".
