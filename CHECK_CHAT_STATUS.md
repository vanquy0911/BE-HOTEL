# ✅ Checklist Kiểm Tra Chat Bot

## Hiện Tại Bot Đang Ở Chế Độ Nào?

Sau khi restart server (`npm start`), kiểm tra console log:

### Trường Hợp 1: ✅ Gemini API Hoạt Động
```
✅ Gemini API initialized successfully
```
→ **Bot đang dùng AI thật (Gemini API)**

### Trường Hợp 2: ⚠️ Thiếu API Key
```
⚠️  GEMINI_API_KEY not found in .env file, using mock responses
💡 Để sử dụng Gemini API, hãy:
   1. Cài đặt: npm install @google/generative-ai
   2. Thêm vào .env: GEMINI_API_KEY=your_api_key_here
```
→ **Bot đang dùng mock responses (vẫn hoạt động tốt)**

### Trường Hợp 3: ⚠️ Thiếu Package
```
⚠️  Package @google/generative-ai chưa được cài đặt, using mock responses
💡 Chạy lệnh: npm install @google/generative-ai
```
→ **Bot đang dùng mock responses (cần cài package)**

---

## 🔍 Kiểm Tra Chi Tiết

### 1. Kiểm tra Package đã cài chưa:
```bash
cd BE-HOTEL
npm list @google/generative-ai
```

**Nếu chưa có:**
```bash
npm install @google/generative-ai
```

### 2. Kiểm tra file .env:
- Mở file `.env` trong thư mục `BE-HOTEL`
- Kiểm tra có dòng: `GEMINI_API_KEY=...`
- Nếu chưa có, thêm vào:
  ```env
  GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  ```

### 3. Kiểm tra API Key hợp lệ:
- Lấy API Key từ: https://aistudio.google.com/app/apikey
- Copy và paste vào file `.env`
- Đảm bảo không có khoảng trắng thừa

---

## 🎯 Kết Quả Mong Đợi

### Mock Responses (Hiện tại):
- ✅ Bot trả lời được các câu hỏi cơ bản
- ✅ Không có lỗi "sự cố kỹ thuật"
- ✅ Trả lời về: giá phòng, dịch vụ, chính sách

### Gemini API (Sau khi setup):
- ✅ Bot trả lời tự nhiên hơn
- ✅ Hiểu được context cuộc hội thoại
- ✅ Trả lời được câu hỏi phức tạp hơn

---

## 📝 Các Bước Tiếp Theo

1. **Nếu chỉ muốn test chat widget:**
   - Không cần làm gì, mock responses đã đủ tốt!

2. **Nếu muốn có AI thật cho đồ án:**
   - Cài package: `npm install @google/generative-ai`
   - Thêm API key vào `.env`
   - Restart server
   - Kiểm tra console log

---

**Sau khi làm xong, restart server và kiểm tra lại!** 🚀

