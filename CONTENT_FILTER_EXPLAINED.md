# 🛡️ Giải Thích Về Content Filtering

## Hai Lớp Bảo Vệ

### Lớp 1: Gemini API Safety Settings (TỰ ĐỘNG) ✅

**Không cần thêm từ khóa!**

Gemini API đã có built-in AI để tự động phát hiện và chặn:
- ✅ Nội dung khiêu dâm
- ✅ Bạo lực
- ✅ Ngôn từ thù địch
- ✅ Quấy rối
- ✅ Nội dung nguy hiểm

**Ví dụ tự động chặn:**
- "Cách giết người" → Tự động chặn
- "Phim người lớn" → Tự động chặn
- "Bạo lực" → Tự động chặn
- Bất kỳ nội dung nhạy cảm nào → Tự động chặn

---

### Lớp 2: Custom Filter (TỰ THÊM TỪ KHÓA) ⚙️

**Cần thêm từ khóa nếu muốn chặn thêm!**

Custom filter chặn TRƯỚC KHI gửi đến Gemini, nhanh hơn và tiết kiệm API calls.

**Khi nào cần thêm từ khóa:**
1. Từ khóa tiếng Việt cụ thể
2. Từ lóng, từ viết tắt
3. Từ khóa đặc thù cho ngành khách sạn
4. Từ khóa spam/abuse

---

## 📝 Cách Thêm Từ Khóa

### File cần sửa: `Controller/chatController.js`

Tìm đến dòng ~201-213 (phần `SENSITIVE_KEYWORDS`):

```javascript
const SENSITIVE_KEYWORDS = [
  // Explicit content
  'sex', 'porn', 'xxx', 'nude', 'naked', 'adult', 'erotic',
  // Violence
  'kill', 'murder', 'violence', 'weapon', 'bomb', 'terrorist', 'assassinate',
  // Hate speech
  'racist', 'discrimination', 'hate', 'nazi',
  // Illegal activities
  'drug', 'cocaine', 'heroin', 'marijuana', 'cannabis',
  // Vietnamese sensitive words
  'phim người lớn', 'khiêu dâm', 'bạo lực', 'ma túy',
  'tự tử', 'giết người', 'sát hại'
  // ✅ THÊM TỪ KHÓA MỚI VÀO ĐÂY
];
```

### Ví dụ thêm từ khóa:

```javascript
const SENSITIVE_KEYWORDS = [
  // ... các từ khóa hiện có ...
  
  // Thêm từ khóa spam
  'spam', 'scam', 'lừa đảo',
  
  // Thêm từ khóa chính trị (nếu cần)
  'chính trị', 'cổ động',
  
  // Thêm từ khóa khác
  'your_keyword_here'
];
```

---

## 🎯 Khi Nào Cần Thêm Từ Khóa?

### ✅ Nên thêm nếu:
- Từ khóa tiếng Việt cụ thể mà Gemini có thể bỏ sót
- Từ lóng, từ viết tắt
- Từ khóa spam/abuse đặc thù
- Từ khóa liên quan đến chính sách công ty

### ❌ Không cần thêm nếu:
- Từ khóa tiếng Anh phổ biến (Gemini đã chặn)
- Nội dung nhạy cảm rõ ràng (Gemini đã chặn)
- Từ khóa generic (Gemini đã chặn)

---

## 💡 Khuyến Nghị

### Cho đồ án khách sạn:

**Từ khóa đã có (đủ dùng):**
- ✅ Các từ khóa nhạy cảm cơ bản đã có
- ✅ Gemini tự động chặn phần lớn nội dung nhạy cảm
- ✅ Không cần thêm nhiều

**Nếu muốn mở rộng, thêm:**
- Từ khóa spam: 'spam', 'scam', 'lừa đảo'
- Từ khóa marketing: 'quảng cáo', 'bán hàng' (nếu muốn chặn)
- Từ khóa abuse: 'spam bot', 'abuse'

---

## 🧪 Test

### Test với Gemini tự động:
- "Cách giết người" → ✅ Gemini tự động chặn
- "Nội dung khiêu dâm" → ✅ Gemini tự động chặn
- "Bạo lực" → ✅ Gemini tự động chặn

### Test với Custom Filter:
- "phim người lớn" → ✅ Custom filter chặn (từ khóa tiếng Việt)
- "ma túy" → ✅ Custom filter chặn (từ khóa tiếng Việt)

---

## 📊 Kết Luận

1. **Gemini tự động chặn** → Không cần thêm từ khóa
2. **Custom filter** → Chỉ thêm từ khóa tiếng Việt hoặc từ đặc thù
3. **Hiện tại đã đủ** → Cho đồ án khách sạn, danh sách hiện tại đã đủ tốt

---

**Bạn muốn thêm từ khóa nào không? Hoặc giữ nguyên như hiện tại?** 🎯





