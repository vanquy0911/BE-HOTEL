# 🔧 Hướng Dẫn Sửa Lỗi Chat Bot

## Vấn đề: Bot trả lời "Xin lỗi, tôi gặp sự cố kỹ thuật"

Lỗi này xảy ra khi:
1. ❌ Package `@google/generative-ai` chưa được cài đặt
2. ❌ File `.env` không tồn tại hoặc không có `GEMINI_API_KEY`
3. ❌ API Key không hợp lệ hoặc chưa được thêm

---

## ✅ Giải Pháp

### Cách 1: Sử dụng Mock Responses (Không cần API Key)

Nếu bạn chỉ muốn test chat widget mà không cần AI thật, hệ thống sẽ tự động dùng mock responses. Không cần làm gì thêm!

**Mock responses sẽ trả lời các câu hỏi:**
- Giá phòng
- Phòng trống
- Chính sách hủy phòng
- Dịch vụ khách sạn
- Đặt phòng

### Cách 2: Tích hợp Gemini API (Để có AI thật)

**Bước 1: Cài đặt Package**
```bash
cd BE-HOTEL
npm install @google/generative-ai
```

**Bước 2: Tạo file .env (nếu chưa có)**

Tạo file `.env` trong thư mục `BE-HOTEL` với nội dung:
```env
# MongoDB
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
PORT=5000

# Gemini API (thêm dòng này)
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Bước 3: Lấy API Key**

1. Truy cập: https://aistudio.google.com/app/apikey
2. Đăng nhập bằng Google account
3. Click "Create API Key"
4. Copy API Key và thay vào file `.env`

**Bước 4: Restart Server**
```bash
npm start
```

**Bước 5: Kiểm tra Console**

Khi server start, bạn sẽ thấy:
- ✅ `Gemini API initialized successfully` → Thành công!
- ⚠️ `GEMINI_API_KEY not found` → Kiểm tra lại file `.env`
- ⚠️ `Package @google/generative-ai chưa được cài đặt` → Chạy `npm install`

---

## 🔍 Kiểm Tra

### 1. Kiểm tra Package đã cài chưa:
```bash
cd BE-HOTEL
npm list @google/generative-ai
```

### 2. Kiểm tra file .env:
- Mở file `.env` trong thư mục `BE-HOTEL`
- Kiểm tra có dòng `GEMINI_API_KEY=...`
- Đảm bảo không có khoảng trắng thừa

### 3. Kiểm tra Console khi start server:
- Xem log khi `npm start`
- Tìm dòng "Gemini API initialized" hoặc warning

---

## 📝 Lưu Ý

- **Mock responses** vẫn hoạt động tốt cho development
- **Gemini API** cần thiết cho production và demo đồ án
- Free tier: 60 requests/phút (đủ cho testing)
- API Key giữ bí mật, không commit vào Git

---

## 🎯 Trạng Thái Hiện Tại

Sau khi cập nhật code, hệ thống sẽ:
- ✅ Tự động dùng mock responses nếu không có API key
- ✅ Hiển thị warning rõ ràng trong console
- ✅ Không crash khi thiếu package hoặc API key
- ✅ Bot vẫn trả lời được các câu hỏi cơ bản

---

**Sau khi làm theo hướng dẫn, restart server và test lại!** 🚀





