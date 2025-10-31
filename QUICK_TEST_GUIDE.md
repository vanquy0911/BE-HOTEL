# 🚀 Hướng Dẫn Test Nhanh Chức Năng Quên Mật Khẩu

## ⚡ Test Nhanh (5 phút)

### Bước 1: Cấu Hình Email (QUAN TRỌNG)
```bash
# Mở file .env và thay đổi:
EMAIL_USER=khangnguyen3k@gmail.com
EMAIL_PASS=your_16_character_app_password_here
```

### Bước 2: Restart Backend
```bash
# Dừng server (Ctrl+C) và chạy lại:
npm start
```

### Bước 3: Test API Trực Tiếp
```bash
# Chạy script test:
node test-forgot-password.js
```

### Bước 4: Test Frontend
1. Vào `http://localhost:3000/forgot-password`
2. Nhập email: `khangnguyen3k@gmail.com`
3. Nhấn "Gửi Link Đặt Lại"
4. Kiểm tra email inbox

## 🔍 Kiểm Tra Kết Quả

### ✅ Thành Công:
- Console hiển thị: "Email đã được gửi đến: khangnguyen3k@gmail.com"
- Frontend hiển thị: "Email Đã Được Gửi!"
- Email xuất hiện trong inbox

### ❌ Thất Bại:
- Console hiển thị lỗi email
- Frontend hiển thị: "Lỗi khi gửi email khôi phục mật khẩu"
- Không nhận được email

## 🛠️ Troubleshooting

### Lỗi "Invalid login":
- Kiểm tra App Password có đúng 16 ký tự không
- Đảm bảo đã bật 2FA trong Gmail

### Lỗi "Less secure app access":
- Không dùng mật khẩu thường
- Phải dùng App Password

### Lỗi "Email not found":
- Email không tồn tại trong database
- Cần đăng ký tài khoản trước

## 📞 Cần Hỗ Trợ?

Nếu vẫn lỗi, hãy:
1. Kiểm tra console backend có log gì
2. Kiểm tra console frontend có error gì
3. Đảm bảo backend đang chạy trên port 5000
4. Đảm bảo frontend đang chạy trên port 3000

