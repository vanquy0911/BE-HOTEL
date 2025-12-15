# Kịch Bản Test RAG - Chatbot Rayal Park Hotel

File này chứa các kịch bản test để kiểm tra RAG (Retrieval-Augmented Generation) hoạt động đúng.

---

## ⚠️ LƯU Ý TRƯỚC KHI TEST

### Các tính năng đã disable để test RAG:
- ✅ Cache (tạm thời disabled)
- ✅ Rule-based responses (tạm thời disabled)
- ✅ ServiceMap loop (tạm thời disabled)
- ✅ Các pattern về dịch vụ (Pattern 1.15, 1.31, 1.46, 1.49, 2.11, 2.12, 4.1-4.5)
- ✅ Các pattern về thông tin khách sạn (Pattern 6.1-6.4)
- ✅ Pattern về an ninh (Pattern 2.31)
- ✅ Pattern về địa điểm gần (Pattern 1.19)

### Các tính năng vẫn hoạt động:
- ✅ Pattern booking (đổi ngày, chọn phòng, xác nhận booking)
- ✅ Pattern conversation (chào hỏi, cảm ơn)
- ✅ AI Fallback với RAG

---

## 📋 KỊCH BẢN TEST RAG

### Test 1: Câu hỏi về dịch vụ khách sạn

**Mục đích:** Kiểm tra RAG có retrieve được thông tin về dịch vụ từ knowledge-base không.

#### Câu hỏi 1.1: Dịch vụ tổng quát
```
"Khách sạn có những dịch vụ gì?"
```

**Kết quả mong đợi:**
- ✅ Log: `🔍 RAG: Searching for: "..."`
- ✅ Log: `📚 RAG: Retrieved X relevant documents`
- ✅ Bot trả lời về các dịch vụ dựa trên knowledge-base
- ✅ Response có thông tin từ `services.md` hoặc `chatbot-scenarios.md`

#### Câu hỏi 1.2: Dịch vụ spa
```
"Khách sạn có spa không?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG (không match pattern)
- ✅ Bot trả lời về spa dựa trên knowledge-base

#### Câu hỏi 1.3: Dịch vụ ăn uống
```
"Khách sạn có nhà hàng không?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời về nhà hàng từ knowledge-base

---

### Test 2: Câu hỏi về lịch sử khách sạn

**Mục đích:** Kiểm tra RAG có retrieve được thông tin về lịch sử từ knowledge-base không.

#### Câu hỏi 2.1: Năm thành lập
```
"Khách sạn thành lập năm nào?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời: **2015** (không phải 2010)
- ✅ Thông tin từ knowledge-base

#### Câu hỏi 2.2: Lịch sử hình thành
```
"Kể cho tôi nghe về lịch sử hình thành của khách sạn"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời chi tiết về lịch sử từ knowledge-base
- ✅ Timeline: 2015 (Khởi Nghiệp), 2018 (Mở Rộng), 2020 (5 Sao)

---

### Test 3: Câu hỏi về chủ khách sạn

**Mục đích:** Kiểm tra RAG có retrieve được thông tin về chủ khách sạn không.

#### Câu hỏi 3.1: Chủ khách sạn
```
"Ai là chủ khách sạn?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời về chủ khách sạn từ knowledge-base

---

### Test 4: Câu hỏi về địa điểm gần

**Mục đích:** Kiểm tra RAG có retrieve được thông tin về địa điểm gần không.

#### Câu hỏi 4.1: Địa điểm gần
```
"Có những địa điểm nào gần khách sạn?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời về địa điểm gần từ knowledge-base

---

### Test 5: Câu hỏi phức tạp, tự do

**Mục đích:** Kiểm tra RAG có xử lý được câu hỏi tự do, không theo pattern không.

#### Câu hỏi 5.1: Câu hỏi tự do
```
"Tôi muốn biết khách sạn có những gì đặc biệt?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời dựa trên knowledge-base
- ✅ Response tự nhiên, không cứng nhắc

#### Câu hỏi 5.2: Câu hỏi kết hợp
```
"Khách sạn có dịch vụ gì cho gia đình có trẻ em?"
```

**Kết quả mong đợi:**
- ✅ Gọi RAG
- ✅ Bot trả lời về dịch vụ cho trẻ em từ knowledge-base

---

## 🔍 KIỂM TRA LOG

### Log mong đợi khi RAG hoạt động:

```
[AI Fallback] No rule/cache/pattern/db template matched. Calling Gemini.
🔍 RAG: Searching for: "..."
💾 Cached query embedding (cache size: X)
📊 RAG query count: X/50
🔍 VectorStore.search: Query filter: {}
📊 VectorStore.search: Found X documents in database
✅ VectorStore.search: Returning 2 top results
   Top score: 0.XXX
   Top source: chatbot-scenarios.md (hoặc services.md, policies.md, etc.)
📚 RAG: Retrieved 2 relevant documents
   Top result score: 0.XXX
   Top result source: ...
   Top result preview: ...
```

### Log KHÔNG mong đợi (nếu RAG không được gọi):

```
✅ Using pattern-based response (no API call)
✅ Using rule-based response (no API call)
✅ Using cached response from database (no API call)
```

---

## ✅ CHECKLIST TEST

### Test cơ bản:
- [ ] Test 1.1: Dịch vụ tổng quát → Có gọi RAG
- [ ] Test 1.2: Dịch vụ spa → Có gọi RAG
- [ ] Test 2.1: Năm thành lập → Có gọi RAG, trả lời 2015
- [ ] Test 2.2: Lịch sử hình thành → Có gọi RAG

### Test nâng cao:
- [ ] Test 3.1: Chủ khách sạn → Có gọi RAG
- [ ] Test 4.1: Địa điểm gần → Có gọi RAG
- [ ] Test 5.1: Câu hỏi tự do → Có gọi RAG
- [ ] Test 5.2: Câu hỏi kết hợp → Có gọi RAG

### Kiểm tra chất lượng:
- [ ] Response từ RAG có chính xác không?
- [ ] Response có dựa trên knowledge-base không?
- [ ] Response có tự nhiên, không cứng nhắc không?
- [ ] RAG có retrieve được documents phù hợp không? (score > 0.5)

---

## 🚨 XỬ LÝ LỖI

### Nếu không thấy log RAG:

1. **Kiểm tra cache:**
   - Cache có đang disabled không?
   - Nếu có cache, xóa cache trong database

2. **Kiểm tra pattern:**
   - Pattern có đang match không?
   - Kiểm tra log: `✅ Using pattern-based response`

3. **Kiểm tra rule-based:**
   - Rule-based có đang match không?
   - Kiểm tra log: `✅ Using rule-based response`

4. **Kiểm tra RAG service:**
   - RAG service có available không?
   - Log: `✅ RAG Service loaded`

5. **Kiểm tra vector store:**
   - Vector store có documents không?
   - Chạy: `npm run view-cache` để xem số lượng documents

---

## 📝 GHI CHÉP KẾT QUẢ

Sau mỗi test, ghi lại:
- ✅ Câu hỏi đã hỏi
- ✅ Có gọi RAG không? (Có/Không)
- ✅ RAG retrieve được bao nhiêu documents?
- ✅ Top score là bao nhiêu?
- ✅ Response có chính xác không?
- ✅ Response có dựa trên knowledge-base không?

---

## 🔄 SAU KHI TEST XONG

1. **Bật lại cache:**
   - Uncomment cache check trong `getAIResponse`

2. **Bật lại rule-based:**
   - Uncomment rule-based check trong `getAIResponse`

3. **Bật lại các pattern:**
   - Uncomment các pattern đã disable
   - Đặc biệt: Pattern booking (quan trọng cho booking flow)

4. **Test lại booking flow:**
   - Đảm bảo booking flow vẫn hoạt động bình thường

---

## 📚 TÀI LIỆU THAM KHẢO

- Knowledge-base files: `data/knowledge-base/`
- RAG Service: `services/ragService.js`
- Vector Store: `services/vectorStore.js`
- Response Cache Model: `Models/ResponseCacheModel.js`


