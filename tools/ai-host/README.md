# Cổng gác AI chạy trên laptop (B03)

Cho trợ lý AI của Ví Gọn dùng mô hình chạy trên laptop của bạn (Ollama) thay vì chạy trên điện thoại:
nhanh hơn, giỏi tiếng Việt hơn, chỉ tốn tiền điện, số liệu chỉ đi tới laptop của chính bạn.

```
Điện thoại → Máy chủ Ví Gọn (Vercel) → Tailscale Funnel (https) → cổng gác này (kiểm mật khẩu) → Ollama
```

## Cài một lần (Windows)

1. Cài **Ollama**, **Node.js (LTS)**, **Tailscale** và đăng nhập Tailscale.
2. Tải mô hình (PowerShell):
   ```
   ollama pull qwen2.5:7b
   ```
   Máy RAM 8 GB dùng `qwen2.5:3b`; RAM 32 GB / card NVIDIA ≥ 12 GB dùng được `qwen2.5:14b`.
3. Tải thư mục `tools/ai-host` này về laptop (GitHub → nút **Code → Download ZIP**, giải nén, vào `tools/ai-host`).
4. Tạo mật khẩu riêng — mở PowerShell trong thư mục này:
   ```
   node server.js --new-token
   ```
   Chép dòng `AI_HOST_TOKEN=...` vừa hiện, tạo file **`.env`** trong thư mục này với nội dung:
   ```
   AI_HOST_TOKEN=<dán chuỗi vừa tạo>
   OLLAMA_MODEL=qwen2.5:7b
   ```
5. Bật Funnel (lần đầu Tailscale sẽ mở trang hỏi cho phép — bấm đồng ý):
   ```
   tailscale funnel --bg 8787
   tailscale funnel status
   ```
   Dòng `https://<tên-máy>.<tên>.ts.net` là địa chỉ của laptop.
6. Trên **Vercel → Settings → Environment Variables (Production)** thêm:
   - `AI_HOST_URL` = địa chỉ `https://….ts.net` ở bước 5
   - `AI_HOST_TOKEN` = đúng chuỗi trong file `.env`

   rồi **Redeploy**.

## Mỗi lần dùng

Bấm đúp **`start.bat`** (để cửa sổ mở). Kiểm tra nhanh: mở `https://walletapps-zeta.vercel.app/api/health?ai=1` → `"ai_host": { "ok": true }`.

Laptop tắt / cửa sổ đóng → app tự quay về AI chạy trên điện thoại (nếu đã tải) hoặc báo trợ lý đang nghỉ.

## Để laptop luôn sẵn sàng

- Settings → System → Power: khi cắm sạc **Sleep = Never**.
- Ollama và Tailscale đã tự chạy khi bật máy. Muốn cổng gác cũng tự chạy: Win + R → `shell:startup` → kéo **lối tắt** (shortcut) của `start.bat` vào thư mục vừa mở.

## An toàn

- Cổng gác chỉ nghe ở `127.0.0.1`, chỉ mở `/health` và `/v1/chat`, bắt buộc mật khẩu (so sánh an toàn thời gian), không cho đổi mô hình từ bên ngoài, giới hạn độ dài.
- Không bao giờ mở cổng `11434` của Ollama ra internet.
- Lộ mật khẩu: tạo chuỗi mới (bước 4), cập nhật `.env` và Vercel.
