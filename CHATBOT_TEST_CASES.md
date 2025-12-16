# Chatbot Test Cases - Các Câu Hỏi Tình Huống

File này chứa các câu hỏi test cases để kiểm tra các tình huống đã được train trong `chatController.js`.

---

## ⚠️ QUAN TRỌNG: CÁCH CHATBOT HOẠT ĐỘNG

### 🔄 Chatbot Duy Trì Cuộc Hội Thoại Liền Mạch

Chatbot **KHÔNG** trả lời độc lập từng câu hỏi. Thay vào đó, chatbot:

1. **Lưu Context vào Session Database:**
   - `selectedRoom`: Phòng đã chọn
   - `bookingContext`: Thông tin booking (ngày, số khách, roomId, email, phone)
   - `lastRoomSearchResults`: Danh sách phòng đã tìm
   - `exploreContext`: Context cho explore intents
   - `language`: Ngôn ngữ (vi/en)

2. **Restore Context mỗi lần chat:**
   - Context được restore từ session database trước khi xử lý message mới
   - Bot nhớ toàn bộ thông tin đã cung cấp trong cuộc hội thoại

3. **Sử dụng Conversation History:**
   - Bot lấy 10 tin nhắn gần nhất để có context đầy đủ
   - AI có thể hiểu ngữ cảnh và trả lời phù hợp với cuộc hội thoại

### 🎯 Chatbot Xử Lý Câu Hỏi Tự Do (Không Bắt Buộc Theo Flow)

**Chatbot HOÀN TOÀN có thể xử lý các câu hỏi tự do của khách hàng**, không cần phải theo flow đã cấu hình.

#### Cách Bot Xử Lý Câu Hỏi:

1. **Pattern-Based Response (Ưu tiên 1 - Không tốn API):**
   - Xử lý các pattern đã được cấu hình sẵn (ví dụ: "đặt phòng", "giá phòng", "chính sách hủy")
   - Trả lời nhanh, chính xác, không cần gọi AI

2. **Rule-Based Response (Ưu tiên 2 - Không tốn API):**
   - Xử lý các rule đơn giản (ví dụ: chào hỏi, cảm ơn, tạm biệt)
   - Trả lời ngay lập tức

3. **AI Fallback (Gemini) - Xử Lý Câu Hỏi Tự Do:**
   - **Khi không match pattern/rule**, bot sẽ gọi Gemini AI
   - **Bot có đầy đủ context:**
     - Conversation history (10 tin nhắn gần nhất)
     - Selected room, booking context, room list
     - Explore context (nếu có)
     - SYSTEM_PROMPT với hướng dẫn chi tiết
   - **AI hiểu ngữ cảnh và trả lời tự nhiên**, không cần theo flow cứng nhắc

#### Ví Dụ Câu Hỏi Tự Do Bot Có Thể Xử Lý:

```
✅ "Cho tôi biết về khách sạn"
✅ "Khách sạn có gì hay không?"
✅ "Tôi muốn đi nghỉ dưỡng, bạn tư vấn giúp"
✅ "Phòng nào view đẹp nhất?"
✅ "Có phòng nào rẻ không?"
✅ "Tôi có 2 người lớn và 1 bé 5 tuổi, phòng nào phù hợp?"
✅ "Khách sạn có gần biển không?"
✅ "Có thể check-in sớm không?"
✅ "Tôi muốn đặt phòng nhưng chưa chắc ngày"
✅ "So sánh giúp tôi phòng VIP và Suite"
✅ "Có dịch vụ gì cho trẻ em không?"
✅ "Tôi muốn tổ chức tiệc sinh nhật ở khách sạn"
```

**Bot sẽ:**
- Hiểu ý định của khách (dù không dùng từ khóa chính xác)
- Trả lời tự nhiên, phù hợp với ngữ cảnh
- Nhớ thông tin đã nói trước đó
- Hướng dẫn khách theo flow booking nếu cần

### ✅ Ví Dụ Cuộc Hội Thoại Liền Mạch:

```
User: "Tôi muốn đặt phòng từ 25/12/2024 đến 27/12/2024 cho 2 người"
Bot: [Tìm phòng và hiển thị danh sách]

User: "Phòng số 1"
Bot: [Chọn phòng số 1, lưu vào context.selectedRoom]

User: "Phòng này có gì"
Bot: [Hiển thị amenities của phòng số 1 - bot NHỚ phòng đã chọn]

User: "Đổi phòng số 2"
Bot: [Chọn phòng số 2, cập nhật context.selectedRoom]

User: "Tiện ích phòng này"
Bot: [Hiển thị amenities của phòng số 2 - bot NHỚ đã đổi phòng]

User: "Email: nguyenvana@gmail.com"
Bot: [Lưu email vào bookingContext, vẫn nhớ phòng đã chọn]

User: "Xác nhận đặt phòng"
Bot: [Tạo booking với tất cả thông tin đã lưu]
```

### 📝 Lưu Ý Khi Test:

- **Test theo flow liền mạch:** Các câu hỏi phải được test theo thứ tự trong một cuộc hội thoại
- **Bot nhớ context:** Bot sẽ nhớ thông tin từ các câu hỏi trước đó
- **Không cần lặp lại:** User không cần nhắc lại thông tin đã cung cấp
- **Context persist:** Context được lưu vào database, vẫn còn sau khi refresh trang

---

## 📋 MỤC LỤC

1. [Booking Patterns](#1-booking-patterns)
2. [Room Selection](#2-room-selection)
3. [Room Amenities & Details](#3-room-amenities--details)
4. [Change Date Patterns](#4-change-date-patterns)
5. [Explore Intents](#5-explore-intents)
6. [Service & Policy Patterns](#6-service--policy-patterns)
7. [Payment Patterns](#7-payment-patterns)
8. [Cancellation Patterns](#8-cancellation-patterns)
9. [General Booking Questions](#9-general-booking-questions)
10. [Free-Form Questions (Câu Hỏi Tự Do)](#10-free-form-questions-câu-hỏi-tự-do)

---

## 1. BOOKING PATTERNS

### Pattern 0: Full Booking Request (Tự động parse và tìm phòng)

```
✅ Tôi muốn đặt phòng từ ngày 25/12/2024 đến 27/12/2024 cho 2 người
✅ Đặt phòng 25/12/2024 đến 27/12/2024 cho 2 người
✅ Tôi muốn đặt phòng từ ngày mai đến ngày kia cho 3 người
✅ Book room from 25/12/2024 to 27/12/2024 for 2 people
✅ Đặt phòng từ hôm nay đến ngày mai cho 4 người
```

### Pattern 1: General Booking Request (Chưa có đầy đủ thông tin)

```
✅ Tôi muốn đặt phòng
✅ Đặt phòng thì sao
✅ Cách đặt phòng
✅ Làm sao để đặt phòng
✅ Hướng dẫn đặt phòng
✅ Quy trình đặt phòng
```

### Pattern 1.5: Giá phòng chung chung

```
✅ Giá phòng bao nhiêu
✅ Giá bao nhiêu
✅ Room price
✅ Phòng giá bao nhiêu
```

### Pattern 1.6: Loại phòng

```
✅ Có mấy loại phòng
✅ Loại phòng nào
✅ Room types
✅ Khách sạn có những loại phòng gì
```

### Pattern 1.7: Giá theo ngân sách

```
✅ Phòng dưới 2 triệu
✅ Phòng rẻ hơn 3 triệu
✅ Room under 2 million
✅ Ngân sách 2 triệu
✅ Phòng tối đa 5 triệu
```

### Pattern 1.8: Loại phòng cụ thể

```
✅ Tìm phòng VIP
✅ Đặt phòng Suite
✅ Phòng Deluxe
✅ Phòng đơn
✅ Phòng đôi
✅ Book single room
✅ Tìm phòng Standard
```

### Pattern 1.9: Tiện nghi phòng (chung)

```
✅ Phòng có bồn tắm không
✅ Room có balcony không
✅ Phòng có minibar không
✅ Phòng có máy lạnh không
✅ Room có TV không
✅ Phòng có WiFi không
```

### Pattern 1.10: View phòng

```
✅ Phòng view biển
✅ Room view city
✅ Phòng view núi
✅ Phòng view vườn
✅ Phòng view sông
```

### Pattern 1.11: Sức chứa phòng

```
✅ Phòng cho 2 người
✅ Room for 4 people
✅ Phòng dành cho 3 người
✅ Phòng chứa bao nhiêu người
✅ Room capacity
✅ Phòng suitable for 2 guests
```

### Pattern 1.12: So sánh phòng

```
✅ So sánh các phòng
✅ Compare rooms
✅ Phòng khác nhau như thế nào
✅ Difference between rooms
```

### Pattern 1.13: Thời gian lưu trú tối thiểu

```
✅ Đặt tối thiểu 2 đêm
✅ Minimum stay
✅ Có thể đặt 1 đêm không
✅ Can I book 1 night
```

### Pattern 1.14: Chính sách trẻ em

```
✅ Chính sách trẻ em
✅ Trẻ em tính phí không
✅ Children policy
✅ Bé 5 tuổi tính phí không
✅ Trẻ 8 tuổi có tính phí không
✅ Kids fee
```

### Pattern 1.15: Dịch vụ bổ sung

```
✅ Có thể thêm giường phụ không
✅ Extra bed
✅ Thêm bữa sáng
✅ Extra breakfast
✅ Additional service
```

### Pattern 1.16: Thanh toán

```
✅ Thanh toán khi đến
✅ Payment on arrival
✅ Có thể thanh toán tại khách sạn không
✅ Đặt cọc
✅ Deposit required
```

### Pattern 1.17: Hủy/Đổi phòng

```
✅ Hủy phòng
✅ Cancel booking
✅ Có thể hủy phòng không
✅ Đổi phòng
✅ Change booking
✅ Modify booking
```

### Pattern 1.18: Check-in sớm/Check-out muộn

```
✅ Check-in sớm
✅ Early check-in
✅ Check-out muộn
✅ Late check-out
✅ Có thể check-in sớm hơn không
```

### Pattern 1.19: Địa điểm gần

```
✅ Địa điểm gần khách sạn
✅ Nearby places
✅ Có gì gần khách sạn
✅ Quanh khách sạn có gì
✅ What's near the hotel
```

### Pattern 1.20: Ưu đãi/Khuyến mãi

```
✅ Có khuyến mãi không
✅ Promotion
✅ Discount
✅ Ưu đãi
✅ Special offer
✅ Giảm giá
```

### Pattern 1.21: Thời gian tốt nhất để đặt

```
✅ Khi nào nên đặt phòng
✅ Best time to book
✅ Mùa cao điểm
✅ Peak season
✅ Nên đặt khi nào
```

### Pattern 1.22: Phòng trống

```
✅ Phòng trống
✅ Available rooms
✅ Còn trống không
✅ Free room
✅ Kiểm tra phòng trống
```

### Pattern 1.23: Giá theo tuần/tháng

```
✅ Giá theo tuần
✅ Weekly rate
✅ Giá theo tháng
✅ Monthly rate
✅ Đặt 2 tuần
✅ Long term booking
```

### Pattern 1.24: Group booking

```
✅ Đặt nhiều phòng
✅ Group booking
✅ Đặt 5 phòng
✅ Book multiple rooms
```

---

## 2. ROOM SELECTION

### Chọn phòng từ danh sách (số thứ tự)

```
✅ Phòng số 1
✅ Phòng thứ 2
✅ Số 1
✅ Số 2
✅ Room number 1
✅ Chọn phòng số 3
✅ Tôi chọn phòng số 1
```

### Chọn phòng bằng tên

```
✅ Tôi chọn phòng Deluxe
✅ Chọn phòng VIP
✅ Tôi muốn phòng Suite
✅ Book Deluxe room
```

### Xác nhận chọn phòng

```
✅ Đúng rồi
✅ Ok
✅ Vâng
✅ Yes
✅ Đúng
✅ Chọn phòng này
```

---

## 3. ROOM AMENITIES & DETAILS

### Xem tiện ích phòng đã chọn

```
✅ Phòng này có gì
✅ Tiện ích phòng này
✅ Dịch vụ phòng này
✅ Phòng đó có gì
✅ Xem chi tiết phòng này
✅ Room amenities
✅ Phòng đã chọn có gì
```

### Hỏi về tiện ích cụ thể

```
✅ Phòng có bồn tắm không
✅ Room có balcony không
✅ Phòng có minibar không
✅ Phòng có máy giặt không
✅ Room có kitchen không
```

---

## 4. CHANGE DATE PATTERNS

### Đổi ngày (chưa chọn phạm vi)

```
✅ Đổi ngày
✅ Đổi lịch
✅ Thay đổi ngày
✅ Change date
✅ Reschedule
✅ Đổi ngày nhận
✅ Đổi ngày trả
```

### Đổi ngày cho phòng đang xem

```
✅ Đổi ngày phòng này
✅ Giữ phòng này
✅ Keep this room
✅ Đổi ngày phòng đang xem
```

### Xem tất cả phòng trống theo ngày mới

```
✅ Xem tất cả phòng trống
✅ Xem hết phòng
✅ All rooms
✅ Tất cả phòng
✅ Phòng khác
```

### Đổi ngày với ngày cụ thể

```
✅ Đổi ngày từ 25/12 đến 27/12
✅ Change date to 30/12
✅ Đổi sang ngày 28/12
```

---

## 5. EXPLORE INTENTS

### Lịch sử khách sạn

```
✅ Lịch sử khách sạn
✅ Khách sạn thành lập khi nào
✅ Có từ bao giờ
✅ History
✅ Founded when
✅ Câu chuyện khách sạn
✅ Hành trình phát triển
✅ Bao nhiêu năm
```

### Chủ khách sạn

```
✅ Chủ khách sạn
✅ Chủ sở hữu
✅ Người sáng lập
✅ Owner
✅ Founder
✅ Giám đốc
✅ Chủ tịch
```

### Tính năng mới

```
✅ Tính năng mới
✅ Công nghệ mới
✅ Chatbot AI
✅ Đặt phòng online
✅ Quản lý booking
✅ Google Calendar
✅ Thanh toán online
✅ 6 tính năng
✅ New features
✅ Technology features
```

### Địa điểm gần (Nearby)

#### Nhà hàng

```
✅ Nhà hàng gần
✅ Restaurant near
✅ Quán ăn gần
✅ Ăn uống gần
```

#### Điểm tham quan

```
✅ Điểm tham quan
✅ Attraction
✅ Đi chơi đâu
✅ Tham quan gần
```

#### Mua sắm

```
✅ Shopping gần
✅ Mua sắm gần
✅ Cửa hàng gần
```

#### Bệnh viện

```
✅ Bệnh viện gần
✅ Hospital near
```

#### Ngân hàng/ATM

```
✅ Ngân hàng gần
✅ Bank near
✅ ATM gần
```

#### Bưu điện

```
✅ Bưu điện gần
✅ Post office near
```

### Khám phá tổng hợp

```
✅ Khám phá khách sạn
✅ Tìm hiểu khách sạn
✅ Thông tin khách sạn
✅ Giới thiệu khách sạn
✅ Về khách sạn
✅ Khách sạn có gì
✅ Explore hotel
✅ About hotel
```

---

## 6. SERVICE & POLICY PATTERNS

### Dịch vụ khách sạn

```
✅ Dịch vụ khách sạn
✅ Services
✅ Khách sạn có dịch vụ gì
✅ Hotel services
```

### Chính sách trẻ em

```
✅ Chính sách trẻ em
✅ Children policy
✅ Trẻ em tính phí không
✅ Bé 5 tuổi tính phí không
```

### Chính sách thú cưng

```
✅ Chính sách thú cưng
✅ Pet policy
✅ Có được mang thú cưng không
```

### Chính sách hút thuốc

```
✅ Chính sách hút thuốc
✅ Smoking policy
✅ Có được hút thuốc không
```

### Chính sách early/late

```
✅ Chính sách early/late
✅ Early check-in policy
✅ Late check-out policy
```

### Chính sách đặt cọc

```
✅ Chính sách đặt cọc
✅ Deposit policy
✅ Cần đặt cọc không
```

### Chính sách no-show

```
✅ Chính sách no-show
✅ No-show policy
```

### Buffet sáng

```
✅ Buffet sáng
✅ Breakfast
✅ Ăn sáng
```

### Ngôn ngữ hỗ trợ

```
✅ Ngôn ngữ hỗ trợ
✅ Language
✅ Có hỗ trợ tiếng Anh không
```

---

## 7. PAYMENT PATTERNS

### Thanh toán khi đến

```
✅ Thanh toán khi đến
✅ Payment on arrival
✅ Có thể thanh toán tại khách sạn không
✅ Pay at hotel
```

### Đặt cọc

```
✅ Đặt cọc
✅ Deposit
✅ Down payment
✅ Advance payment
✅ Cần đặt cọc không
```

### Phương thức thanh toán

```
✅ Phương thức thanh toán
✅ Payment methods
✅ Thanh toán như thế nào
✅ Cách thanh toán
```

---

## 8. CANCELLATION PATTERNS

### Hủy phòng

```
✅ Hủy phòng
✅ Cancel booking
✅ Có thể hủy phòng không
✅ Cancellation policy
```

### Đổi phòng

```
✅ Đổi phòng
✅ Change booking
✅ Modify booking
✅ Có thể đổi phòng không
```

### Chính sách hủy

```
✅ Chính sách hủy
✅ Cancellation policy
✅ Hủy phòng như thế nào
✅ Phí hủy phòng
```

---

## 9. GENERAL BOOKING QUESTIONS

### Cung cấp thông tin cá nhân

```
✅ Email: nguyenvana@gmail.com
✅ Số điện thoại: 0901234567
✅ Tên tôi là Nguyễn Văn A
✅ Tôi là Nguyễn Văn A
✅ Họ tên: Nguyễn Văn A
✅ Phone: 0901234567
```

### Xác nhận đặt phòng

```
✅ Xác nhận đặt phòng
✅ Confirm booking
✅ Đặt phòng
✅ Book now
✅ Tôi muốn đặt
```

### Hỏi về số khách

```
✅ 2 người lớn và 1 trẻ em 5 tuổi
✅ 2 adults and 1 child age 8
✅ 2 người lớn 1 trẻ em 9 tuổi
✅ 3 người
✅ 2 guests
✅ 2 trẻ em 5 và 8 tuổi
✅ 3 trẻ em 4, 7 và 12 tuổi
```

### Hỏi về ngày

```
✅ Từ 25/12/2024 đến 27/12/2024
✅ 25/12 đến 27/12
✅ Ngày mai đến ngày kia
✅ Hôm nay đến ngày mai
✅ From 25/12 to 27/12
```

---

## 10. FREE-FORM QUESTIONS (Câu Hỏi Tự Do)

### ⚠️ QUAN TRỌNG: Bot Xử Lý Câu Hỏi Tự Do

Bot **HOÀN TOÀN có thể xử lý các câu hỏi tự do** của khách hàng, không cần phải theo flow đã cấu hình. Khi không match pattern/rule, bot sẽ gọi Gemini AI với đầy đủ context để trả lời tự nhiên.

### Câu Hỏi Tự Do Về Khách Sạn

```
✅ Cho tôi biết về khách sạn
✅ Khách sạn có gì hay không?
✅ Giới thiệu về khách sạn
✅ Khách sạn này như thế nào?
✅ Tell me about the hotel
✅ What's special about this hotel?
```

### Câu Hỏi Tự Do Về Đặt Phòng

```
✅ Tôi muốn đi nghỉ dưỡng, bạn tư vấn giúp
✅ Tôi muốn đặt phòng nhưng chưa chắc ngày
✅ Tôi có 2 người lớn và 1 bé 5 tuổi, phòng nào phù hợp?
✅ Phòng nào view đẹp nhất?
✅ Có phòng nào rẻ không?
✅ Phòng nào tốt nhất?
✅ Recommend a room for me
✅ I want to book but not sure about dates
```

### Câu Hỏi Tự Do Về So Sánh

```
✅ So sánh giúp tôi phòng VIP và Suite
✅ Phòng nào đắt hơn?
✅ Phòng VIP và Suite khác nhau như thế nào?
✅ Compare VIP and Suite rooms
✅ What's the difference between room types?
```

### Câu Hỏi Tự Do Về Dịch Vụ

```
✅ Khách sạn có gì chơi không?
✅ Có dịch vụ gì cho trẻ em không?
✅ Khách sạn có spa không?
✅ Có thể tổ chức tiệc ở khách sạn không?
✅ What activities are available?
✅ Is there anything for kids?
```

### Câu Hỏi Tự Do Về Địa Điểm

```
✅ Khách sạn có gần biển không?
✅ Xung quanh có gì không?
✅ Có gần trung tâm không?
✅ Is the hotel near the beach?
✅ What's around the hotel?
```

### Câu Hỏi Tự Do Về Check-in/Check-out

```
✅ Có thể check-in sớm không?
✅ Check-out muộn được không?
✅ Tôi đến sớm thì sao?
✅ Can I check in early?
✅ What if I arrive early?
```

### Câu Hỏi Tự Do Về Giá

```
✅ Phòng rẻ nhất là bao nhiêu?
✅ Có phòng nào dưới 2 triệu không?
✅ Giá tốt nhất là bao nhiêu?
✅ What's the cheapest room?
✅ Any rooms under 2 million?
```

### Câu Hỏi Tự Do Về Chính Sách

```
✅ Hủy phòng như thế nào?
✅ Có thể đổi ngày không?
✅ Trẻ em tính phí không?
✅ How does cancellation work?
✅ Can I change dates?
```

### Câu Hỏi Tự Do Kết Hợp

```
✅ Tôi muốn đặt phòng cho 2 người lớn và 1 bé 5 tuổi, từ 25/12 đến 27/12, phòng nào phù hợp?
✅ Khách sạn có gì hay? Tôi muốn đi nghỉ dưỡng với gia đình
✅ Phòng nào view đẹp và giá tốt nhất?
✅ I want to book for 2 adults and 1 child age 5, from Dec 25 to 27, which room is suitable?
```

### Lưu Ý Khi Test Câu Hỏi Tự Do:

1. **Bot sẽ hiểu ý định** dù không dùng từ khóa chính xác
2. **Bot trả lời tự nhiên** phù hợp với ngữ cảnh
3. **Bot nhớ context** từ các câu hỏi trước đó
4. **Bot hướng dẫn** theo flow booking nếu cần
5. **Bot có thể hỏi lại** nếu thiếu thông tin cần thiết

---

## 📝 LƯU Ý KHI TEST

1. **Test theo flow:** Test từng bước trong booking flow (hỏi thông tin → chọn phòng → xem amenities → đổi phòng → confirm)
2. **Test edge cases:** 
   - Chọn phòng → hỏi amenities → đổi phòng → hỏi amenities lại (phải trả về phòng mới)
   - Đổi ngày khi đã chọn phòng
   - Hỏi amenities khi chưa chọn phòng
3. **Test multilingual:** Test cả tiếng Việt và tiếng Anh
4. **Test context:** Đảm bảo bot nhớ context qua các lượt hỏi
5. **Test error handling:** Test các input không hợp lệ (ngày sai, số người âm, etc.)

---

## 🔍 TEST SCENARIOS QUAN TRỌNG

### Scenario 1: Booking Flow Hoàn Chỉnh

```
1. "Tôi muốn đặt phòng từ 25/12/2024 đến 27/12/2024 cho 2 người"
   → Bot tìm phòng và hiển thị danh sách

2. "Phòng số 1"
   → Bot chọn phòng số 1

3. "Phòng này có gì"
   → Bot hiển thị amenities của phòng số 1

4. "Đổi phòng số 2"
   → Bot chọn phòng số 2

5. "Tiện ích phòng này"
   → Bot phải hiển thị amenities của phòng số 2 (KHÔNG phải phòng số 1)
```

### Scenario 2: Change Date Flow

```
1. "Tôi muốn đặt phòng từ 25/12/2024 đến 27/12/2024 cho 2 người"
   → Bot tìm phòng

2. "Phòng số 1"
   → Bot chọn phòng

3. "Đổi ngày"
   → Bot hỏi: đổi ngày phòng này hay xem tất cả phòng trống

4. "Đổi ngày phòng này"
   → Bot giữ phòng, hỏi ngày mới

5. "Từ 30/12/2024 đến 1/1/2025"
   → Bot kiểm tra phòng này với ngày mới
```

### Scenario 3: Explore Intent Flow

```
1. "Lịch sử khách sạn"
   → Bot trả lời về lịch sử

2. "Chủ khách sạn"
   → Bot trả lời về chủ sở hữu

3. "Tính năng mới"
   → Bot liệt kê 6 tính năng

4. "Nhà hàng gần"
   → Bot hiển thị nhà hàng gần
```

---

**File này được tạo tự động dựa trên các patterns trong `chatController.js`**

