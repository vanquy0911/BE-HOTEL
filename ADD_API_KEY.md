# 🎯 Hướng Dẫn Thêm API Key Vào Project

## Bước 1: Copy API Key từ Google AI Studio

1. **Trong Google AI Studio**, bạn có 2 cách:

   **Cách A - Copy key hiện có:**
   - Tìm dòng có API key `...jPus` (hoặc key khác)
   - Click vào biểu tượng **Copy** (hai hình vuông chồng lên nhau) ở cuối dòng
   - API key sẽ được copy vào clipboard

   **Cách B - Tạo key mới:**
   - Click nút **"Créer une clé API"** (màu xanh, góc trên bên phải)
   - Chọn project (hoặc tạo mới)
   - Copy API key ngay khi hiển thị (chỉ hiện 1 lần!)

---

## Bước 2: Tạo/Update file .env

### Nếu file .env CHƯA TỒN TẠI:

1. Tạo file mới tên `.env` trong thư mục `BE-HOTEL`
2. Thêm nội dung sau:

```env
# Database
MONGO_URI=mongodb://localhost:27017/hotel_db

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_here

# Server Port
PORT=5000

# Gemini API Key (THÊM DÒNG NÀY)
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Thay `AIzaSy...` bằng API key bạn vừa copy!**

### Nếu file .env ĐÃ TỒN TẠI:

1. Mở file `.env` trong thư mục `BE-HOTEL`
2. Thêm dòng này vào cuối file:

```env
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Thay `AIzaSy...` bằng API key bạn vừa copy!**

---

## Bước 3: Lưu File

- **Lưu file** `.env`
- Đảm bảo không có khoảng trắng thừa
- API key phải nằm trên 1 dòng, không xuống dòng

---

## Bước 4: Cài Package (nếu chưa cài)

Mở terminal trong thư mục `BE-HOTEL` và chạy:

```bash
npm install @google/generative-ai
```

---

## Bước 5: Restart Server

```bash
npm start
```

### Kiểm tra Console Log:

Khi server start, bạn sẽ thấy:

**✅ Thành công:**
```
✅ Gemini API initialized successfully
```

**⚠️ Nếu vẫn lỗi:**
- Kiểm tra lại API key trong file `.env`
- Đảm bảo không có khoảng trắng thừa
- Kiểm tra package đã cài: `npm list @google/generative-ai`

---

## 📝 Ví Dụ File .env Hoàn Chỉnh

```env
MONGO_URI=mongodb://localhost:27017/hotel_db
JWT_SECRET=my_super_secret_key_12345
PORT=5000
GEMINI_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567890
```

---

## ✅ Sau Khi Hoàn Thành

1. ✅ API key đã được thêm vào `.env`
2. ✅ Package `@google/generative-ai` đã được cài
3. ✅ Server restart và thấy log "✅ Gemini API initialized successfully"
4. ✅ Test chat widget trên frontend - bot sẽ trả lời tự nhiên hơn!

---

**Lưu ý:** API key bắt đầu bằng `AIzaSy` và có khoảng 39 ký tự. Giữ bí mật, không chia sẻ công khai!

