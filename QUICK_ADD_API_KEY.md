# ⚡ Quick Guide: Thêm API Key

## Bước 1: Copy API Key (Đã làm xong ✅)

API Key của bạn là:
```
AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

(Đã copy vào clipboard rồi)

---

## Bước 2: Mở/Tạo file .env

1. Mở thư mục: `D:\Đồ Án Chuyên Ngành\BE-HOTEL`
2. Tìm file `.env` (nếu chưa có thì tạo mới)

---

## Bước 3: Thêm API Key

**Nếu file .env CHƯA TỒN TẠI**, tạo file mới với nội dung:

```env
MONGO_URI=mongodb://localhost:27017/hotel_db
JWT_SECRET=your_jwt_secret_key_here
PORT=5000
GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

**Nếu file .env ĐÃ TỒN TẠI**, thêm dòng này vào cuối:

```env
GEMINI_API_KEY=AlzaSyD9L_WsAm9mFFh-H22gRuMgcthoKhijPus
```

⚠️ **Lưu ý:** Paste chính xác API key, không có khoảng trắng thừa!

---

## Bước 4: Cài Package

Mở terminal trong thư mục `BE-HOTEL`:

```bash
npm install @google/generative-ai
```

---

## Bước 5: Restart Server

```bash
npm start
```

Khi server start, bạn sẽ thấy:
```
✅ Gemini API initialized successfully
```

---

## ✅ Hoàn Thành!

Sau đó test chat widget trên frontend - bot sẽ trả lời bằng AI thật! 🎉





