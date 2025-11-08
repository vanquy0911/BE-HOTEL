# 🚀 Tạo File .env - Hướng Dẫn Nhanh

## Bước 1: Tạo file .env

1. Mở thư mục `BE-HOTEL` trong VS Code hoặc text editor
2. Tạo file mới tên `.env` (chú ý có dấu chấm ở đầu)
3. Copy nội dung sau vào file:

```env
# Database Configuration
MONGO_URI=mongodb://localhost:27017/hotel_db

# JWT Secret Key
JWT_SECRET=your_super_secret_jwt_key_here_change_this

# Server Configuration
PORT=5000

# Gemini API Key
GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

4. **Lưu file** (Ctrl + S)

---

## ⚠️ Lưu Ý Quan Trọng

- File `.env` phải nằm trong thư mục `BE-HOTEL`
- API key phải chính xác, không có khoảng trắng thừa
- Nếu bạn đã có file `.env` với MONGO_URI và JWT_SECRET rồi, chỉ cần thêm dòng:
  ```env
  GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
  ```

---

## Bước 2: Restart Server

Sau khi tạo file `.env`, restart server:

```bash
npm start
```

---

## Bước 3: Kiểm Tra Console Log

Khi server start, bạn sẽ thấy:

**✅ Thành công:**
```
✅ Gemini API initialized successfully
```

**⚠️ Nếu vẫn lỗi:**
- Kiểm tra lại file `.env` có đúng tên không (`.env` không phải `env`)
- Kiểm tra API key có đúng không
- Đảm bảo không có khoảng trắng thừa

---

## ✅ Hoàn Thành!

Sau đó test chat widget trên frontend! 🎉





