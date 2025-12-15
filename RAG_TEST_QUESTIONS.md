# Danh sách Câu hỏi Test RAG

## Mục đích
Kiểm tra xem bot có thể trả lời các câu hỏi khác nhau về bãi biển, núi, nhà hàng, địa điểm tham quan không, hay chỉ trả lời được câu hỏi cụ thể "Có những bãi biển nào gần khách sạn?".

---

## Test Cases - Bãi Biển

### Test 1: Câu hỏi tổng quát
- ✅ "Có những bãi biển nào gần khách sạn?"
- ❓ "Bãi biển gần khách sạn"
- ❓ "Khách sạn gần bãi biển nào?"
- ❓ "Đi tắm biển ở đâu gần khách sạn?"

### Test 2: Câu hỏi về bãi biển cụ thể
- ❓ "Bãi Sau cách khách sạn bao xa?"
- ❓ "Bãi Trước ở đâu?"
- ❓ "Bãi Dứa có gì đặc biệt?"
- ❓ "Bãi Sau có gì?"

### Test 3: Câu hỏi về khoảng cách
- ❓ "Bãi biển gần nhất cách bao xa?"
- ❓ "Đi đến bãi biển mất bao lâu?"
- ❓ "Bãi Sau cách bao nhiêu km?"

### Test 4: Câu hỏi về hoạt động
- ❓ "Bãi biển có hoạt động gì?"
- ❓ "Có thể làm gì ở bãi biển?"
- ❓ "Bãi Sau có thể tắm biển không?"

### Test 5: Câu hỏi về dịch vụ
- ❓ "Khách sạn có hỗ trợ gì cho bãi biển?"
- ❓ "Có thể thuê đồ tắm biển không?"
- ❓ "Khách sạn có đưa đón đến bãi biển không?"

---

## Test Cases - Núi

### Test 6: Câu hỏi tổng quát
- ❓ "Có những núi nào gần khách sạn?"
- ❓ "Địa điểm leo núi gần khách sạn"
- ❓ "Có thể leo núi ở đâu gần khách sạn?"

### Test 7: Câu hỏi về núi cụ thể
- ❓ "Núi Nhỏ ở đâu?"
- ❓ "Núi Lớn cách bao xa?"
- ❓ "Hải đăng Vũng Tàu ở đâu?"

### Test 8: Câu hỏi về hoạt động
- ❓ "Có thể trekking ở đâu?"
- ❓ "Leo núi có khó không?"
- ❓ "Núi Nhỏ có gì?"

---

## Test Cases - Nhà Hàng

### Test 9: Câu hỏi tổng quát
- ❓ "Có những nhà hàng nào gần khách sạn?"
- ❓ "Nhà hàng hải sản gần khách sạn"
- ❓ "Ăn uống ở đâu gần khách sạn?"

### Test 10: Câu hỏi về nhà hàng cụ thể
- ❓ "Nhà hàng Gành Hào ở đâu?"
- ❓ "Nhà hàng Vạn Chài có gì?"
- ❓ "La Sirena cách bao xa?"

### Test 11: Câu hỏi về ẩm thực
- ❓ "Có quán ăn địa phương nào không?"
- ❓ "Bánh khọt ở đâu?"
- ❓ "Lẩu cá đuối ở đâu?"

---

## Test Cases - Địa Điểm Tham Quan

### Test 12: Câu hỏi tổng quát
- ❓ "Có những địa điểm nào gần khách sạn?"
- ❓ "Đi đâu gần khách sạn?"
- ❓ "Địa điểm tham quan gần khách sạn"

### Test 13: Câu hỏi về tour
- ❓ "Có tour nào không?"
- ❓ "Tour biển như thế nào?"
- ❓ "Tour núi có gì?"

---

## Test Cases - Vị Trí Khách Sạn

### Test 14: Câu hỏi về vị trí
- ❓ "Khách sạn ở đâu?"
- ❓ "Vị trí khách sạn"
- ❓ "Khách sạn có gần biển không?"
- ❓ "Khách sạn có gần núi không?"

---

## Kết quả mong đợi

### ✅ Bot nên trả lời được:
- Tất cả các câu hỏi trên (vì đều có thông tin trong knowledge base)
- RAG sẽ retrieve documents phù hợp dựa trên semantic similarity
- Bot sẽ trả lời chi tiết với thông tin từ knowledge base

### ❌ Bot KHÔNG nên:
- Trả lời "không biết" hoặc "không có thông tin"
- Trả lời về tìm phòng khi hỏi về địa điểm
- Bỏ qua RAG và dùng fallback chung chung

---

## Cách test

1. Hỏi từng câu hỏi trong danh sách
2. Kiểm tra log để xem:
   - RAG có được gọi không?
   - Documents nào được retrieve?
   - Score của documents là bao nhiêu?
   - Bot có trả lời đúng không?

3. Ghi lại kết quả:
   - ✅ Trả lời đúng
   - ⚠️ Trả lời đúng nhưng thiếu chi tiết
   - ❌ Trả lời sai hoặc không trả lời

---

## Lưu ý

- Một số câu hỏi có thể có score thấp (< 0.6) → sẽ không được dùng
- Cần kiểm tra xem có pattern nào chặn RAG không
- Cần kiểm tra xem có cache nào ảnh hưởng không

