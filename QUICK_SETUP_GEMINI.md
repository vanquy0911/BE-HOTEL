# ⚡ Quick Setup - Gemini API

## Bước 1: Cài đặt Package

Mở terminal trong thư mục `BE-HOTEL` và chạy:

```bash
npm install @google/generative-ai
```

Hoặc nếu dùng yarn:
```bash
yarn add @google/generative-ai
```

---

## Bước 2: Lấy API Key

1. Truy cập: **https://aistudio.google.com/app/apikey**
2. Đăng nhập bằng Google account
3. Click **"Create API Key"**
4. Copy API Key (dạng: `AIzaSy...`)

---

## Bước 3: Thêm vào .env

Mở file `.env` trong thư mục `BE-HOTEL` và thêm:

```env
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

(Thay `AIzaSy...` bằng API key bạn vừa copy)

---

## Bước 4: Test

1. Start server:
   ```bash
   npm start
   ```

2. Kiểm tra console:
   - Nếu thấy: `✅ Gemini API initialized successfully` → Thành công!
   - Nếu thấy: `⚠️ GEMINI_API_KEY not found` → Kiểm tra lại file .env

3. Test chat trên frontend:
   - Mở website
   - Click chat widget
   - Gửi tin nhắn test
   - Nếu bot trả lời tự nhiên → Đã tích hợp thành công! 🎉

---

## Lưu ý

- **Free tier:** 60 requests/phút (đủ cho development)
- **API Key:** Giữ bí mật, không commit vào Git
- **Fallback:** Nếu không có API key, hệ thống sẽ dùng mock responses

---

## Troubleshooting

**Lỗi: "Module not found"**
- Chạy lại: `npm install @google/generative-ai`

**Lỗi: "API key not valid"**
- Kiểm tra lại API key trong .env
- Đảm bảo không có khoảng trắng thừa

**Lỗi: "Quota exceeded"**
- Free tier: 60 requests/phút
- Đợi 1 phút rồi thử lại

---

✅ **Sau khi hoàn thành, báo lại để tôi kiểm tra!**

