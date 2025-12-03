# Hướng Dẫn Cấu Hình Google Calendar & Google Sheets Integration

## Tổng Quan

Hệ thống tích hợp với Google Calendar và Google Sheets để:
1. **Google Calendar**: Tự động tạo event khi booking được confirm
2. **Google Sheets**: Ghi lại tất cả booking vào bảng quản lý

## Bước 1: Tạo Google Service Account

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project hiện có
3. Vào **APIs & Services** > **Library**
4. Bật các API sau:
   - **Google Calendar API**
   - **Google Sheets API**
5. Vào **APIs & Services** > **Credentials**
6. Click **Create Credentials** > **Service Account**
7. Điền thông tin:
   - Name: `hotel-booking-service`
   - Role: `Editor` (hoặc custom role với quyền Calendar & Sheets)
8. Click **Create and Continue** > **Done**
9. Click vào Service Account vừa tạo
10. Vào tab **Keys**
11. Click **Add Key** > **Create new key**
12. Chọn **JSON** và download file

## Bước 2: Cấu Hình Google Calendar

1. Mở file JSON vừa download, copy **client_email** (ví dụ: `hotel-booking-service@project-id.iam.gserviceaccount.com`)
2. Mở [Google Calendar](https://calendar.google.com/)
3. Tạo calendar mới (hoặc dùng calendar hiện có)
4. Vào **Settings** > **Settings for my calendars** > Chọn calendar
5. Vào **Share with specific people**
6. Click **Add people** và paste **client_email** từ Service Account
7. Chọn quyền **Make changes to events**
8. Click **Send**
9. Copy **Calendar ID** (tìm trong **Settings** > **Integrate calendar** > **Calendar ID`)

## Bước 3: Cấu Hình Google Sheets

1. Tạo Google Sheets mới: [Google Sheets](https://sheets.google.com/)
2. Đặt tên: `Hotel Bookings Management`
3. Share sheet với **client_email** từ Service Account với quyền **Editor**
4. Copy **Spreadsheet ID** từ URL:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

## Bước 4: Cấu Hình Environment Variables

Thêm vào file `.env`:

```env
# Google Service Account
GOOGLE_SERVICE_ACCOUNT_KEY=./config/google-service-account-key.json

# Google Calendar
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com

# Google Sheets
GOOGLE_SHEETS_ID=your-spreadsheet-id-here
GOOGLE_SHEETS_NAME=Sheet1
```

## Bước 5: Đặt File JSON

1. Tạo thư mục `config` trong project (nếu chưa có)
2. Copy file JSON từ Service Account vào `config/google-service-account-key.json`
3. **QUAN TRỌNG**: Thêm `config/` vào `.gitignore` để không commit file key

```gitignore
# Google Service Account Key
config/google-service-account-key.json
```

## Bước 6: Kiểm Tra

1. Khởi động server: `npm start`
2. Tạo một booking mới
3. Confirm booking (admin)
4. Kiểm tra:
   - ✅ Google Calendar có event mới không?
   - ✅ Google Sheets có dòng mới không?

## Cấu Trúc Google Sheets

Sheet sẽ tự động tạo header với các cột:
- Booking ID
- Tên khách hàng
- Email
- Số điện thoại
- Tên phòng
- Số phòng
- Check-in
- Check-out
- Số đêm
- Số khách
- Tổng giá (VNĐ)
- Trạng thái
- Ngày tạo
- Ghi chú

## Troubleshooting

### Lỗi: "Calendar not configured"
- Kiểm tra file JSON có đúng đường dẫn không
- Kiểm tra `GOOGLE_SERVICE_ACCOUNT_KEY` trong `.env`

### Lỗi: "Calendar permission denied"
- Đảm bảo đã share calendar với Service Account email
- Kiểm tra quyền là "Make changes to events"

### Lỗi: "Sheets permission denied"
- Đảm bảo đã share sheet với Service Account email
- Kiểm tra quyền là "Editor"

### Lỗi: "API not enabled"
- Vào Google Cloud Console
- Bật Google Calendar API và Google Sheets API

## Lưu Ý Bảo Mật

1. **KHÔNG commit file JSON key lên Git**
2. **KHÔNG chia sẻ file JSON key**
3. **Rotate key định kỳ** (tạo key mới và xóa key cũ)
4. **Giới hạn quyền Service Account** (chỉ cần Calendar & Sheets, không cần quyền khác)

## Alternative: Sử dụng OAuth2 (Nếu không dùng Service Account)

Nếu muốn dùng OAuth2 thay vì Service Account:

1. Tạo OAuth 2.0 Client ID trong Google Cloud Console
2. Thêm vào `.env`:
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

3. Lấy refresh token bằng cách:
   - Chạy OAuth flow một lần
   - Lưu refresh token vào `.env`

## Luồng Hoạt Động

```
1. Khách đặt phòng
   ↓
2. Booking được tạo trong Database (status: pending)
   ↓
3. Booking được ghi vào Google Sheets
   ↓
4. Admin confirm booking (status: confirmed)
   ↓
5. Event được tạo trong Google Calendar
   ↓
6. Status trong Google Sheets được cập nhật thành "confirmed"
```

## Hỗ Trợ

Nếu gặp vấn đề, kiểm tra:
1. Console logs để xem lỗi cụ thể
2. Google Cloud Console để xem API usage
3. Google Calendar/Sheets để xem permissions

