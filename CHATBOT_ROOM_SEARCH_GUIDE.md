# 🎯 Hướng Dẫn Test Chatbot Tìm Phòng

## ✅ Tính Năng Đã Triển Khai

Chatbot hiện tại có thể:
1. ✅ Hiểu yêu cầu tìm phòng (số người, view, loại phòng)
2. ✅ Tự động tìm phòng trong database
3. ✅ Hiển thị danh sách phòng ngay trong chat
4. ✅ Mỗi phòng có nút "Đặt Ngay" để chuyển đến booking form

---

## 🧪 Cách Test

### Test Case 1: Tìm phòng theo số người và view
```
Khách: "Tôi muốn đặt phòng cho 4 người, view biển"
```

**Kết quả mong đợi:**
- Bot trả lời tự nhiên
- Bot hiển thị danh sách phòng phù hợp (maxOccupancy >= 4, view = "biển")
- Mỗi phòng hiển thị: hình ảnh, tên, giá, số người, view
- Có nút "Đặt Ngay" cho mỗi phòng

### Test Case 2: Tìm phòng đơn giản
```
Khách: "Có phòng trống không?"
```

**Kết quả mong đợi:**
- Bot trả lời và hiển thị danh sách phòng có sẵn

### Test Case 3: Tìm phòng VIP
```
Khách: "Tôi muốn phòng VIP cho 2 người"
```

**Kết quả mong đợi:**
- Bot tìm phòng VIP, maxOccupancy >= 2
- Hiển thị danh sách phòng VIP

---

## 📋 Các Câu Hỏi Test

1. **"Tôi muốn đặt phòng cho 4 người, view biển"**
   - Bot sẽ tìm phòng có maxOccupancy >= 4 và view = "biển"

2. **"Phòng view biển"**
   - Bot sẽ tìm tất cả phòng có view = "biển"

3. **"Tìm phòng cho 2 người"**
   - Bot sẽ tìm phòng có maxOccupancy >= 2

4. **"Có phòng VIP không?"**
   - Bot sẽ tìm phòng loại VIP

5. **"Tôi muốn phòng suite"**
   - Bot sẽ tìm phòng loại suite

---

## 🎨 UI/UX Features

### Room Card hiển thị:
- ✅ Hình ảnh phòng (hoặc icon nếu không có)
- ✅ Tên phòng và loại phòng
- ✅ Giá phòng (VNĐ/đêm)
- ✅ Số người tối đa
- ✅ View (biển/núi/thành phố)
- ✅ Tiện nghi (amenities)
- ✅ Nút "Đặt Ngay" (màu hồng, gradient)

### Khi click "Đặt Ngay":
- ✅ Chuyển đến trang `/booking?roomId=xxx`
- ✅ Booking form sẽ tự động load thông tin phòng
- ✅ Khách chỉ cần điền ngày check-in/check-out

---

## 🔍 Kiểm Tra Database

Đảm bảo trong database có ít nhất vài phòng với:
- `maxOccupancy` >= 4
- `view` = "biển" hoặc chứa "biển"
- `available` = true
- `isAvailable` > 0

---

## 🚀 Demo Scenario

1. Khách mở website
2. Click vào chat widget
3. Gửi: "Tôi muốn đặt phòng cho 4 người, view biển"
4. Bot trả lời: "Tôi đã tìm thấy X phòng phù hợp..."
5. Bot hiển thị danh sách phòng với cards đẹp
6. Khách click "Đặt Ngay" trên phòng muốn đặt
7. Chuyển đến booking form với room ID đã chọn
8. Hoàn tất đặt phòng!

---

## ✨ Điểm Mạnh Của Tính Năng Này

1. **Hiện đại** - Giống các khách sạn lớn (Marriott, Hilton)
2. **Tiện lợi** - Khách không cần chuyển trang nhiều lần
3. **Conversion cao** - Giảm friction, tăng booking
4. **Professional** - Thể hiện công nghệ tiên tiến
5. **Phù hợp đồ án** - "AI chatbot hỗ trợ chăm sóc khách hàng đa kênh"

---

## 🐛 Troubleshooting

**Nếu bot không tìm thấy phòng:**
- Kiểm tra database có phòng không
- Kiểm tra phòng có `available: true` và `isAvailable > 0`
- Kiểm tra filter criteria có đúng không

**Nếu không hiển thị rooms:**
- Kiểm tra console log xem API có trả về `rooms` không
- Kiểm tra `ChatMessage` có `rooms` property không
- Kiểm tra `RoomCard` component có render đúng không

---

**Test ngay và báo lại kết quả!** 🎉





