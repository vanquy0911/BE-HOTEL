# 🚀 Hướng Dẫn Tích Hợp Google Gemini API

## Bước 1: Lấy API Key từ Google AI Studio

### Các bước thực hiện:

1. **Truy cập Google AI Studio:**
   - Mở trình duyệt và vào: https://aistudio.google.com/app/apikey
   - Hoặc: https://makersuite.google.com/app/apikey

2. **Đăng nhập:**
   - Đăng nhập bằng tài khoản Google của bạn
   - (Nếu chưa có, tạo tài khoản Google mới)

3. **Tạo API Key:**
   - Click vào nút **"Create API Key"** hoặc **"Get API Key"**
   - Chọn Google Cloud Project (hoặc tạo project mới)
   - API Key sẽ được tạo và hiển thị ngay

4. **Copy API Key:**
   - Copy API Key (dạng: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)
   - ⚠️ **LƯU Ý:** Giữ bí mật API Key này, không chia sẻ công khai!

5. **Kiểm tra giới hạn:**
   - Free tier: 60 requests/phút
   - Đủ cho development và testing
   - Khi production, có thể nâng cấp

---

## Bước 2: Thêm API Key vào .env

1. **Mở file `.env` trong thư mục `BE-HOTEL`:**
   ```bash
   cd BE-HOTEL
   ```

2. **Thêm dòng sau vào file `.env`:**
   ```env
   GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
   (Thay `AIzaSy...` bằng API Key bạn vừa copy)

3. **Lưu file**

---

## Bước 3: Cài đặt Package

Chạy lệnh sau trong thư mục `BE-HOTEL`:
```bash
npm install @google/generative-ai
```

---

## Bước 4: Kiểm tra

1. **Start server:**
   ```bash
   npm start
   ```

2. **Test chat:**
   - Mở frontend
   - Click vào chat widget
   - Gửi tin nhắn test
   - Nếu không có lỗi, đã tích hợp thành công! ✅

---

## Thông tin cần thiết:

**Chỉ cần 1 thông tin:**
- ✅ **Google Gemini API Key** (từ Google AI Studio)

**Không cần:**
- ❌ Credit card (Free tier)
- ❌ Google Cloud Billing (chỉ cần Google account)
- ❌ Cấu hình phức tạp

---

## Troubleshooting

### Lỗi: "API key not valid"
- Kiểm tra lại API key trong file `.env`
- Đảm bảo không có khoảng trắng thừa
- Copy lại API key từ Google AI Studio

### Lỗi: "Quota exceeded"
- Free tier: 60 requests/phút
- Đợi 1 phút rồi thử lại
- Hoặc nâng cấp plan

### Lỗi: "Module not found"
- Chạy lại: `npm install @google/generative-ai`
- Kiểm tra `package.json` có package này

---

## Link hữu ích:

- 🔗 Google AI Studio: https://aistudio.google.com/
- 🔗 Tạo API Key: https://aistudio.google.com/app/apikey
- 🔗 Documentation: https://ai.google.dev/docs
- 🔗 Pricing: https://ai.google.dev/pricing

---

**Sau khi có API Key, báo lại cho tôi để tôi kiểm tra code tích hợp!** 🎯

