# 🔧 Hướng Dẫn Cấu Hình Email Cho Chức Năng Quên Mật Khẩu

## ❌ Vấn Đề Hiện Tại
- File `.env` đã có nhưng thiếu cấu hình email
- Gây ra lỗi 500 Internal Server Error khi gọi API forgot-password

## ✅ Giải Pháp

### Bước 1: Cấu Hình Gmail App Password

1. **Vào Gmail Settings:**
   - Mở Gmail → Settings (⚙️) → See all settings
   - Chọn tab "Security"

2. **Bật 2-Factor Authentication:**
   - Tìm "2-Step Verification" → Turn on
   - Làm theo hướng dẫn để bật

3. **Tạo App Password:**
   - Vào Google Account: https://myaccount.google.com/
   - Security → 2-Step Verification → App passwords
   - Chọn "Mail" và "Other (Custom name)"
   - Nhập tên: "Hotel App"
   - Copy App Password (16 ký tự, ví dụ: `abcd efgh ijkl mnop`)

### Bước 2: Cập Nhật File .env

Mở file `.env` trong thư mục `BE-HOTEL` và thay đổi:

```env
# Thay đổi dòng này:
EMAIL_USER=your_email@gmail.com
# Thành email Gmail thực tế của bạn:
EMAIL_USER=khangnguyen3k@gmail.com

# Thay đổi dòng này:
EMAIL_PASS=your_gmail_app_password_here
# Thành App Password vừa tạo (bỏ dấu cách):
EMAIL_PASS=abcdefghijklmnop
```

### Bước 3: Restart Backend Server

```bash
# Dừng server hiện tại (Ctrl+C)
# Sau đó chạy lại:
npm start
```

### Bước 4: Test Chức Năng

1. Vào trang `/forgot-password`
2. Nhập email: `khangnguyen3k@gmail.com`
3. Nhấn "Gửi Link Đặt Lại"
4. Kiểm tra email inbox (có thể trong Spam folder)

## 🔍 Debug Nếu Vẫn Lỗi

### Kiểm tra Console Backend:
```bash
# Chạy backend và xem log
npm start
```

### Kiểm tra Console Frontend:
- Mở Developer Tools (F12)
- Xem tab Console để kiểm tra lỗi

### Các Lỗi Thường Gặp:

1. **"Invalid login"** → App Password sai
2. **"Less secure app access"** → Cần bật 2FA và dùng App Password
3. **"Connection timeout"** → Kiểm tra internet
4. **"Email not found"** → Email không tồn tại trong database

## 📧 Kết Quả Mong Đợi

Sau khi cấu hình đúng:
- API sẽ trả về status 200
- Email sẽ được gửi đến `khangnguyen3k@gmail.com`
- Email chứa link reset password
- Link có dạng: `http://localhost:5000/api/users/reset-password/[token]`

