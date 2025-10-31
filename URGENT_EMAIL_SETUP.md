# 🚨 CẤU HÌNH EMAIL KHẨN CẤP - LỖI 500

## ❌ Vấn Đề Hiện Tại
- Backend vẫn báo lỗi 500 Internal Server Error
- File .env có giá trị mặc định chưa được thay đổi
- Cần cấu hình email thực tế ngay lập tức

## 🔧 GIẢI PHÁP NGAY LẬP TỨC

### Bước 1: Cấu Hình Gmail App Password

1. **Vào Gmail:**
   - Mở Gmail → Settings (⚙️) → See all settings
   - Tab "Security" → "2-Step Verification" → Turn on

2. **Tạo App Password:**
   - Vào: https://myaccount.google.com/security
   - "2-Step Verification" → "App passwords"
   - Chọn "Mail" → "Other (Custom name)"
   - Tên: "Hotel App"
   - **COPY** App Password (16 ký tự, ví dụ: `abcd efgh ijkl mnop`)

### Bước 2: Cập Nhật File .env

Mở file `.env` trong thư mục `BE-HOTEL` và thay đổi:

```env
# THAY ĐỔI DÒNG NÀY:
EMAIL_USER=your_email@gmail.com
# THÀNH:
EMAIL_USER=khangnguyen3k@gmail.com

# THAY ĐỔI DÒNG NÀY:
EMAIL_PASS=your_gmail_app_password_here
# THÀNH (bỏ dấu cách):
EMAIL_PASS=abcdefghijklmnop
```

### Bước 3: Restart Backend

```bash
# Dừng server (Ctrl+C)
# Chạy lại:
npm start
```

### Bước 4: Test Ngay

1. Vào `http://localhost:3000/forgot-password`
2. Nhập: `khangnguyen3k@gmail.com`
3. Nhấn "Gửi Link Đặt Lại"
4. Xem console backend để kiểm tra log

## 🔍 Debug Logs

Sau khi restart backend, bạn sẽ thấy logs chi tiết:

```
🔍 Forgot password request received: { email: 'khangnguyen3k@gmail.com' }
🔍 Looking for user with email: khangnguyen3k@gmail.com
✅ User found: khangnguyen3k@gmail.com [Tên User]
✅ Reset token saved to user
🔗 Reset URL created: http://localhost:5000/api/users/reset-password/[token]
🔍 Email config check:
  EMAIL_USER: Set
  EMAIL_PASS: Set
📧 Attempting to send email...
📧 SendEmail function called with: { to: 'khangnguyen3k@gmail.com', subject: 'Khôi phục mật khẩu - HomeBooking' }
🔍 Email config: { user: 'khangnguyen3k@gmail.com', pass: '***' }
✅ Transporter created
📤 Sending email with options: { from: 'khangnguyen3k@gmail.com', to: 'khangnguyen3k@gmail.com', subject: 'Khôi phục mật khẩu - HomeBooking' }
✅ Email đã được gửi đến: khangnguyen3k@gmail.com
✅ Email sent successfully
```

## ❌ Nếu Vẫn Lỗi

### Lỗi "Invalid login":
- App Password sai hoặc chưa bật 2FA

### Lỗi "Less secure app access":
- Phải dùng App Password, không dùng mật khẩu thường

### Lỗi "Email configuration missing":
- EMAIL_USER hoặc EMAIL_PASS chưa được set

## 🎯 Kết Quả Mong Đợi

- ✅ Console backend hiển thị logs chi tiết
- ✅ Không còn lỗi 500
- ✅ Frontend hiển thị "Email Đã Được Gửi!"
- ✅ Email xuất hiện trong inbox `khangnguyen3k@gmail.com`
