# Chatbot Scenario Library

Tài liệu này tổng hợp các “trend kịch bản” ưu tiên cho chatbot Rayal. Mỗi kịch bản gồm trigger phổ biến, dữ liệu cần thu thập, luồng trả lời gợi ý và biến thể cần phủ. Phạm vi dựa trên hệ thống hiện tại (Booking, Promotion, Services, Contact info…).

---

## 1. Booking Journey Scenarios

### 1.1 Đặt phòng tiêu chuẩn (website/app)
- **Trigger:** “Tôi muốn đặt phòng”, “book phòng ngày 15/12”, CTA từ landing page.
- **Dữ liệu cần lấy:** ngày nhận/trả, số khách/phòng, loại phòng, email/điện thoại, kênh thanh toán (thẻ – chuyển khoản – tại khách sạn).
- **Luồng gợi ý:**
  1. Xác nhận ngày & số lượng khách/phòng, kiểm tra tồn phòng (`GET /api/rooms?roomType=`…).
  2. Đề xuất 2 lựa chọn giá (ví dụ: Standard 1.500.000, Deluxe 2.800.000).
  3. Thu thông tin khách, hỏi có yêu cầu đặc biệt (xe đưa đón, giường phụ…).
  4. Tóm tắt booking + thu phương thức thanh toán → gửi link form `https://hotel-fe/.../booking`.
- **Biến thể:** khách không chắc ngày → đề nghị khoảng thời gian & cam kết giữ phòng 24h; khách muốn đặt giúp người khác → thu thông tin người check-in.

### 1.2 Đặt nhiều phòng / gia đình
- Hỏi rõ số phòng cần, chia phòng theo người lớn/trẻ em (tham chiếu chính sách trẻ em ở `policies.md`).
- Đề xuất combo 2 phòng Double + 1 Suite, highlight giường phụ 500.000 VNĐ/đêm.
- Nếu cần nối phòng, note “special request: connecting rooms”.

### 1.3 Đặt gấp (arrival < 24h)
- Kiểm tra tồn kho nhanh, chỉ nêu loại phòng còn trống.
- Hướng khách gọi hotline 0901 234 567 để giữ phòng và hoàn tất thanh toán tại quầy.
- Nhắc chính sách hủy: trong vòng 24h phí 50%.

### 1.4 Chỉnh sửa hoặc hủy đặt phòng
- Thu mã đặt phòng hoặc email.
- Nêu chính sách hủy (48h miễn phí, 24–48h 30%, <24h 50%, no-show 100%).
- Nếu đổi ngày: kiểm tra lại giá mới, thông báo chênh lệch.
- Nếu khách cần chứng từ: hướng tới email `booking@rayalhotel.vn` (giả định từ Contact Info).

### 1.5 Thanh toán & xác nhận
- Sau khi thu thông tin, chatbot mô tả 3 lựa chọn:
  - Thẻ tín dụng: thanh toán ngay trên link bảo mật.
  - Chuyển khoản: cung cấp STK, yêu cầu chụp biên lai.
  - Trả tại khách sạn: giữ phòng 24h, cần đến trước 18:00 trong ngày check-in.
- Nhắc gửi email xác nhận tự động sau khi thanh toán.

### 1.6 Yêu cầu đặc biệt / dịch vụ bổ sung
- Các option từ module Services: đưa đón sân bay (phụ phí), giường phụ, trang trí sinh nhật, spa.
- Thu chi tiết (thời gian, số chuyến…), ghi chú vào booking (`specialRequest`).

### 1.7 Đặt phòng ngân sách thấp (≤ 1.000.000 VNĐ)
- **Trigger:** “Có phòng 800k không?”, “ngân sách dưới 1 triệu”, “mình cần phòng rẻ nhất”.
- **Mục tiêu trả lời:** thay vì liệt kê giá chung chung, bot cần đưa ra **quy trình hành động** giúp khách đạt được mức giá mong muốn nhanh nhất.
- **Luồng gợi ý:**
  1. **Xác nhận ngân sách & thời gian**: “Bạn cần ở ngày nào và tối đa bao nhiêu?”.
  2. **Thông báo mức giá thấp nhất hiện có** (lấy từ Room API hoặc generated-data.md). Nếu giá min > ngân sách, giải thích lý do và gợi ý giải pháp.
  3. **Đưa ra 2 lựa chọn hành động:**
     - *Giải pháp tự đặt:* Hướng dẫn mở Booking Form, chọn “Phòng Standard / Flash Sale”, nhập mã khuyến mãi đang có (vd: MA3005) để giảm thêm.
     - *Giải pháp hỗ trợ nhanh:* Nhấn nút “Chat với nhân viên” hoặc gọi hotline để giữ suất hủy phút chót.
  4. **Đề xuất bổ sung:** đặt trước ≥7 ngày để nhận Early Bird, hoặc theo dõi mục Khuyến mãi trong app.
- **Câu trả lời mẫu:**
  ```
  Giá thấp nhất hiện tại cho 2 người là 1.500.000 VNĐ/đêm (Phòng Standard). Với ngân sách 800.000 VNĐ bạn có thể:
  1. Đặt sớm và áp dụng mã MA3005 (giảm 300K) → tổng còn khoảng 1.200.000 VNĐ.
  2. Nhấn “Chat với nhân viên” để mình giữ giúp suất phòng phút chót hoặc ghép phòng đang hủy.
  Bạn chọn phương án nào để mình hỗ trợ tiếp nhé?
  ```
- **Biến thể:** khách muốn ở nhiều đêm → gợi ý combo/flash sale; khách sẵn sàng chia sẻ thêm thông tin (thứ tự ưu tiên: ngày linh hoạt, sẵn sàng đặt trước, ok trả trước…).

---

## 2. Promotion & Discount Scenarios

### 2.1 Áp dụng mã hợp lệ
- **Trigger:** “Mã MA3005 giảm bao nhiêu?”, “có ưu đãi nào cho phòng VIP không?”
- **Luồng:**
  1. Hỏi giá trị booking dự kiến, số đêm, loại phòng.
  2. Gọi API `/api/promotions/validate/:code?bookingAmount=&nights=&roomType=`.
  3. Trả lời gồm tên CTKM, % hoặc số tiền giảm, điều kiện (minBookingAmount, minNights, applicableRoomTypes).
  4. Hướng dẫn nhập mã ở bước Thanh toán (Booking Step 3) trong FE.

### 2.2 Mã hết hạn / chưa đến ngày
- Nếu API trả `400 expired`, giải thích: “Mã chỉ áp dụng đến dd/mm/yyyy. Bạn muốn nhận mã mới? Đăng ký newsletter hoặc theo dõi fanpage.”
- Gợi ý mã public còn hiệu lực (danh sách từ `/api/promotions`).

### 2.3 Không đủ điều kiện giá trị tối thiểu
- Nếu `bookingAmount` < `minBookingAmount`: đề xuất nâng hạng phòng, thêm đêm, hoặc dùng mã khác không yêu cầu tối thiểu.
- Nhắc rõ mức tối thiểu bằng `toLocaleString('vi-VN')`.

### 2.4 Không đúng loại phòng
- Khi response báo “không áp dụng cho roomType”, gợi ý các loại phòng hợp lệ (ví dụ: Deluxe, VIP).
- Nếu khách muốn giữ mã → đề nghị đổi phòng tương ứng.

### 2.5 Đã hết lượt / vượt giới hạn người dùng
- Nếu `usageLimit` đạt tối đa: đề xuất danh sách mã khác hoặc ưu đãi nội bộ (ví dụ đặt 3 đêm tặng spa 30 phút).
- Nếu vượt `maxUsagePerUser`: nhắc mỗi tài khoản/ email chỉ dùng X lần, hướng dẫn dùng mã khác.

### 2.6 Gợi ý mã tự động
- Khi khách chưa có mã, chatbot có thể truy cập `/api/promotions` lọc `isPublic=true` + theo roomType để giới thiệu 2 mã nổi bật (ví dụ: “SUMMER25 giảm 25% cho Deluxe, tối đa 2 lần sử dụng”).
- Kèm lưu ý nhập mã trước bước thanh toán, nếu lỗi hãy gửi ảnh màn hình + thời gian cho đội CSKH.

---

## 3. Post-booking & Support Scenarios

### 3.1 Xác nhận & gửi chứng từ
- Sau khi hoàn tất, chatbot tóm tắt: mã booking, phòng, check-in/out, tổng tiền, phương thức thanh toán.
- Hỏi khách cần hóa đơn VAT hay không → hướng dẫn gửi thông tin công ty qua email.

### 3.2 Hỏi tình trạng phòng/giờ nhận
- Dựa trên chính sách check-in 14:00, check-out 12:00.
- Nếu khách đến sớm: đề nghị gửi hành lý, hoặc đăng ký early check-in (phí thêm, tùy phòng).

### 3.3 Upsell dịch vụ tại chỗ
- Nếu khách ở Suite/VIP: gợi ý spa, lounge, dịch vụ đưa đón.
- Nếu khách ở Standard nhưng ở ≥2 đêm: đề xuất nâng hạng với phụ phí ưu đãi.

### 3.4 Chăm sóc sau lưu trú
- Sau check-out, chatbot hỏi cảm nhận, mời đánh giá trên Google/Facebook.
- Nếu phàn nàn: thu thông tin, tạo ticket gửi `support@rayalhotel.vn`.

---

## 4. Hướng dẫn triển khai vào chatbot RAG

1. **Ưu tiên nạp file này** cùng `faq.md`, `policies.md`, `rooms-info.md`, `services.md` vào vector store (script `scripts/ingestKnowledgeBase.js`).
2. **Metadata gợi ý:** thêm tags `scenario:booking`, `scenario:promotion` để bot biết context.
3. **Prompt đề xuất:**
   - “Nếu câu hỏi liên quan đến đặt phòng/hủy/khuyến mãi → tham chiếu `chatbot-scenarios.md` trước, sau đó kết hợp dữ liệu phòng/dịch vụ.”
4. **Theo dõi 4 KPI:** tỉ lệ giải đáp đủ thông tin, số lần chuyển người thật, % mã áp dụng thành công, CSAT sau chat.

Tài liệu này bao phủ các hành vi chiếm ~85% câu hỏi phổ biến (đặt phòng, khuyến mãi, thanh toán, hủy đổi, dịch vụ phụ). Các tình huống đặc thù (sự kiện lớn, đoàn MICE) có thể bổ sung thêm sub-scenario khi phát sinh.

