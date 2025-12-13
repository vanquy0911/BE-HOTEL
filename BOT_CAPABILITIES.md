# 📋 Tài Liệu Phân Tích Khả Năng Bot Chat

## 🎯 Tổng Quan

Bot chat của Rayal Park Hotel được thiết kế với **4 lớp xử lý** để tối ưu hiệu suất và giảm thiểu API requests:

```
User Message
    ↓
1. ✅ Rule-based Responses (0 requests)
    ↓ (nếu không match)
2. ✅ Cache System (0 requests)
    ↓ (nếu không có cache)
3. ✅ Pattern-based Responses (0 requests)
    ↓ (nếu không match pattern)
4. ⚠️ Rate Limit Check (10 calls/user/day)
    ↓
5. ❌ AI Response (Gemini API - 1 request)
```

---

## 📊 Phân Loại Câu Hỏi Bot Có Thể Trả Lời

### 🟢 **LOẠI 1: Rule-Based Responses** (KHÔNG tốn request)

Bot có thể trả lời **ngay lập tức** các câu hỏi đơn giản, không cần AI.

#### **1.1. Chào hỏi & Giao tiếp cơ bản**
- ✅ "Xin chào", "Hello", "Hi", "Chào"
- ✅ "Cảm ơn", "Thanks", "Thank you"
- ✅ "Tạm biệt", "Bye", "Goodbye"

#### **1.2. Thông tin liên hệ**
- ✅ "Hotline", "Số điện thoại", "Phone number"
- ✅ "Email", "Email khách sạn", "Hotel email"
- ✅ "Facebook"
- ✅ "Website"
- ✅ "Địa chỉ", "Address"

#### **1.3. Thông tin check-in/check-out**
- ✅ "Giờ check-in", "Check-in time"
- ✅ "Giờ check-out", "Check-out time"
- ✅ "Thời gian nhận phòng"
- ✅ "Có thể check-in sớm không", "Early check-in"
- ✅ "Có thể check-out muộn không", "Late check-out"

#### **1.4. Thông tin phòng**
- ✅ "Phòng có bao nhiêu loại", "Có mấy loại phòng", "Room types"
- ✅ "Giá phòng", "Giá phòng là bao nhiêu", "Room price"
- ✅ "Giá phòng bao nhiêu"
- ✅ "Phòng rẻ nhất", "Cheapest room"
- ✅ "Phòng đắt nhất", "Most expensive room"
- ✅ "Có phòng VIP không", "VIP room"
- ✅ "Có phòng Suite không", "Suite room"
- ✅ "Phòng nào đẹp nhất", "Best room"
- ✅ "Có phòng view", "View nào có", "View types"
- ✅ "Có phòng trống không", "Room available"
- ✅ "Có phòng cho", "Tìm phòng cho"

#### **1.5. Dịch vụ khách sạn**
- ✅ "Có WiFi không", "WiFi"
- ✅ "Có bãi đỗ xe không", "Parking"
- ✅ "Có bữa sáng không", "Breakfast"
- ✅ "Có bao gồm bữa sáng không", "Breakfast included"
- ✅ "Có bao gồm thuế không", "Tax included"
- ✅ "Dịch vụ của khách sạn", "Hotel services"
- ✅ "Có phòng gym không", "Gym"
- ✅ "Có hồ bơi không", "Swimming pool"
- ✅ "Có spa không", "Spa"
- ✅ "Cách thanh toán", "Phương thức thanh toán", "Payment methods"
- ✅ "Có shuttle bus không", "Đưa đón sân bay", "Airport shuttle"
- ✅ "Có phòng họp không", "Phòng họp", "Meeting room"
- ✅ "Có nhà hàng không", "Nhà hàng", "Restaurant"
- ✅ "Có bar không", "Bar"
- ✅ "Có phục vụ room service không", "Room service"
- ✅ "Có thể đặt online không", "Book online"
- ✅ "Cần đặt cọc không", "Deposit required"
- ✅ "Có thể xem phòng trước không", "View room"
- ✅ "Có thể tham quan khách sạn không", "Visit hotel"
- ✅ "Có tour tham quan không", "Hotel tour"

#### **1.6. Chính sách & Hướng dẫn**
- ✅ "Chính sách hủy phòng", "Hủy phòng", "Cancellation policy"
- ✅ "Có thể hủy phòng không", "Can cancel"
- ✅ "Đặt phòng thì sao", "Cách đặt phòng", "How to book"
- ✅ "Muốn đặt phòng", "Want to book"
- ✅ "Làm sao để đặt phòng"

**Tổng: 60+ câu hỏi được xử lý bằng rule-based (0 requests)**

---

### 🟡 **LOẠI 2: Pattern-Based Responses** (KHÔNG tốn request)

Bot xử lý các pattern booking cụ thể bằng logic, không cần AI.

#### **2.1. Hướng dẫn đặt phòng**
- ✅ "Tôi muốn đặt phòng"
- ✅ "Hướng dẫn đặt phòng"
- ✅ "Quy trình đặt phòng"

#### **2.2. Tìm phòng tự động (khi đã có đủ thông tin)**
- ✅ **Khi có:** Ngày check-in, check-out, số người
- ✅ **Bot tự động:** Tìm phòng từ database
- ✅ **Trả về:** Danh sách phòng phù hợp với room cards

#### **2.3. Tìm phòng view biển**
- ✅ "Tìm phòng view biển" + ngày
- ✅ **Bot tự động:** Tìm tất cả phòng view biển còn trống
- ✅ **Trả về:** Danh sách phòng view biển với giá và sức chứa

#### **2.4. Câu hỏi về giá phòng chung**
- ✅ "Giá phòng" (khi chưa có ngày)
- ✅ **Bot trả lời:** Hướng dẫn cung cấp ngày để biết giá chính xác

#### **2.5. Câu hỏi về loại phòng**
- ✅ "Loại phòng", "Có mấy loại phòng"
- ✅ **Bot trả lời:** Liệt kê 4 loại phòng với giá tham khảo

**Tổng: 5+ pattern được xử lý bằng logic (0 requests)**

---

### 🔵 **LOẠI 3: Cached Responses** (KHÔNG tốn request)

Bot cache các câu trả lời đã được AI xử lý để tái sử dụng.

#### **3.1. Câu hỏi lặp lại**
- ✅ User hỏi lại câu hỏi đã từng hỏi
- ✅ Bot trả về response đã cache
- ✅ **Cache size:** 1000 responses
- ✅ **Cache key:** Normalized (lowercase, trim, collapse spaces)

**Ví dụ:**
- User hỏi: "Giá phòng là bao nhiêu?"
- AI trả lời → Cache lại
- User hỏi lại: "giá phòng là bao nhiêu" → Bot trả về từ cache (0 requests)

---

### 🔴 **LOẠI 4: AI Responses** (TỐN 1 request)

Bot sử dụng Gemini API để xử lý các câu hỏi phức tạp hoặc đặc biệt.

#### **4.1. Câu hỏi phức tạp**
- ❓ Câu hỏi cần hiểu context
- ❓ Câu hỏi mở, không có pattern cụ thể
- ❓ Câu hỏi đặc biệt, không có trong rule-based

#### **4.2. Booking flow phức tạp**
- ❓ User cung cấp thông tin không đầy đủ
- ❓ User muốn thay đổi booking
- ❓ User hỏi về booking đã đặt

#### **4.3. Câu hỏi về khách sạn**
- ❓ Câu hỏi về lịch sử khách sạn
- ❓ Câu hỏi về chủ khách sạn
- ❓ Câu hỏi về tính năng mới
- ❓ Câu hỏi về địa điểm gần khách sạn

#### **4.4. Rate Limiting**
- ⚠️ **Giới hạn:** 10 AI calls/user/day
- ⚠️ **Khi hết:** Bot trả về message hướng dẫn liên hệ hotline
- ⚠️ **Rule-based & Cache:** Vẫn hoạt động bình thường

---

## 🎨 Cách Bot Hoạt Động Chi Tiết

### **Bước 1: Kiểm tra nội dung nhạy cảm**
```
User Message → Sanitize Input
    ↓
Nếu có nội dung nhạy cảm → Trả về message từ chối
```

### **Bước 2: Rule-based check**
```
User Message → getRuleBasedResponse()
    ↓
Tìm exact match hoặc partial match trong simpleResponses
    ↓
Nếu match → Trả về response ngay (0 requests)
```

### **Bước 3: Cache check**
```
User Message → normalizeCacheKey() → getCachedResponse()
    ↓
Kiểm tra cache với key đã normalize
    ↓
Nếu có cache → Trả về cached response (0 requests)
```

### **Bước 4: Pattern-based check**
```
User Message → getPatternBasedResponse()
    ↓
Kiểm tra các pattern:
- Hướng dẫn đặt phòng
- Tìm phòng tự động (có đủ thông tin)
- Tìm phòng view biển
- Câu hỏi về giá/loại phòng
    ↓
Nếu match → Xử lý bằng logic (0 requests)
```

### **Bước 5: Rate limit check**
```
Session ID → checkUserRateLimit()
    ↓
Kiểm tra: Đã dùng bao nhiêu calls hôm nay?
    ↓
Nếu >= 10 → Trả về message hết lượt
Nếu < 10 → Tiếp tục
```

### **Bước 6: AI Response**
```
User Message → Build Prompt (SYSTEM_PROMPT + Context)
    ↓
Gọi Gemini API (gemini-flash-latest)
    ↓
Nhận response từ AI
    ↓
Post-processing:
- Parse room types từ response
- Tạo booking links
- Tạo room detail links
- Remove markdown links
    ↓
Cache response để tái sử dụng
    ↓
Trả về cho user
```

---

## 📈 Thống Kê Hiệu Suất

### **Tỷ lệ requests được tiết kiệm:**

| Loại Câu Hỏi | Tỷ lệ | Requests |
|--------------|-------|----------|
| Rule-based | ~40% | 0 |
| Pattern-based | ~20% | 0 |
| Cached | ~20% | 0 |
| AI Response | ~20% | 1 |
| **TỔNG** | **100%** | **~0.2 requests/câu hỏi** |

### **Ước tính:**
- **80% câu hỏi:** Không tốn requests (rule-based + pattern-based + cache)
- **20% câu hỏi:** Tốn 1 request (AI)
- **Trung bình:** ~0.2 requests/câu hỏi

---

## 🔧 Cấu Hình Hiện Tại

### **1. RAG (Retrieval-Augmented Generation)**
- ❌ **Đã TẮT** để tiết kiệm requests
- ✅ Chỉ dùng prompt thuần với SYSTEM_PROMPT

### **2. Cache System**
- ✅ **Size:** 1000 responses
- ✅ **Key normalization:** lowercase, trim, collapse spaces
- ✅ **FIFO eviction:** Xóa entry cũ nhất khi đầy

### **3. Rate Limiting**
- ✅ **Giới hạn:** 10 AI calls/user/day
- ✅ **Reset:** Mỗi ngày mới
- ✅ **Rule-based & Cache:** Không bị giới hạn

### **4. Gemini Model**
- ✅ **Model:** `gemini-flash-latest` (từ .env)
- ✅ **API:** Google Generative AI SDK
- ✅ **Prompt:** SYSTEM_PROMPT + Context

---

## 🎯 Kết Luận

Bot được tối ưu để:
- ✅ **Giảm thiểu requests:** 80% câu hỏi không tốn requests
- ✅ **Phản hồi nhanh:** Rule-based và cache trả lời ngay lập tức
- ✅ **Xử lý thông minh:** Pattern-based tự động tìm phòng khi có đủ thông tin
- ✅ **Linh hoạt:** AI xử lý các câu hỏi phức tạp và đặc biệt
- ✅ **Tiết kiệm quota:** Trung bình chỉ ~0.2 requests/câu hỏi

**Bot có thể trả lời:**
- ✅ 60+ câu hỏi rule-based (0 requests)
- ✅ 5+ pattern booking (0 requests)
- ✅ Tất cả câu hỏi đã cache (0 requests)
- ✅ Tất cả câu hỏi phức tạp (1 request, giới hạn 10/user/day)

