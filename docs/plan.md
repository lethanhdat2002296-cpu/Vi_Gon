# Kế hoạch Ví Gọn

App quản lý tài chính cá nhân, chạy trên trình duyệt điện thoại.
Stack: **Node.js + Express + Neon Postgres + Vercel**. Tiền tệ VND, lưu bằng số nguyên.

> Bản có **màn hình mô phỏng** cho từng tính năng: https://claude.ai/artifact/9juSSsiEHbunMYz86zVN6g
> File này là bản chữ để theo dõi cùng code. Hai bản có cùng nội dung đặc tả.

Bản nháp 1 · 27/10/2026 · đã duyệt.

---

## Toàn bộ tính năng

| Mã | Tính năng | Giai đoạn | Ưu tiên | Công |
|---|---|---|---|---|
| F01 | [Đăng ký và làm quen](#f01-đăng-ký-và-làm-quen) | 1 · MVP | Phải có | M |
| F02 | [Tổng quan (trang chủ)](#f02-tổng-quan-trang-chủ) | 1 · MVP | Phải có | M |
| F03 | [Thêm giao dịch nhanh](#f03-thêm-giao-dịch-nhanh) | 1 · MVP | Phải có | L |
| F04 | [Sổ giao dịch](#f04-sổ-giao-dịch) | 1 · MVP | Phải có | M |
| F05 | [Ví và chuyển tiền giữa ví](#f05-ví-và-chuyển-tiền-giữa-ví) | 1 · MVP | Phải có | M |
| F06 | [Danh mục](#f06-danh-mục) | 1 · MVP | Phải có | S |
| F07 | [Báo cáo](#f07-báo-cáo) | 1 · MVP | Phải có | M |
| F08 | [Tài khoản, bảo mật, dữ liệu](#f08-tài-khoản-bảo-mật-dữ-liệu) | 1 · MVP | Phải có | S |
| F09 | [Ngân sách tháng](#f09-ngân-sách-tháng) | 2 | Nên có | M |
| F10 | [Mục tiêu tiết kiệm](#f10-mục-tiêu-tiết-kiệm) | 2 | Nên có | S |
| F11 | [Giao dịch định kỳ](#f11-giao-dịch-định-kỳ) | 2 | Nên có | S |
| F12 | [Liên kết ngân hàng, tự ghi giao dịch](#f12-liên-kết-ngân-hàng-tự-ghi-giao-dịch) | 3 | Nên có | L |
| F13 | [Quét hoá đơn](#f13-quét-hoá-đơn) | 3 | Để sau | S |
| F14 | [Sổ chung gia đình](#f14-sổ-chung-gia-đình) | 4 | Để sau | L |
| F15 | [Chia tiền nhóm](#f15-chia-tiền-nhóm) | 4 | Để sau | M |
| F16 | [Sổ nợ](#f16-sổ-nợ) | 4 | Để sau | S |

Công: S ≈ 2–3 ngày, M ≈ 4–5 ngày, L ≈ 1–1,5 tuần.
Dự kiến: giai đoạn 1 ~4 tuần, giai đoạn 2 ~2 tuần, giai đoạn 3 ~2–3 tuần, giai đoạn 4 ~3 tuần.

## Nguyên tắc UX chung

- **Ghi 1 khoản dưới 10 giây.** Nút + ở giữa thanh dưới; mở ra là con trỏ ở ô số tiền, bàn phím số riêng có phím `000`.
- **Dùng được bằng một tay.** Nút chính ở nửa dưới màn hình, điều hướng bằng 5 tab ở đáy.
- **Màu chỉ để báo trạng thái.** Xanh lá = thu, cam đỏ = chi, vàng = sắp vượt, đỏ = đã vượt. Màu chủ đạo xanh ngọc chỉ cho nút và mục đang chọn.
- **Số tiền luôn dễ đọc.** `1.250.000 ₫`, chữ số đều nhau (tabular), số dư lớn nằm trên cùng.
- **Xoá thì hoàn tác được.** Thông báo "Đã xoá · Hoàn tác" 5 giây thay cho hộp xác nhận.
- **Có chế độ tối**, theo máy hoặc chọn tay.

**Tab dưới cùng:** Tổng quan · Sổ · ＋ · Kế hoạch (ngân sách, mục tiêu, định kỳ) · Tôi (ví, danh mục, cài đặt).
**Phông chữ:** Be Vietnam Pro.

---

## Giai đoạn 1 · MVP: ghi tay, dùng được ngay

### F01. Đăng ký và làm quen
**Mục tiêu:** người mới tạo xong ví đầu tiên trong dưới 1 phút.

Chức năng
- Đăng ký email + mật khẩu (≥ 8 ký tự), gửi email xác minh.
- Đăng nhập, quên mật khẩu qua email, giữ đăng nhập 30 ngày.
- Làm quen 3 bước: mục đích dùng → tạo ví đầu tiên + số dư → chọn bộ danh mục mặc định. Bước 1 và 3 bỏ qua được, bước 2 bắt buộc.

Quy tắc
- Mỗi email một tài khoản. Khoá 15 phút sau 5 lần sai.
- Chưa xác minh email vẫn dùng được, nhưng không bật được liên kết ngân hàng (F12).

Nghiệm thu
- [ ] Đăng ký xong vào thẳng bước làm quen, không phải đăng nhập lại.
- [ ] Làm quen xong thấy Tổng quan với đúng số dư vừa nhập.

### F02. Tổng quan (trang chủ)
**Mục tiêu:** mở app là biết đang có bao nhiêu, tháng này thu chi ra sao, có gì cần để ý.

Chức năng
- Tổng số dư mọi ví (bấm để xem từng ví), nút ẩn số tiền.
- Thu, chi, còn lại của tháng; vuốt ngang đổi tháng.
- Thẻ cảnh báo: ngân sách sắp vượt, giao dịch tự động chờ xác nhận, khoản định kỳ sắp tới.
- 5 giao dịch gần nhất; lối vào Báo cáo.

Quy tắc
- Tổng số dư cộng cả thẻ tín dụng (số âm), bỏ ví đã ẩn.
- Chuyển giữa ví không tính là thu hay chi.
- Tháng theo giờ Việt Nam, ngày 1 → cuối tháng (đổi ngày bắt đầu để giai đoạn 2).

Nghiệm thu
- [ ] Thêm chi 50.000 ₫ thì số dư, tổng chi, danh sách gần nhất cập nhật ngay.
- [ ] Trang mở dưới 1,5 giây trên 4G.

### F03. Thêm giao dịch nhanh
**Mục tiêu:** 3 lần chạm: gõ số tiền → chọn danh mục → Lưu.

Chức năng
- Bảng trượt từ nút +, 3 loại: Chi / Thu / Chuyển giữa ví.
- Bàn phím số riêng có `000`, nút nhanh 20k/50k/100k/200k.
- 9 danh mục dùng nhiều nhất + "Thêm".
- Ví mặc định = ví dùng lần trước, ngày mặc định = hôm nay.
- Ghi chú tuỳ chọn; ghi chú quen thuộc gợi ý danh mục và số tiền lần trước.
- Sửa, xoá (hoàn tác 5 giây).

Quy tắc
- Số nguyên VND, > 0, tối đa 999.999.999.999 ₫.
- Chuyển giữa ví: nguồn ≠ đích, tạo 2 bút toán liên kết, xoá một là xoá cả hai.
- Cho ghi ngày quá khứ; ngày tương lai chỉ cho giao dịch định kỳ (F11).
- Chi vượt số dư vẫn cho lưu nhưng cảnh báo.

Nghiệm thu
- [ ] Gõ 4, 5, 000 → Ăn uống → Lưu: ra khoản chi 45.000 ₫ hôm nay ở ví vừa dùng.
- [ ] Người dùng thử ghi 1 khoản trung bình dưới 10 giây (thử với 5 người).

### F04. Sổ giao dịch
**Mục tiêu:** tìm lại bất kỳ khoản nào trong vài giây và sửa khi ghi nhầm.

Chức năng
- Nhóm theo ngày, có tổng thu/chi từng ngày.
- Tìm theo ghi chú hoặc số tiền; lọc theo thời gian, ví, danh mục, loại, nguồn.
- Vuốt trái để xoá, bấm để sửa; tải thêm 50 dòng mỗi lần.
- Xuất Excel theo bộ lọc đang chọn.

Quy tắc
- Giao dịch tự động (F12) có nhãn "Tự động"; sửa được danh mục, ghi chú, không sửa số tiền.
- Bộ lọc giữ nguyên khi chuyển tab rồi quay lại.

Nghiệm thu
- [ ] Gõ "grab" ra mọi giao dịch có Grab, không phân biệt hoa thường và dấu.
- [ ] File Excel có đúng số dòng và tổng như trên màn hình.

### F05. Ví và chuyển tiền giữa ví
**Mục tiêu:** biết tiền đang nằm ở đâu.

Chức năng
- Thêm, sửa, ẩn ví. Loại: Tiền mặt, Ngân hàng, Ví điện tử, Thẻ tín dụng, Tiết kiệm.
- Tên, màu, số dư đầu, tuỳ chọn "không tính vào tổng".
- Điều chỉnh số dư: nhập số dư thật, app tạo khoản "Điều chỉnh" bằng phần chênh.
- Thẻ tín dụng hiện dư nợ, hạn mức, ngày đến hạn.

Quy tắc
- Số dư = số dư đầu + các giao dịch; không lưu cứng.
- Ví đã có giao dịch chỉ ẩn được, không xoá.

Nghiệm thu
- [ ] Chuyển 2.000.000 ₫ Techcombank → Tiết kiệm: nguồn giảm, đích tăng, tổng số dư và thu chi tháng không đổi.

### F06. Danh mục
**Mục tiêu:** bộ danh mục sát đời sống người Việt, sửa được.

Chức năng
- Chi mặc định: Ăn uống, Đi lại, Nhà ở (thuê nhà, điện, nước, mạng), Mua sắm, Sức khoẻ, Học tập, Giải trí, Hiếu hỉ, Gửi bố mẹ, Con cái, Khác.
- Thu mặc định: Lương, Thưởng, Kinh doanh, Được cho, Lãi tiết kiệm, Khác.
- Danh mục con 1 cấp; đổi tên, màu, biểu tượng; kéo để sắp xếp.
- Gộp hai danh mục.

Quy tắc
- Xoá danh mục có giao dịch thì phải chọn danh mục nhận lại.
- Báo cáo cộng danh mục con vào cha.

Nghiệm thu
- [ ] Gộp "Cà phê" vào "Ăn uống": giao dịch chuyển hết, báo cáo tháng đúng.

### F07. Báo cáo
**Mục tiêu:** tiền đi đâu, và tháng này có tốt hơn tháng trước không.

Chức năng
- Biểu đồ tròn chi theo danh mục (bấm để xem giao dịch).
- Cột thu/chi 6 tháng gần nhất.
- Bảng danh mục: số tiền, tỉ lệ, tăng giảm so với tháng trước.
- Kỳ: tháng, quý, năm, tự chọn; lọc theo ví.

Quy tắc
- Không tính chuyển giữa ví và điều chỉnh số dư.
- Tháng đang chạy ghi "tính đến hôm nay".

Nghiệm thu
- [ ] Tổng biểu đồ tròn = tổng chi trên Tổng quan cùng kỳ.

### F08. Tài khoản, bảo mật, dữ liệu
**Mục tiêu:** đủ tin để ghi tiền thật vào, và luôn lấy lại được dữ liệu.

Chức năng
- Đổi tên, email, mật khẩu (đổi mật khẩu → đăng xuất mọi máy khác).
- Khoá app bằng PIN 4–6 số sau 5 phút không dùng.
- Xuất Excel/JSON; nhập lại JSON; nhập giao dịch từ Excel mẫu.
- Xoá tài khoản vĩnh viễn (nhập lại mật khẩu).
- Giao diện sáng / tối / theo máy.

Quy tắc
- Mọi truy vấn lọc theo người dùng đang đăng nhập; có bộ test chứng minh không đọc được dữ liệu người khác.
- Xoá tài khoản: trong 24 giờ không còn bản ghi nào của người đó.

Nghiệm thu
- [ ] Xuất JSON rồi nhập vào tài khoản mới: số dư từng ví và báo cáo từng tháng giống hệt.

---

## Giai đoạn 2 · Kế hoạch: ngân sách, mục tiêu, định kỳ

### F09. Ngân sách tháng
**Mục tiêu:** đặt trần chi từng danh mục, được nhắc trước khi vượt.

Chức năng
- Hạn mức tháng theo danh mục hoặc ngân sách tổng.
- Thanh tiến độ: xanh < 80%, vàng ≥ 80%, đỏ > 100%.
- Gợi ý "nên tiêu tối đa X ₫/ngày".
- Email khi chạm 80% và 100%.
- Chuyển phần chưa tiêu sang tháng sau (tuỳ chọn).
- Lần đầu: gợi ý hạn mức = trung bình chi 3 tháng.

Quy tắc
- Áp cho cả danh mục con; mỗi mốc chỉ báo 1 lần/tháng.
- Mức/ngày = phần còn lại ÷ số ngày còn lại (tính cả hôm nay).

Nghiệm thu
- [ ] Ăn uống 4.000.000 ₫, đã chi 3.440.000 ₫ ngày 27/10: 86%, màu vàng, nên tiêu ≤ 112.000 ₫/ngày.

### F10. Mục tiêu tiết kiệm
**Mục tiêu:** biến mong muốn thành số tiền phải để dành mỗi tháng.

Chức năng
- Tên, số tiền cần, hạn, ví giữ tiền.
- Tự tính số cần góp mỗi tháng; nút "Góp thêm" tạo khoản chuyển vào ví mục tiêu.
- Trạng thái: Đúng tiến độ / Chậm (kèm số thiếu) / Đã đạt.

Quy tắc
- Cần góp/tháng = phần thiếu ÷ số tháng còn lại (từ tháng sau đến tháng của hạn).
- Góp vào mục tiêu là chuyển giữa ví, không phải chi.

Nghiệm thu
- [ ] 50.000.000 ₫, hạn 08/2027, đã có 18.500.000 ₫ vào 10/2026: 37%, cần 3.150.000 ₫/tháng.

### F11. Giao dịch định kỳ
**Mục tiêu:** không phải ghi lại tiền nhà, lương, cước, Netflix.

Chức năng
- Tạo quy tắc từ giao dịch có sẵn hoặc mới; lặp tháng / tuần / năm.
- Hai chế độ: tự ghi, hoặc nhắc rồi chờ xác nhận.
- "Sắp tới trong 7 ngày" ở Tổng quan; tạm dừng, kết thúc quy tắc.

Quy tắc
- Ngày 31 với tháng ngắn → ngày cuối tháng.
- Cron mỗi ngày tạo giao dịch đến hạn, chạy lại không tạo trùng.

Nghiệm thu
- [ ] Tiền nhà 3.500.000 ₫ ngày 5: sáng ngày 5 có giao dịch đúng ví, đúng danh mục.

---

## Giai đoạn 3 · Tự động hoá

### F12. Liên kết ngân hàng, tự ghi giao dịch
**Mục tiêu:** tiền ra vào tài khoản ngân hàng là app tự có giao dịch.

Chức năng
- Hướng dẫn từng bước kết nối qua dịch vụ báo biến động số dư (SePay hoặc Casso).
- Mỗi người dùng một địa chỉ webhook + mã bí mật riêng.
- Gợi ý danh mục theo nội dung CK (GRAB → Đi lại, SHOPEE → Mua sắm, "luong" → Lương).
- Hộp "Chờ xác nhận": Đúng / Đổi; bật tự xác nhận khi đã quen.
- Học từ việc người dùng sửa danh mục.

Quy tắc
- Kiểm mã bí mật mọi lần nhận; sai thì bỏ qua và ghi nhật ký.
- Mã giao dịch ngân hàng là duy nhất. Trùng với khoản ghi tay (cùng số tiền, cùng ví, trong 1 ngày) thì hỏi gộp.
- Chỉ đọc biến động, không bao giờ chuyển tiền. Chỉ lưu 4 số cuối tài khoản.

Nghiệm thu
- [ ] Chuyển thật 10.000 ₫: trong 1 phút có giao dịch trong Chờ xác nhận, đúng ví và số tiền.
- [ ] Gửi cùng dữ liệu 3 lần chỉ tạo 1 giao dịch.

### F13. Quét hoá đơn
**Mục tiêu:** chụp hoá đơn là có sẵn số tiền, ngày, cửa hàng.

Chức năng
- Chụp hoặc chọn ảnh; đọc chữ trên máy bằng Tesseract (dùng lại từ app 5AM).
- Tìm "Tổng cộng"/"Thanh toán", ngày, tên cửa hàng → điền sẵn bảng F03.
- Đính ảnh nhỏ vào giao dịch.

Quy tắc
- Luôn cho xem lại trước khi lưu; không đọc được thì để trống.
- Ảnh nén < 200KB; xoá giao dịch thì xoá ảnh.

Nghiệm thu
- [ ] 20 hoá đơn mẫu (Co.op, WinMart, Bách Hoá Xanh, quán ăn): ít nhất 15 đọc đúng tổng tiền.

---

## Giai đoạn 4 · Dùng chung

### F14. Sổ chung gia đình
**Mục tiêu:** cả nhà cùng ghi một sổ, cùng thấy tổng.

Chức năng
- Tạo sổ chung, mời bằng email hoặc link (hạn 7 ngày).
- Quyền: Chủ sổ / Thành viên / Người xem.
- Hiện ai ghi từng khoản; báo cáo chia theo người.
- Chọn ví nào đưa vào sổ chung; đổi giữa "Sổ của tôi" và "Sổ gia đình".

Quy tắc
- Chỉ người ghi hoặc chủ sổ sửa, xoá được.
- Rời sổ thì giao dịch đã ghi ở lại, hiện "Thành viên cũ".

Nghiệm thu
- [ ] Vợ ghi khoản chi, chồng mở app thấy ngay, tổng sổ tăng đúng.
- [ ] Người xem không thấy nút + và không gọi được API ghi.

### F15. Chia tiền nhóm
**Mục tiêu:** đi chơi nhóm xong biết ai trả ai, quét VietQR là xong.

Chức năng
- Tạo chuyến/nhóm, thêm người bằng tên (không cần tài khoản).
- Ghi khoản chung: ai trả, chia đều / theo số tiền / theo tỉ lệ.
- Tính số lần chuyển ít nhất để tất toán; mỗi dòng có VietQR đúng số tiền.
- Đánh dấu đã trả; phần của mình tự ghi vào sổ cá nhân.

Quy tắc
- Làm tròn 1.000 ₫, phần dư dồn cho người trả. Tổng phải trả = tổng phải nhận.

Nghiệm thu
- [ ] 4 người, tổng 6.000.000 ₫, Đạt trả 3.300.000 ₫, Hà trả 2.700.000 ₫: Minh và Tú mỗi người trả 1.500.000 ₫, tất toán bằng tối đa 3 lần chuyển.

### F16. Sổ nợ
**Mục tiêu:** không quên ai nợ mình và mình nợ ai.

Chức năng
- Ghi cho mượn / đi vay: người, số tiền, ngày, hạn, ghi chú.
- Trả từng phần, tự tính còn lại; email nhắc trước hạn 3 ngày và đúng hạn.
- Tổng "Người ta nợ mình" / "Mình nợ" ở mục Ví.

Quy tắc
- Cho mượn giảm ví nhưng không tính là chi; nhận lại không tính là thu.
- Quá hạn → nhãn đỏ "Quá hạn".

Nghiệm thu
- [ ] Cho Nam mượn 2.000.000 ₫, Nam trả 500.000 ₫: còn 1.500.000 ₫, báo cáo chi tháng không đổi.

---

## Dữ liệu chính

Tiền lưu bằng số nguyên VND (`BIGINT`). Mọi bảng có `user_id` (hoặc `book_id` khi có sổ chung).

| Bảng | Lưu gì | Dùng cho |
|---|---|---|
| `users` | email, mật khẩu đã băm, tên, PIN đã băm, token_version | F01, F08 |
| `wallets` | tên, loại, màu, số dư đầu, ẩn, không tính vào tổng | F05 |
| `categories` | tên, loại thu/chi, danh mục cha, màu, thứ tự | F06 |
| `transactions` | ví, danh mục, loại, số tiền, thời điểm, ghi chú, nguồn, mã ngân hàng (duy nhất), mã cặp chuyển tiền | F03, F04, F12 |
| `budgets` | danh mục, kỳ `YYYY-MM`, hạn mức, đã báo 80%/100% | F09 |
| `goals` | tên, số tiền cần, hạn, ví giữ tiền | F10 |
| `recurring_rules` | mẫu giao dịch, chu kỳ, ngày chạy tới, chế độ | F11 |
| `bank_links`, `category_rules` | nhà cung cấp, 4 số cuối TK, mã bí mật; từ khoá → danh mục | F12 |
| `books`, `book_members` | sổ chung, thành viên, quyền | F14 |
| `groups`, `group_expenses`, `debts` | chia tiền nhóm, sổ nợ | F15, F16 |

## Dùng lại từ app 5AM (repo `Server`)

Đăng nhập JWT + khoá sau nhiều lần sai + thu hồi token, giới hạn số lần gọi API, email + cron gửi lại, giờ Việt Nam, security headers, VietQR, OCR Tesseract, backup/restore.

## Các điểm còn mở

| Điểm | Đề xuất |
|---|---|
| Tên app chính thức | "Ví Gọn" (repo `Vi_Gon`) |
| Đăng nhập bằng Google | Để sang giai đoạn 2 |
| SePay hay Casso cho F12 | Quyết khi bắt đầu giai đoạn 3 |
| Sổ chung có cần sớm không | Thiết kế dữ liệu sẵn cho sổ chung từ đầu, làm giao diện sau |
| Miễn phí hay thu phí | Miễn phí hết giai đoạn 1–2 |
