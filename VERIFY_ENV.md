# ✅ Kiểm Tra File .env

## Bước 1: Kiểm Tra File .env

Mở file `.env` trong thư mục `BE-HOTEL` và đảm bảo có dòng:

```env
GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

**Lưu ý:**
- ✅ Không có khoảng trắng trước và sau dấu `=`
- ✅ API key phải chính xác: `AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus`
- ✅ File đã được lưu (Ctrl + S)

---

## Bước 2: Restart Server

Sau khi đảm bảo file `.env` đã có API key, restart server:

```bash
npm start
```

---

## Bước 3: Kiểm Tra Console Log

Khi server start, bạn sẽ thấy một trong các dòng sau:

### ✅ Thành Công:
```
✅ Gemini API initialized successfully
```

### ⚠️ Nếu vẫn thấy:
```
⚠️  GEMINI_API_KEY not found in .env file
```

**Có thể do:**
- File `.env` chưa được lưu
- API key chưa được thêm vào
- Có khoảng trắng thừa trong file

---

## Bước 4: Test Chat Widget

1. Start frontend (nếu chưa start)
2. Mở browser và vào website
3. Click vào chat widget (nút ở góc dưới bên phải)
4. Gửi tin nhắn test: "Chào bạn"
5. Bot sẽ trả lời tự nhiên nếu Gemini API đã hoạt động!

---

## 📝 File .env Mẫu Hoàn Chỉnh

Nếu bạn cần tạo lại, file `.env` nên có nội dung:

```env
# Database
MONGO_URI=mongodb://localhost:27017/hotel_db

# JWT Secret
JWT_SECRET=your_jwt_secret_key_here

# Server Port
PORT=5000

# Gemini API Key
GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

---

**Sau khi restart server, báo lại kết quả console log để tôi kiểm tra!** 🚀





