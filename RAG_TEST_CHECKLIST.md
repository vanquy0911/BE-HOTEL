# Checklist Test RAG - Chatbot Rayal Park Hotel

File này chứa checklist chi tiết để test RAG (Retrieval-Augmented Generation).

---

## ✅ TRƯỚC KHI TEST

### Kiểm tra cấu hình:
- [ ] RAG Service đã được load: Log có `✅ RAG Service loaded`
- [ ] Vector Store đã có documents: Log có `📊 VectorStore.search: Found X documents in database` (X > 0)
- [ ] Cache đã disabled: Không thấy log `✅ Using cached response from database`
- [ ] Rule-based đã disabled: Không thấy log `✅ Using rule-based response`
- [ ] Các pattern đã disabled: Không thấy log `✅ Using pattern-based response` cho câu hỏi về dịch vụ/thông tin khách sạn

---

## 📋 CHECKLIST TEST RAG

### Test 1: Câu hỏi về dịch vụ khách sạn

#### Test 1.1: Dịch vụ tổng quát
```
Câu hỏi: "Khách sạn có những dịch vụ gì?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents` (X > 0)
- [ ] Log: `Top result score: 0.XXX` (score > 0.5)
- [ ] Log: `Top result source: services.md` hoặc `chatbot-scenarios.md`
- [ ] KHÔNG có log: `✅ Using cached response`
- [ ] KHÔNG có log: `✅ Using pattern-based response`
- [ ] KHÔNG có log: `✅ Using rule-based response`

**Kiểm tra response:**
- [ ] Bot trả lời về các dịch vụ (nhà hàng, spa, gym, etc.)
- [ ] Response có thông tin từ knowledge-base
- [ ] Response tự nhiên, không cứng nhắc

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

#### Test 1.2: Dịch vụ spa
```
Câu hỏi: "Khách sạn có spa không?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] Log: `Top result score: 0.XXX` (score > 0.5)
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về spa
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

#### Test 1.3: Dịch vụ ăn uống
```
Câu hỏi: "Khách sạn có nhà hàng không?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về nhà hàng
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

### Test 2: Câu hỏi về lịch sử khách sạn

#### Test 2.1: Năm thành lập
```
Câu hỏi: "Khách sạn thành lập năm nào?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời: **2015** (KHÔNG phải 2010)
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

#### Test 2.2: Lịch sử hình thành
```
Câu hỏi: "Kể cho tôi nghe về lịch sử hình thành của khách sạn"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời chi tiết về lịch sử
- [ ] Response có timeline: 2015 (Khởi Nghiệp), 2018 (Mở Rộng), 2020 (5 Sao)
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

### Test 3: Câu hỏi về chủ khách sạn

#### Test 3.1: Chủ khách sạn
```
Câu hỏi: "Ai là chủ khách sạn?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về chủ khách sạn
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

### Test 4: Câu hỏi về địa điểm gần

#### Test 4.1: Địa điểm gần
```
Câu hỏi: "Có những địa điểm nào gần khách sạn?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về địa điểm gần
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

### Test 5: Câu hỏi phức tạp, tự do

#### Test 5.1: Câu hỏi tự do
```
Câu hỏi: "Tôi muốn biết khách sạn có những gì đặc biệt?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về 6 tính năng nổi bật (nếu Gemini API lỗi, dùng RAG fallback)
- [ ] Response có cấu trúc, dễ đọc
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

#### Test 5.2: Câu hỏi kết hợp
```
Câu hỏi: "Khách sạn có dịch vụ gì cho gia đình có trẻ em?"
```

**Kiểm tra log:**
- [ ] Log: `🔍 RAG: Searching for: "..."`
- [ ] Log: `📚 RAG: Retrieved X relevant documents`
- [ ] KHÔNG có log pattern/rule/cache

**Kiểm tra response:**
- [ ] Bot trả lời về dịch vụ cho trẻ em
- [ ] Response có thông tin từ knowledge-base

**Kết quả:** ✅ Pass / ❌ Fail
**Ghi chú:** 

---

## 🔍 KIỂM TRA LOG CHI TIẾT

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

## 📊 THỐNG KÊ TEST

### Tổng số test: 8
### Đã test: ___ / 8
### Pass: ___ / 8
### Fail: ___ / 8

### Chi tiết:
- Test 1.1: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 1.2: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 1.3: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 2.1: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 2.2: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 3.1: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 4.1: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 5.1: ⬜ Chưa test / ✅ Pass / ❌ Fail
- Test 5.2: ⬜ Chưa test / ✅ Pass / ❌ Fail

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
- ✅ Có lỗi gì không?

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
- Test Scenarios: `RAG_TEST_SCENARIOS.md`

