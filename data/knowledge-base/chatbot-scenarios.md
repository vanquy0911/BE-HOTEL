# Chatbot Scenario Library

Tài liệu này tổng hợp các “trend kịch bản” ưu tiên cho chatbot Rayal. Mỗi kịch bản gồm trigger phổ biến, dữ liệu cần thu thập, luồng trả lời gợi ý và biến thể cần phủ. Phạm vi dựa trên hệ thống hiện tại (Booking, Promotion, Services, Contact info…).

---

## 1. Booking Journey Scenarios

### 1.1 Đặt phòng tiêu chuẩn (website/app)
- **Trigger:** "Tôi muốn đặt phòng", "book phòng", "làm sao để đặt phòng", "đặt phòng ngày 15/12", "bây giờ làm sao để đặt phòng", **"muốn đặt phòng 4 người"**, **"đặt phòng cho 4 người"**, **"phòng 4 người"**, **"tôi cần phòng 4 người"**, **"tôi cần tìm phòng 2 người lớn 1 trẻ em 9 tuổi"**, **"đặt phòng cho 2 adults và 1 child age 8"**, **"2 người lớn 2 trẻ em 5 và 8 tuổi"**, **"3 người lớn 2 trẻ em 6 và 9 tuổi"**, **"2 người lớn 3 trẻ em 4, 7 và 12 tuổi"**, **"1 người lớn 1 trẻ em 10 tuổi"**, **"gia đình 2 người lớn 1 trẻ em 3 tuổi"**
- **Luồng gợi ý:**
  1. **Bước 1 - Thu thập thông tin cơ bản:**
     - Hỏi: "Bạn muốn ở ngày nào? (check-in và check-out)"
     - Hỏi: "Có bao nhiêu người?"
     - **⚠️⚠️⚠️ QUAN TRỌNG:** Bot KHÔNG được hỏi thông tin cá nhân (Họ và tên, Email, Số điện thoại) ở bước này
     - Bot CHỈ hỏi: "Ngày nhận phòng và trả phòng dự kiến là khi nào?" và "Quý khách đi bao nhiêu người?" để **gợi ý phòng**
     - Bot KHÔNG được nói "để hoàn tất việc đặt phòng" mà phải nói "để gợi ý phòng phù hợp"
     - Hỏi: "Bạn muốn loại phòng nào? (Standard, Deluxe, VIP, Suite) hoặc để tôi đề xuất"
     - **QUAN TRỌNG:** Nếu khách đã cung cấp số người trong trigger (ví dụ: "muốn đặt phòng 4 người"), BỎ QUA bước hỏi số người và chuyển thẳng sang Bước 2
     - **QUAN TRỌNG:** Nếu khách đã cung cấp thông tin về người lớn và trẻ em (ví dụ: "2 người lớn 1 trẻ em 9 tuổi", "2 người lớn 2 trẻ em 5 và 8 tuổi", "3 người lớn 2 trẻ em 6 và 9 tuổi"):
       - Bot PHẢI parse được: số người lớn, số trẻ em và tuổi của TỪNG trẻ (có thể nhiều trẻ với tuổi khác nhau)
       - Bot PHẢI tính tổng sức chứa: số người lớn + số trẻ em
       - Bot PHẢI xác nhận lại thông tin và giải thích chính sách phụ thu trẻ em cho TỪNG trẻ
       - **Nếu CHƯA có ngày check-in/out:**
         - Xác nhận: "Tôi hiểu bạn cần phòng cho [X] người lớn và [Y] trẻ em."
         - Liệt kê chi tiết từng trẻ: "Trong đó: [trẻ 1] [tuổi] tuổi, [trẻ 2] [tuổi] tuổi..." (nếu có nhiều trẻ)
         - Giải thích chính sách cho từng trẻ: 
           - "Trẻ em [tuổi] tuổi: [chính sách dựa trên tuổi]"
           - "Trẻ em [tuổi] tuổi: [chính sách dựa trên tuổi]"
         - Hỏi: "Để tìm phòng phù hợp và tính giá chính xác, bạn vui lòng cho tôi biết: Ngày nhận phòng và ngày trả phòng?"
       - **Nếu ĐÃ có ngày check-in/out:**
         - Xác nhận: "Tôi hiểu bạn cần phòng cho [X] người lớn và [Y] trẻ em từ [ngày check-in] đến [ngày check-out]."
         - Liệt kê chi tiết từng trẻ nếu có nhiều trẻ với tuổi khác nhau
         - Tìm phòng ngay với `maxOccupancy >= (số người lớn + số trẻ em)`
         - Hiển thị danh sách phòng phù hợp với giá chi tiết (bao gồm phụ thu trẻ em nếu có)
         - Giải thích ngắn gọn về phụ thu: 
           - Nếu có nhiều trẻ với tuổi khác nhau: "Lưu ý: Phụ thu trẻ em sẽ được tính theo từng trẻ (trẻ [tuổi] tuổi: [X]%, trẻ [tuổi] tuổi: [Y]%)"
           - Nếu tất cả trẻ cùng tuổi: "Lưu ý: Trẻ em [tuổi] tuổi: phụ thu [X]% giá người lớn (sẽ được tính chi tiết khi bạn chọn phòng)"
  
  2. **Bước 2 - Lấy danh sách phòng và hiển thị gợi ý:**
     - **QUAN TRỌNG:** Khi khách nói "muốn đặt phòng X người" hoặc "phòng X người":
       - Bot PHẢI tự động tìm phòng có `maxOccupancy >= X người` và `maxOccupancy <= X + 2 người`
       - Bot PHẢI ƯU TIÊN hiển thị phòng có `maxOccupancy = X người` (chính xác số người yêu cầu)
       - Bot CHỈ được hiển thị phòng có sức chứa phù hợp với yêu cầu (ví dụ: nếu yêu cầu 4 người, chỉ hiển thị phòng 4-6 người, KHÔNG hiển thị phòng 8 người trở lên)
       - Bot PHẢI hiển thị list phòng phù hợp (3-5 phòng cụ thể)
       - Bot KHÔNG được chỉ đưa ra các loại phòng chung chung (phòng đôi, phòng VIP) mà PHẢI hiển thị danh sách phòng cụ thể từ database
       - Ví dụ: Nếu khách nói "muốn đặt phòng 4 người", bot phải tìm và hiển thị list phòng có thể ở được 4 người (ưu tiên phòng 4 người, sau đó mới đến phòng 5-6 người nếu không đủ)
     - **⚠️⚠️⚠️ QUAN TRỌNG:** Khi bot đề xuất phòng (ví dụ: "3 phòng Đôi", "1 phòng Suite"):
       - Bot PHẢI hiển thị ĐÚNG số lượng phòng được đề xuất (ví dụ: 3 phòng Đôi + 1 phòng Suite = 4 phòng, KHÔNG được hiển thị 5 phòng)
       - Bot PHẢI hiển thị các phòng với SỐ THỨ TỰ rõ ràng (1, 2, 3, 4...) để khách có thể chọn "phòng số X"
       - Bot PHẢI lưu danh sách phòng vào `lastRoomSearchResults` để khách có thể chọn phòng số X
       - Bot PHẢI hiển thị room cards cho TẤT CẢ các phòng được đề xuất
     - **QUAN TRỌNG:** Khi khách có thông tin về trẻ em và ĐÃ có ngày check-in/out:
       - Bot PHẢI tính tổng sức chứa = số người lớn + số trẻ em
       - Bot PHẢI tìm phòng với `maxOccupancy >= tổng sức chứa`
       - **⚠️⚠️⚠️ QUAN TRỌNG:** Bot PHẢI tính và hiển thị TỔNG CHI PHÍ DỰ KIẾN cho TỪNG phòng ngay khi đề xuất (bao gồm cả phụ thu trẻ em)
       - Bot PHẢI hiển thị chi tiết: giá cơ bản + phụ thu trẻ em = tổng chi phí
       - Bot PHẢI hiển thị chi tiết phụ thu cho từng trẻ em (nếu có nhiều trẻ với tuổi khác nhau)
       - Bot PHẢI trả về danh sách phòng (rooms array) để frontend hiển thị dưới dạng cards
       - Ví dụ format hiển thị:
         ```
         Tôi đã tìm thấy các phòng phù hợp cho bạn:
         
         1. Phòng Deluxe Hướng Biển - 2.500.000 VNĐ/đêm
            • Sức chứa: 4 người
            • Tiện nghi: WiFi, TV, Điều hòa, Mini bar
            • Số đêm: 2 đêm
            • Giá cơ bản cho 2 đêm: 5.000.000 VNĐ
            • Phụ thu trẻ em: 500.000 VNĐ
              Chi tiết phụ thu:
                • Trẻ 1 (8 tuổi): 500.000 VNĐ (50% giá người lớn)
            • TỔNG CHI PHÍ DỰ KIẾN: 5.500.000 VNĐ
         
         2. Phòng Standard 103 - 1.500.000 VNĐ/đêm
            • Sức chứa: 3 người
            • Tiện nghi: WiFi, TV, Điều hòa
            • Số đêm: 2 đêm
            • Giá cơ bản cho 2 đêm: 3.000.000 VNĐ
            • Phụ thu trẻ em: 500.000 VNĐ
              Chi tiết phụ thu:
                • Trẻ 1 (8 tuổi): 500.000 VNĐ (50% giá người lớn)
            • TỔNG CHI PHÍ DỰ KIẾN: 3.500.000 VNĐ
         
         Bạn muốn chọn phòng nào? (Gõ số thứ tự)
         ```
       - **Lưu ý:** Bot PHẢI tính giá chi tiết cho TỪNG phòng trong danh sách, không chỉ nói chung chung
     - Gọi API `GET /api/rooms?roomType=X&maxOccupancy=Y&isAvailable=1` để lấy phòng phù hợp
     - Hiển thị list 3-5 phòng gợi ý với thông tin:
       - Tên phòng + số phòng
       - Giá/đêm
       - Sức chứa (PHẢI hiển thị chính xác số người của phòng)
       - Tiện nghi chính
       - Ví dụ: "1. Phòng Standard 103 - 800.000 VNĐ/đêm (2 người, WiFi, TV, Điều hòa)"
     - Hỏi: "Bạn muốn chọn phòng nào? (gõ số thứ tự hoặc tên phòng)"
  
  3. **Bước 3 - Khách chọn phòng từ list đã hiển thị:**
     - **QUAN TRỌNG:** Khi khách nói "tôi chọn phòng số 3", "phòng thứ 3", "vậy tôi chọn đặc phòng số 1", hoặc chỉ nói "phòng số X":
       - Bot PHẢI lấy thông tin phòng số X từ `lastRoomSearchResults` (list đã hiển thị trước đó)
       - Bot KHÔNG được hỏi lại về việc tìm kiếm phòng hoặc yêu cầu thông tin để tìm phòng
       - Bot KHÔNG được tìm lại phòng từ database
       - Bot PHẢI sử dụng chính xác thông tin phòng từ list (tên, giá, loại, sức chứa)
    - **⚠️⚠️⚠️ QUAN TRỌNG:** Sau khi khách chọn phòng, bot PHẢI trả lời theo format sau:
      - Xác nhận: "Tuyệt vời! Bạn đã chọn [Tên phòng] với giá [Giá] VNĐ/đêm."
      - Hiển thị thông tin phòng đã chọn (tên, giá, loại, sức chứa, view, tiện nghi, tổng giá nếu có ngày)
      - Kết thúc với message: "Hãy nhấn vào card phòng bên dưới để xem chi tiết và đặt phòng. Mọi thắc mắc xin quay lại chat để tiếp tục hỏi nhé."
      - Bot PHẢI tạo và trả về `roomDetailLink` để frontend hiển thị nút "Xem chi tiết phòng" trong card
      - **QUAN TRỌNG:** Bot KHÔNG được hỏi thông tin cá nhân (họ tên, email, số điện thoại) sau khi khách chọn phòng
      - Bot KHÔNG được hỏi thêm thông tin (ngày, số người, trẻ em) sau khi khách chọn phòng
      - Bot KHÔNG được tạo booking link hoặc payment link ở bước này
      - **LÝ DO:** User sẽ click vào card phòng để xem chi tiết và đặt phòng trên booking form, không cần hỏi thông tin trong chat
     - Nếu khách muốn đặt nhiều phòng cùng loại: Hỏi "Bạn muốn đặt bao nhiêu phòng [Tên phòng]?" (nhưng vẫn hiển thị nút xem chi tiết)
  
  3.1. **Bước 3.1 - Khi khách nói "chốt" hoặc "đặt phòng":**
     - **⚠️⚠️⚠️ QUAN TRỌNG:** Khi khách nói "chốt", "chốt phòng đó", "đặt phòng", "đặt phòng đó":
       - Bot PHẢI hiển thị chi tiết phòng đã chọn (tên, giá, loại, sức chứa, view, tiện nghi, tổng giá nếu có ngày)
       - Bot KHÔNG được tìm phòng mới hoặc hiển thị danh sách phòng khác
       - **Nếu CHƯA có thông tin cá nhân (tên, email, số điện thoại):**
         - Bot PHẢI hỏi thông tin cá nhân: "Để hoàn tất đặt phòng, bạn vui lòng cho tôi biết:\n- Họ và tên:\n- Email:\n- Số điện thoại:"
         - Bot KHÔNG được nói "đã chốt" hoặc "đã đặt phòng" khi chưa có thông tin cá nhân
       - **Nếu ĐÃ có thông tin cá nhân nhưng chưa có ngày check-in/out:**
         - Bot PHẢI gửi link đặt phòng ngay với thông tin đã điền sẵn (phòng, thông tin cá nhân)
         - Bot nói: "Tôi đã chuẩn bị link đặt phòng cho bạn. Bạn vui lòng điền ngày check-in/out trên form đặt phòng."
       - **Nếu ĐÃ có đủ thông tin (phòng, ngày, thông tin cá nhân):**
         - Bot PHẢI gửi link đặt phòng với tất cả thông tin đã điền sẵn
         - Hoặc nếu booking đã được tạo trong database, bot gửi link thanh toán
       - Bot PHẢI gửi link đặt phòng (link sẽ được thêm tự động) để khách hàng có thể hoàn tất đặt phòng
     - **Trường hợp đặc biệt:**
       - Nếu khách chọn phòng số không có trong list (ví dụ: list có 4 phòng nhưng khách chọn phòng số 5):
         - Thông báo: "Xin lỗi, chỉ có [X] phòng trong danh sách. Bạn vui lòng chọn từ phòng số 1 đến số [X]."
         - Nhắc lại danh sách phòng có sẵn
       - Nếu khách chọn phòng nhưng chưa có list phòng trong context:
         - Giải thích: "Tôi hiểu bạn muốn chọn phòng số [X], nhưng để tôi tìm và hiển thị danh sách phòng phù hợp, bạn vui lòng cho tôi biết: số lượng người, loại phòng, ngày check-in/out"
         - Sau khi có thông tin, tìm phòng và hiển thị list để khách chọn
       - Nếu khách yêu cầu tìm phòng mới (ví dụ: "tìm phòng khác", "cho list mới", "tìm lại"):
         - Mới được tìm phòng mới từ database
         - Cập nhật `lastRoomSearchResults` với list mới
  
  4. **Bước 4 - Xác nhận và hỏi thông tin còn thiếu:**
     - **⚠️⚠️⚠️ QUAN TRỌNG: Khi khách cung cấp đủ thông tin (ngày check-in/out + số người + email + phone):**
       - Bot PHẢI TỰ ĐỘNG kiểm tra phòng trống và hiển thị room cards ngay lập tức
       - Bot KHÔNG được hỏi lại "bạn muốn chúng tôi tự động kiểm tra phòng hay không"
       - Bot PHẢI trả lời: "Tôi đã tự động kiểm tra và tìm thấy [X] phòng phù hợp với yêu cầu của quý khách. Vui lòng xem chi tiết các phòng bên dưới và chọn phòng bạn muốn đặt."
       - Bot PHẢI trả về danh sách phòng (rooms array) để frontend hiển thị room cards
       - Bot KHÔNG được hỏi lại về loại phòng hoặc số lượng phòng
     - **Nếu CHƯA có ngày check-in/out nhưng ĐÃ biết phòng và số người lớn (adults / maxOccupancy):**
       - KHÔNG hỏi lại "số lượng người".
       - Hỏi: 
       "Để hoàn tất đặt phòng, bạn vui lòng cho tôi biết:
       - Ngày nhận phòng và ngày trả phòng?
       - Trong đoàn có **trẻ em đi kèm không**? Nếu có, khoảng **bao nhiêu bé và tầm mấy tuổi**?"
       - Sau khi có thông tin, tính giá tổng (bao gồm phụ thu trẻ em nếu có) và nêu đầy đủ chính sách.
     - **Nếu HOÀN TOÀN chưa có thông tin về số người (không có adults / maxOccupancy):**
       - Khi đó mới được hỏi:
       "Bạn vui lòng cho tôi biết:
       - Ngày nhận phòng và ngày trả phòng?
       - Số lượng người lớn và số trẻ em (kèm độ tuổi nếu có)?"
       - **Nếu đã có thông tin về trẻ em nhưng chưa có ngày:**
         - Xác nhận: "Tôi hiểu bạn cần phòng cho [X] người lớn và [Y] trẻ em."
         - **Nếu có nhiều trẻ với tuổi khác nhau:** Liệt kê từng trẻ: "Trong đó: [trẻ 1] [tuổi] tuổi, [trẻ 2] [tuổi] tuổi, [trẻ 3] [tuổi] tuổi..."
         - **Nếu tất cả trẻ cùng tuổi:** "Trong đó: [Y] trẻ em [tuổi] tuổi"
         - Giải thích chính sách phụ thu trẻ em cho TỪNG trẻ dựa trên tuổi:
           - Trẻ dưới 6 tuổi: "Trẻ em [tuổi] tuổi: miễn phí nếu ở chung giường với ba mẹ"
           - Trẻ 6-11 tuổi: "Trẻ em [tuổi] tuổi: phụ thu 50% giá người lớn"
           - Trẻ từ 12 tuổi trở lên: "Trẻ em [tuổi] tuổi: tính như người lớn (100% giá người lớn)"
         - **Ví dụ với nhiều trẻ:** "Theo chính sách: Trẻ em 4 tuổi: miễn phí. Trẻ em 8 tuổi: phụ thu 50% giá người lớn. Trẻ em 13 tuổi: tính như người lớn (100%)."
         - Hỏi: "Để tìm phòng phù hợp và tính giá chính xác, bạn vui lòng cho tôi biết: Ngày nhận phòng và ngày trả phòng?"
     - **Nếu đã có đủ thông tin (ngày, số người):**
       - Tính tổng giá: 
         - Nếu có trẻ em: Sử dụng hàm `calculateTotalPriceWithChildSurcharge` để tính giá cơ bản + phụ thu trẻ em
         - Nếu không có trẻ em: `totalPrice = (pricePerNight * số đêm) * số phòng`
       - Xác nhận lại thông tin:
         - Phòng: [Tên phòng]
         - Check-in: [Ngày] từ 14:00
         - Check-out: [Ngày] trước 12:00
         - Số đêm: [X] đêm
         - Số phòng: [Y]
         - Số người lớn: [Z] người
         - Số trẻ em: [W] trẻ (nếu có)
         - Giá/đêm: [Giá] VNĐ
         - **Nếu có phụ thu trẻ em:**
           - Giá cơ bản: [Giá cơ bản] VNĐ
           - Phụ thu trẻ em: [Phụ thu] VNĐ
           - Chi tiết phụ thu:
             * Trẻ [tuổi] tuổi: [phụ thu] VNĐ ([X]% giá người lớn)
             * Trẻ [tuổi] tuổi: [phụ thu] VNĐ ([Y]% giá người lớn)
             * (Lặp lại cho từng trẻ nếu có nhiều trẻ với tuổi khác nhau)
         - **Tổng tiền: [Tổng] VNĐ**
       - **Tự động nêu CHÍNH SÁCH đầy đủ:**
         - **Check-in:** Từ 14:00. Check-in sớm (trước 14:00) có thể sắp xếp với phụ phí, tùy tình trạng phòng.
         - **Check-out:** Trước 12:00. Check-out muộn (sau 12:00) có thể sắp xếp với phụ phí, tùy tình trạng phòng.
         - **Chính sách hủy:**
           • Hủy trước 48 giờ: Miễn phí
           • Hủy trong 24-48 giờ: Phí 30%
           • Hủy trong 24 giờ: Phí 50%
           • No-show: Phí 100%
       - **Hỏi xác nhận:** "Bạn có muốn đặt phòng này không? (Có/Không)"
  
  5. **Bước 5 - Khi khách đồng ý đặt phòng:**
     - **Thu thập thông tin đầy đủ để tạo booking:**
       - Hỏi: "Để tôi tạo đơn đặt phòng cho bạn, bạn vui lòng cung cấp thông tin sau:
         - Họ và tên:
         - Email:
         - Số điện thoại:
         - (Nếu chưa có) Ngày nhận phòng và ngày trả phòng:
         - (Nếu chưa có) Số lượng người:"
       - Lưu ý: Nếu user đã đăng nhập, có thể lấy thông tin từ user profile, chỉ hỏi thông tin còn thiếu
   
  6. **Bước 6 - Tạo booking trực tiếp từ chat:**
     - **⚠️⚠️⚠️ QUAN TRỌNG:** Bot CHỈ được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng thành công" KHI booking thực sự được tạo trong database (khi `bookingContext.bookingCreated === true`).
     - **Nếu chưa có đủ thông tin (thiếu email):**
       - Bot KHÔNG được nói "đã hoàn tất đặt phòng"
       - Bot PHẢI hỏi thông tin còn thiếu (đặc biệt là EMAIL - bắt buộc)
       - Ví dụ: "Để tôi tạo đơn đặt phòng cho bạn, bạn vui lòng cung cấp thêm email của bạn."
    - **Sau khi có đủ thông tin (tên, email, số điện thoại, phòng, ngày, giá):**
      - **Nếu user đã đăng nhập:** Tạo booking trực tiếp với userId
      - **Nếu user chưa đăng nhập:** Tự động tạo user tạm từ thông tin đã cung cấp (full name, email, phone), sau đó tạo booking với user đó
      - Bot PHẢI tạo booking trong database trước
      - Bot CHỈ nói "đã hoàn tất" SAU KHI booking được tạo thành công
      - **KHÔNG cần yêu cầu đăng nhập** – chỉ cần gửi link đặt phòng & link thanh toán
      1. **Tạo booking trong database** (tự động tạo user tạm nếu cần) bằng API `POST /api/bookings`:
          ```json
          {
            "userId": "[userId nếu user đã đăng nhập, hoặc null nếu guest]",
            "roomId": "[roomId của phòng đã chọn]",
            "checkInDate": "[YYYY-MM-DD]",
            "checkOutDate": "[YYYY-MM-DD]",
            "totalPrice": [tổng giá đã tính],
            "roomQuantity": [số phòng],
            "note": "[ghi chú nếu có]",
            "promotionId": "[promotionId nếu có áp dụng mã]",
            "discountAmount": [số tiền giảm nếu có]
          }
          ```
      2. **Nếu thành công (booking được tạo trong database):**
         - Lấy `booking._id` từ response
         - Chuẩn bị **2 link**:
           - Link xem lại đơn đặt phòng (được pre-fill từ dữ liệu đã hỏi): `/booking?roomId=...&checkIn=...&fullName=...`
           - Link thanh toán trực tiếp: `/payment?bookingId=[booking._id]`
         - **CHỈ KHI NÀY mới được nói:** "✅ Cảm ơn quý khách [Tên]! Rayal Park Hotel đã hoàn tất đặt phòng **[Tên phòng]** cho quý khách từ [Ngày check-in] đến [Ngày check-out].\n\n" +
           "Tổng cộng là **[Tổng tiền] VNĐ**.\n\n" +
           "Mã đặt phòng của bạn: [booking._id]\n\n" +
           "👉 Xem lại đơn đặt phòng (đã điền sẵn): [Xem đơn đặt phòng] (link booking)\n" +
           "💳 Thanh toán ngay: [Thanh toán ngay] (link payment)\n\n" +
           "Rayal Park Hotel sẽ gửi email xác nhận đến quý khách sớm nhất. Chúc quý khách có một kỳ nghỉ tuyệt vời! 😊"
       3. **Nếu thất bại:**
          - Bot KHÔNG được nói "đã hoàn tất đặt phòng"
          - Thông báo lỗi cụ thể và đề xuất giải pháp
          - Ví dụ: "Xin lỗi, phòng đã được đặt trong khoảng thời gian này. Bạn có muốn tôi tìm phòng khác không?"
  
  7. **Bước 7 - Hướng dẫn thanh toán (nếu cần):**
     - Nếu booking được tạo thành công nhưng chưa thanh toán:
       - Giải thích các phương thức thanh toán:
         - Thanh toán online: Nhấn vào link thanh toán
         - Chuyển khoản: Cung cấp STK và yêu cầu chụp biên lai
         - Thanh toán tại khách sạn: Giữ phòng 24h, cần đến trước 18:00 trong ngày check-in
  
  **Lưu ý:** Bot phải cung cấp đầy đủ thông tin (giá, chính sách) trong 1-2 câu trả lời để khách hàng quyết định nhanh, không cần hỏi nhiều lần.
  
- **Biến thể:**
  - Khách không chắc ngày → Đề nghị khoảng thời gian & cam kết giữ phòng 24h
  - Khách muốn đặt giúp người khác → Thu thông tin người check-in
  - Khách muốn đặt nhiều loại phòng khác nhau → Tạo nhiều booking riêng biệt hoặc booking với nhiều roomId
  - Phòng đã hết trong khoảng thời gian → Đề xuất phòng khác hoặc ngày khác
  - **Nhiều trẻ em với tuổi khác nhau:**
    - Bot PHẢI parse được tất cả trẻ em và tuổi của từng trẻ
    - Bot PHẢI tính phụ thu riêng cho từng trẻ dựa trên tuổi
    - Bot PHẢI hiển thị chi tiết phụ thu cho từng trẻ khi tính giá
    - Ví dụ: "2 người lớn 3 trẻ em 4, 7 và 12 tuổi" → Parse: 2 adults, 3 children (ages: 4, 7, 12)
    - Tính phụ thu: Trẻ 4 tuổi (miễn phí), Trẻ 7 tuổi (50%), Trẻ 12 tuổi (100%)
    - Hiển thị: "Phụ thu trẻ em: [X] VNĐ. Chi tiết: Trẻ 1 (4 tuổi): miễn phí, Trẻ 2 (7 tuổi): [Y] VNĐ (50%), Trẻ 3 (12 tuổi): [Z] VNĐ (100%)"

### 1.2 Đặt nhiều phòng / gia đình
- **Trigger:** "6 người", "8 người", "gia đình 5 người", "đoàn 7 người", "nhóm lớn"
- **Luồng gợi ý:**
  1. **Xác nhận số người và thời gian**: Hỏi rõ số người, ngày check-in/out, số đêm.
  2. **Kiểm tra phòng phù hợp:**
     - **6 người**: Đề xuất 1 phòng Family 6 Người (5.000.000 VNĐ/đêm) hoặc Deluxe Family 6 Người (4.800.000 VNĐ/đêm). Nếu không có, đề xuất 3 phòng Standard (mỗi phòng 2 người).
     - **8 người**: Đề xuất 1 phòng Suite Luxury 8 Người (8.000.000 VNĐ/đêm) hoặc Presidential 8 Người (7.500.000 VNĐ/đêm). Nếu không có, đề xuất 4 phòng Standard hoặc 2 phòng Suite.
  3. **So sánh lựa chọn:**
     - Phòng lớn (1 phòng): Tiện nghi, không gian chung, giá tổng có thể rẻ hơn.
     - Nhiều phòng nhỏ: Linh hoạt, riêng tư hơn, có thể chia theo gia đình.
  4. **Hỏi ưu tiên**: Giá rẻ hay tiện nghi? Cần phòng nối liền không?
  5. **Khách chọn phòng:**
     - Sau khi khách chọn (1 phòng lớn hoặc nhiều phòng nhỏ), xác nhận lại lựa chọn
     - Tính tổng giá: `totalPrice = (pricePerNight * số đêm) * số phòng`
     - Nếu khách chọn nhiều phòng cùng loại: Xác nhận số lượng phòng
  
  6. **Tạo đơn hàng trực tiếp:**
     - Gọi API `POST /api/bookings` với:
       - `roomId`: ID phòng đã chọn (hoặc roomId đầu tiên nếu nhiều phòng)
       - `roomQuantity`: Số phòng (nếu > 1)
       - `checkInDate`: Ngày check-in
       - `checkOutDate`: Ngày check-out
       - `totalPrice`: Tổng giá đã tính
       - `userId`: ID user (nếu có)
     - Nếu thành công: Lấy `bookingId` từ response
  
  7. **Tạo link booking và thông báo:**
     - Tạo URL: `/booking?bookingId=XXX` hoặc `/booking?roomId=YYY&checkIn=...&checkOut=...&roomQuantity=Z`
     - Trả lời: "✅ Tôi đã tạo đơn đặt phòng cho bạn! Nhấn vào link này để hoàn tất thông tin và thanh toán: [Đặt phòng ngay] (link)"
  
  8. **Gợi ý bổ sung:**
     - Nếu chọn nhiều phòng: Highlight giường phụ 500.000 VNĐ/đêm nếu cần.
     - Nếu cần nối phòng: Note "special request: connecting rooms" trong booking note.
     - Áp dụng mã khuyến mãi cho đơn lớn (ví dụ MA3005 giảm 150.000 VNĐ).
- **Biến thể:**
  - Khách không chắc số người → Hỏi số người lớn/trẻ em, đề xuất phòng phù hợp.
  - Khách muốn giá rẻ nhất → So sánh 1 phòng lớn vs nhiều phòng nhỏ, tính tổng chi phí.
  - Khách cần check-in sớm → Đề xuất early check-in (có phí) hoặc gửi hành lý trước.

### 1.3 Đặt gấp (arrival < 24h)
- Kiểm tra tồn kho nhanh, chỉ nêu loại phòng còn trống.
- Hướng khách gọi hotline 0901 234 567 để giữ phòng và hoàn tất thanh toán tại quầy.
- Nhắc chính sách hủy: trong vòng 24h phí 50%.

### 1.4 Chỉnh sửa hoặc hủy đặt phòng
- Thu mã đặt phòng hoặc email.
- Nêu chính sách hủy (48h miễn phí, 24–48h 30%, <24h 50%, no-show 100%).
- Nếu đổi ngày: kiểm tra lại giá mới, thông báo chênh lệch.
- Nếu khách cần chứng từ: hướng tới email `booking@rayalhotel.vn` (giả định từ Contact Info).

### 1.5 Thanh toán & xác nhận
- Sau khi thu thông tin, chatbot mô tả 3 lựa chọn:
  - Thẻ tín dụng: thanh toán ngay trên link bảo mật.
  - Chuyển khoản: cung cấp STK, yêu cầu chụp biên lai.
  - Trả tại khách sạn: giữ phòng 24h, cần đến trước 18:00 trong ngày check-in.
- Nhắc gửi email xác nhận tự động sau khi thanh toán.

### 1.6 Yêu cầu đặc biệt / dịch vụ bổ sung
- Các option từ module Services: đưa đón sân bay (phụ phí), giường phụ, trang trí sinh nhật, spa.
- Thu chi tiết (thời gian, số chuyến…), ghi chú vào booking (`specialRequest`).

### 1.7 Đặt phòng ngân sách thấp (≤ 1.000.000 VNĐ)
- **Trigger:** “Có phòng 800k không?”, “ngân sách dưới 1 triệu”, “mình cần phòng rẻ nhất”.
- **Mục tiêu trả lời:** thay vì liệt kê giá chung chung, bot cần đưa ra **quy trình hành động** giúp khách đạt được mức giá mong muốn nhanh nhất.
- **Luồng gợi ý:**
  1. **Xác nhận ngân sách & thời gian**: “Bạn cần ở ngày nào và tối đa bao nhiêu?”.
  2. **Thông báo mức giá thấp nhất hiện có** (lấy từ Room API hoặc generated-data.md). Nếu giá min > ngân sách, giải thích lý do và gợi ý giải pháp.
  3. **Đưa ra 2 lựa chọn hành động:**
     - *Giải pháp tự đặt:* Hướng dẫn mở Booking Form, chọn “Phòng Standard / Flash Sale”, nhập mã khuyến mãi đang có (vd: MA3005) để giảm thêm.
     - *Giải pháp hỗ trợ nhanh:* Nhấn nút “Chat với nhân viên” hoặc gọi hotline để giữ suất hủy phút chót.
  4. **Đề xuất bổ sung:** đặt trước ≥7 ngày để nhận Early Bird, hoặc theo dõi mục Khuyến mãi trong app.
- **Câu trả lời mẫu:**
  ```
  Giá thấp nhất hiện tại cho 2 người là 1.500.000 VNĐ/đêm (Phòng Standard). Với ngân sách 800.000 VNĐ bạn có thể:
  1. Đặt sớm và áp dụng mã MA3005 (giảm 300K) → tổng còn khoảng 1.200.000 VNĐ.
  2. Nhấn “Chat với nhân viên” để mình giữ giúp suất phòng phút chót hoặc ghép phòng đang hủy.
  Bạn chọn phương án nào để mình hỗ trợ tiếp nhé?
  ```
- **Biến thể:** khách muốn ở nhiều đêm → gợi ý combo/flash sale; khách sẵn sàng chia sẻ thêm thông tin (thứ tự ưu tiên: ngày linh hoạt, sẵn sàng đặt trước, ok trả trước…).

### 1.8 Xử lý chọn phòng từ list đã hiển thị (QUAN TRỌNG)
- **Trigger:** "tôi chọn phòng số X", "phòng thứ X", "vậy tôi chọn đặc phòng số X", "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này", hoặc chỉ nói số "X" sau khi đã có list phòng
- **Context cần có:** `lastRoomSearchResults` - danh sách phòng đã hiển thị cho khách, hoặc `selectedRoom` - phòng đã chọn trước đó
- **Luồng xử lý:**
  1. **Kiểm tra context:**
     - **Nếu khách nói "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này":**
       - Kiểm tra xem đã có `selectedRoom` trong context chưa
       - Nếu CÓ `selectedRoom`: 
         - KHÔNG tìm lại phòng từ database
         - KHÔNG hiển thị danh sách phòng mới
         - PHẢI hiển thị CHI TIẾT phòng đã chọn (tên, giá, loại, sức chứa, view, tiện nghi, hình ảnh)
         - Sau đó hỏi thông tin còn thiếu (ngày, số người, thông tin cá nhân) để hoàn tất đặt phòng
       - Nếu CHƯA có `selectedRoom` nhưng có `lastRoomSearchResults`:
         - Hỏi khách muốn chọn phòng số mấy từ danh sách đã hiển thị
       - Nếu CHƯA có cả `selectedRoom` và `lastRoomSearchResults`:
         - Hỏi khách muốn đặt phòng nào, cần thông tin để tìm phòng
     - **Nếu khách chọn phòng số X từ list:**
       - Lấy phòng tại index (X - 1) từ `lastRoomSearchResults`
       - Lưu thông tin phòng vào `selectedRoom` context
       - KHÔNG tìm lại phòng từ database
       - KHÔNG hỏi lại về việc tìm kiếm phòng
   
  2. **Xác nhận và hiển thị chi tiết phòng đã chọn:**
     - **QUAN TRỌNG:** Khi khách nói "chốt phòng đó" hoặc đã chọn phòng, bot PHẢI hiển thị CHI TIẾT phòng:
       - Tên phòng đầy đủ: `selectedRoom.name`
       - Giá/đêm: `selectedRoom.pricePerNight` VNĐ
       - Loại phòng: `selectedRoom.roomType`
       - Sức chứa: `selectedRoom.maxOccupancy` người
       - View: `selectedRoom.view` (hướng biển, hướng núi, hướng thành phố, v.v.)
       - Tiện nghi: `selectedRoom.amenities` (nếu có)
       - Hình ảnh: `selectedRoom.image` (nếu có)
     - **QUAN TRỌNG:** Bot PHẢI gửi 2 link cho khách:
       - Link xem chi tiết phòng: `/rooms/[roomId]` - để khách xem đầy đủ thông tin, hình ảnh, tiện nghi
       - Link đặt phòng: `/booking?roomId=[roomId]&...` - để khách đặt phòng trực tiếp (đã điền sẵn thông tin nếu có)
     - Xác nhận: "Tuyệt vời! Quý khách đã chọn **[Tên phòng]**.\n\n" +
       "📋 **Chi tiết phòng:**\n" +
       "• Loại: [Loại phòng]\n" +
       "• Giá: [Giá] VNĐ/đêm\n" +
       "• Sức chứa: [Số người] người\n" +
       "• View: [View]\n" +
       "• Tiện nghi: [Danh sách tiện nghi]\n\n" +
       "🔍 [Xem chi tiết phòng](link xem chi tiết)\n" +
       "📝 [Đặt phòng ngay](link đặt phòng)\n\n" +
       "Để hoàn tất đặt phòng, vui lòng cung cấp ngày nhận/trả phòng, họ tên, email và số điện thoại của quý khách ạ. 😊"
     - **KHÔNG được hiển thị danh sách phòng khác hoặc gợi ý phòng khác**
   
  3. **Kiểm tra thông tin còn thiếu (SAU KHI ĐÃ HIỂN THỊ CHI TIẾT PHÒNG):**
     - Nếu chưa có ngày check-in/out hoặc số người:
       - Hỏi trong 1 câu duy nhất: "Để hoàn tất đặt phòng, bạn vui lòng cho tôi biết: Ngày nhận phòng và ngày trả phòng? Số lượng người?"
     - Nếu đã có đủ thông tin:
       - Tính giá tổng và nêu chính sách đầy đủ ngay
       - Tạo booking link và gửi cho khách
     - **LƯU Ý:** Sau khi hiển thị chi tiết phòng, KHÔNG được hiển thị danh sách phòng khác nữa
   
  4. **Xử lý khi khách chỉ cung cấp ngày (sau khi đã chọn phòng):**
     - Nếu khách đã chọn phòng từ list trước đó và chỉ cung cấp ngày (ví dụ: "ngày nhận là 28/12 ngày trả là ngày 30/12"):
       - Bot PHẢI sử dụng phòng đã chọn từ `selectedRoom` context
       - Bot KHÔNG được tìm lại phòng từ database
       - Bot PHẢI cập nhật dates vào `bookingContext` và tính giá tổng
       - Bot PHẢI nêu chính sách đầy đủ và tạo booking link
   
  5. **Xử lý khi khách yêu cầu tìm phòng mới:**
     - Chỉ khi khách RÕ RÀNG yêu cầu (ví dụ: "tìm phòng khác", "cho list mới", "tìm lại", "tìm phòng mới"):
       - Mới được tìm phòng mới từ database
       - Cập nhật `lastRoomSearchResults` với list mới
       - Clear `selectedRoom` context nếu có
  6. **Xử lý khi khách nói "phòng số X" nhưng chưa có list trong context:**
     - KHÔNG được yêu cầu khách cung cấp mã phòng, ID phòng hay chuyển sang hotline/website
     - Phải giải thích thân thiện rằng hiện chưa có danh sách phòng nào được hiển thị, cần thêm thông tin để tìm đúng phòng:
       ```
       Em hiểu anh muốn đặt phòng số 4. Để em tìm đúng danh sách phòng và giữ phòng số 4 cho anh, anh giúp em cho biết:
       • Ngày nhận và ngày trả phòng mong muốn?
       • Số lượng khách?
       • Anh thích loại phòng Standard, Deluxe hay Suite?
       Sau khi em có thông tin, em sẽ gửi ngay danh sách phòng và giữ phòng số 4 cho anh nhé! 😊
       ```
     - Sau khi khách trả lời, bot phải gọi `searchRooms` với thông tin đó để hiển thị list mới, rồi cho khách chọn lại
   
  6. **Xử lý lỗi:**
     - Nếu khách chọn phòng số không có trong list:
       - Thông báo: "Xin lỗi, chỉ có [X] phòng trong danh sách. Bạn vui lòng chọn từ phòng số 1 đến số [X]."
       - Nhắc lại danh sách phòng có sẵn
     - Nếu khách chọn phòng nhưng chưa có list:
       - Giải thích: "Tôi hiểu bạn muốn chọn phòng số [X], nhưng để tôi tìm và hiển thị danh sách phòng phù hợp, bạn vui lòng cho tôi biết: số lượng người, loại phòng, ngày check-in/out"
       - Sau khi có thông tin, tìm phòng và hiển thị list

- **Lưu ý quan trọng:**
  - Bot PHẢI nhớ `lastRoomSearchResults` và `selectedRoom` trong suốt cuộc hội thoại
  - Bot KHÔNG được hỏi lại về tìm kiếm phòng khi đã có list và khách chọn phòng từ list
  - Bot PHẢI sử dụng chính xác thông tin phòng từ list, không được đoán hoặc thay đổi

---

## 2. Promotion & Discount Scenarios

### 2.1 Áp dụng mã hợp lệ
- **Trigger:** “Mã MA3005 giảm bao nhiêu?”, “có ưu đãi nào cho phòng VIP không?”
- **Luồng:**
  1. Hỏi giá trị booking dự kiến, số đêm, loại phòng.
  2. Gọi API `/api/promotions/validate/:code?bookingAmount=&nights=&roomType=`.
  3. Trả lời gồm tên CTKM, % hoặc số tiền giảm, điều kiện (minBookingAmount, minNights, applicableRoomTypes).
  4. Hướng dẫn nhập mã ở bước Thanh toán (Booking Step 3) trong FE.

### 2.2 Mã hết hạn / chưa đến ngày
- Nếu API trả `400 expired`, giải thích: “Mã chỉ áp dụng đến dd/mm/yyyy. Bạn muốn nhận mã mới? Đăng ký newsletter hoặc theo dõi fanpage.”
- Gợi ý mã public còn hiệu lực (danh sách từ `/api/promotions`).

### 2.3 Không đủ điều kiện giá trị tối thiểu
- Nếu `bookingAmount` < `minBookingAmount`: đề xuất nâng hạng phòng, thêm đêm, hoặc dùng mã khác không yêu cầu tối thiểu.
- Nhắc rõ mức tối thiểu bằng `toLocaleString('vi-VN')`.

### 2.4 Không đúng loại phòng
- Khi response báo “không áp dụng cho roomType”, gợi ý các loại phòng hợp lệ (ví dụ: Deluxe, VIP).
- Nếu khách muốn giữ mã → đề nghị đổi phòng tương ứng.

### 2.5 Đã hết lượt / vượt giới hạn người dùng
- Nếu `usageLimit` đạt tối đa: đề xuất danh sách mã khác hoặc ưu đãi nội bộ (ví dụ đặt 3 đêm tặng spa 30 phút).
- Nếu vượt `maxUsagePerUser`: nhắc mỗi tài khoản/ email chỉ dùng X lần, hướng dẫn dùng mã khác.

### 2.6 Gợi ý mã tự động
- Khi khách chưa có mã, chatbot có thể truy cập `/api/promotions` lọc `isPublic=true` + theo roomType để giới thiệu 2 mã nổi bật (ví dụ: “SUMMER25 giảm 25% cho Deluxe, tối đa 2 lần sử dụng”).
- Kèm lưu ý nhập mã trước bước thanh toán, nếu lỗi hãy gửi ảnh màn hình + thời gian cho đội CSKH.

---

## 3. Post-booking & Support Scenarios

### 3.1 Xác nhận & gửi chứng từ
- Sau khi hoàn tất, chatbot tóm tắt: mã booking, phòng, check-in/out, tổng tiền, phương thức thanh toán.
- Hỏi khách cần hóa đơn VAT hay không → hướng dẫn gửi thông tin công ty qua email.

### 3.2 Hỏi tình trạng phòng/giờ nhận
- Dựa trên chính sách check-in 14:00, check-out 12:00.
- Nếu khách đến sớm: đề nghị gửi hành lý, hoặc đăng ký early check-in (phí thêm, tùy phòng).

### 3.3 Upsell dịch vụ tại chỗ
- Nếu khách ở Suite/VIP: gợi ý spa, lounge, dịch vụ đưa đón.
- Nếu khách ở Standard nhưng ở ≥2 đêm: đề xuất nâng hạng với phụ phí ưu đãi.

### 3.4 Chăm sóc sau lưu trú
- Sau check-out, chatbot hỏi cảm nhận, mời đánh giá trên Google/Facebook.
- Nếu phàn nàn: thu thông tin, tạo ticket gửi `support@rayalhotel.vn`.

---

## 4. Dịch vụ Khách sạn Scenarios

### 4.1 Câu hỏi về dịch vụ ăn uống
- **Trigger:** "có dịch vụ ăn sáng không?", "breakfast", "ăn sáng có bao gồm không?", "nhà hàng", "room service", "buffet sáng"
- **Luồng trả lời:**
  1. **Trả lời chi tiết về dịch vụ ăn uống:**
     - **Nhà hàng chính:** Phục vụ bữa sáng, trưa, tối
     - **Bar & Lounge:** Đồ uống và snack từ 10:00 - 24:00
     - **Room Service:** Phục vụ 24/7
     - **Buffet sáng:** 6:30 - 10:00 hàng ngày
  2. **Về việc ăn sáng có bao gồm trong giá phòng:**
     - Nếu khách hỏi về phòng cụ thể: Kiểm tra thông tin phòng trong database hoặc generated-data.md
     - Nếu không có thông tin cụ thể: "Ăn sáng có thể được bao gồm tùy theo gói đặt phòng hoặc loại phòng. Để biết chi tiết chính xác, quý khách vui lòng liên hệ hotline 0901 234 567 hoặc kiểm tra khi đặt phòng."
     - **QUAN TRỌNG:** KHÔNG chỉ hướng dẫn liên hệ hotline, PHẢI cung cấp thông tin có sẵn trước (giờ phục vụ, loại dịch vụ)
  3. **Gợi ý:** Nếu khách đang đặt phòng, nhắc họ có thể thêm dịch vụ ăn sáng vào booking

### 4.2 Câu hỏi về dịch vụ Spa & Wellness
- **Trigger:** "spa", "gym", "bể bơi", "pool", "xông hơi", "massage", "wellness", "fitness"
- **Luồng trả lời:**
  1. **Trả lời chi tiết:**
     - **Spa:** Có các liệu pháp massage (chi tiết từ services.md hoặc database)
     - **Phòng gym:** Hiện đại, miễn phí (nếu có thông tin từ generated-data.md)
     - **Bể bơi:** Ngoài trời, miễn phí cho khách lưu trú
     - **Phòng xông hơi:** Có sẵn
  2. **Giờ hoạt động:** Cung cấp nếu có trong database hoặc knowledge base
  3. **Phí:** Nêu rõ miễn phí hay có phí, phí bao nhiêu (nếu có thông tin)
  4. **QUAN TRỌNG:** PHẢI cung cấp thông tin chi tiết từ services.md, không chỉ hướng dẫn liên hệ

### 4.3 Câu hỏi về dịch vụ khác
- **Trigger:** "đưa đón sân bay", "airport transfer", "giặt ủi", "laundry", "đổi tiền", "parking", "bãi đỗ xe", "bảo vệ"
- **Luồng trả lời:**
  1. **Đưa đón sân bay:** Có dịch vụ (có phụ phí), cung cấp thông tin đặt trước nếu có
  2. **Dịch vụ giặt ủi:** Có sẵn, cung cấp thông tin giá và thời gian nếu có
  3. **Bãi đỗ xe:** Miễn phí
  4. **Bảo vệ:** 24/7
  5. **QUAN TRỌNG:** PHẢI cung cấp thông tin từ services.md, không chỉ hướng dẫn liên hệ hotline

### 4.4 Nguyên tắc trả lời về dịch vụ (QUAN TRỌNG)
- **PHẢI trả lời chi tiết** dựa trên thông tin trong `services.md`, `rooms-info.md`, `generated-data.md`
- **KHÔNG chỉ hướng dẫn liên hệ hotline** mà PHẢI cung cấp thông tin có sẵn trước
- **Nếu thiếu thông tin:** Mới hướng dẫn liên hệ hotline 0901 234 567 để được tư vấn cụ thể hơn
- **Ưu tiên:** Thông tin từ knowledge base > Thông tin từ database > Hướng dẫn liên hệ
- **Format trả lời:** Ngắn gọn, rõ ràng, có cấu trúc (bullet points nếu nhiều dịch vụ)
- **Ví dụ trả lời tốt:**
  ```
  Rayal Park Hotel có đầy đủ dịch vụ ăn uống:
  • Nhà hàng chính: Phục vụ bữa sáng, trưa, tối
  • Bar & Lounge: Đồ uống và snack từ 10:00 - 24:00
  • Room Service: Phục vụ 24/7
  • Buffet sáng: 6:30 - 10:00 hàng ngày
  
  Về việc ăn sáng có bao gồm trong giá phòng, tùy theo gói đặt phòng. Để biết chi tiết chính xác cho phòng của bạn, vui lòng liên hệ hotline 0901 234 567.
  ```

---

## 5. Hướng dẫn triển khai vào chatbot RAG

1. **Ưu tiên nạp file này** cùng `faq.md`, `policies.md`, `rooms-info.md`, `services.md` vào vector store (script `scripts/ingestKnowledgeBase.js`).
   - **QUAN TRỌNG:** Tất cả logic và kịch bản phải được lưu trong knowledge base, KHÔNG hardcode trong controller
   - Controller chỉ nên xử lý: parse intent, lấy dữ liệu từ database, lưu context vào session
   - AI (qua RAG) sẽ quyết định cách trả lời dựa trên kịch bản trong knowledge base

2. **Metadata gợi ý:** thêm tags `scenario:booking`, `scenario:promotion`, `scenario:room-selection` để bot biết context.

3. **Prompt đề xuất cho AI:**
   - "Nếu câu hỏi liên quan đến đặt phòng/hủy/khuyến mãi → tham chiếu `chatbot-scenarios.md` trước, sau đó kết hợp dữ liệu phòng/dịch vụ."
   - "Nếu câu hỏi liên quan đến dịch vụ khách sạn (ăn uống, spa, gym, bể bơi, đưa đón sân bay, etc.) → tham chiếu `chatbot-scenarios.md` section 4 và `services.md` để trả lời CHI TIẾT. KHÔNG chỉ hướng dẫn liên hệ hotline, PHẢI cung cấp thông tin có sẵn trước."
   - "Khi khách muốn đặt phòng: (1) Thu thập thông tin (ngày, số người, loại phòng) → (2) Gọi API GET /api/rooms để lấy list phòng → (3) Hiển thị list gợi ý → (4) Khách chọn phòng → (5) Tính giá tổng và nêu chính sách → (6) Tạo link /booking?roomId=XXX&checkIn=...&checkOut=... và gửi cho khách."
   - **QUAN TRỌNG về chọn phòng từ list:**
     - "Khi khách chọn phòng từ list đã hiển thị (ví dụ: 'phòng số 1', 'chọn phòng số 2'):"
     - "Bạn PHẢI lấy phòng từ `lastRoomSearchResults` (list đã hiển thị), KHÔNG tìm lại từ database"
     - "Bạn KHÔNG được hỏi lại về việc tìm kiếm phòng khi đã có list"
     - "Bạn PHẢI sử dụng chính xác thông tin phòng từ list (tên, giá, loại)"
     - "Chỉ tìm phòng MỚI khi khách RÕ RÀNG yêu cầu (ví dụ: 'tìm phòng khác', 'cho list mới')"
     - "Khi khách chỉ cung cấp ngày sau khi đã chọn phòng, bạn PHẢI sử dụng phòng đã chọn, không tìm lại"

4. **API Endpoints bot cần sử dụng:**
   - `GET /api/rooms?roomType=X&maxOccupancy=Y&isAvailable=1` - Lấy danh sách phòng phù hợp
   - `POST /api/bookings` - Tạo booking trực tiếp với body: `{ roomId, roomQuantity, checkInDate, checkOutDate, totalPrice, userId }`
   - Response từ POST /api/bookings sẽ có `booking._id` để tạo link `/booking?bookingId=XXX`

5. **Xử lý trẻ em linh hoạt (QUAN TRỌNG):**
   - Bot PHẢI parse được các pattern đa dạng:
     * "2 người lớn 1 trẻ em 9 tuổi"
     * "2 người lớn 2 trẻ em 5 và 8 tuổi"
     * "3 người lớn 2 trẻ em 6 và 9 tuổi"
     * "2 người lớn 3 trẻ em 4, 7 và 12 tuổi"
     * "1 người lớn 1 trẻ em 10 tuổi"
   - Bot PHẢI tính phụ thu riêng cho TỪNG trẻ dựa trên tuổi:
     * Trẻ dưới 6 tuổi: miễn phí
     * Trẻ 6-11 tuổi: 50% giá người lớn
     * Trẻ từ 12 tuổi trở lên: 100% giá người lớn
   - Bot PHẢI hiển thị chi tiết phụ thu cho từng trẻ khi có nhiều trẻ với tuổi khác nhau
   - Bot PHẢI giải thích chính sách rõ ràng cho từng trẻ

5. **Context Management (Controller xử lý):**
   - Controller lưu `lastRoomSearchResults` vào session context khi tìm được phòng
   - Controller lưu `selectedRoom` vào session context khi khách chọn phòng từ list
   - Controller restore `lastRoomSearchResults` và `selectedRoom` từ session khi xử lý message mới
   - Controller parse booking intent (chọn phòng, cung cấp ngày, số người) và cập nhật `bookingContext`
   - AI (qua RAG) sử dụng context này để quyết định cách trả lời theo kịch bản

6. **Theo dõi 4 KPI:** tỉ lệ giải đáp đủ thông tin, số lần chuyển người thật, % mã áp dụng thành công, CSAT sau chat.

Tài liệu này bao phủ các hành vi chiếm ~85% câu hỏi phổ biến (đặt phòng, khuyến mãi, thanh toán, hủy đổi, dịch vụ phụ). Các tình huống đặc thù (sự kiện lớn, đoàn MICE) có thể bổ sung thêm sub-scenario khi phát sinh.

