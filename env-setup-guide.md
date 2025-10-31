# Hướng Dẫn Cấu Hình Environment Variables

## Tạo file .env trong thư mục BE-HOTEL

Tạo file `.env` trong thư mục `D:\Đồ Án Chuyên Ngành\BE-HOTEL\` với nội dung sau:

```env
# Database Configuration
MONGO_URI=mongodb://localhost:27017/hotel_db

# JWT Secret Key
JWT_SECRET=your_super_secret_jwt_key_here_change_this_in_production

# Email Configuration (Gmail)
# Thay thế bằng email và app password thực tế của bạn
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password_here

# Server Configuration
PORT=5000

# Environment
NODE_ENV=development
```

## Cấu Hình Gmail App Password

### Bước 1: Bật 2-Factor Authentication
1. Vào Gmail → Settings → Security
2. Bật "2-Step Verification"

### Bước 2: Tạo App Password
1. Vào Google Account → Security → App passwords
2. Chọn "Mail" và "Other (Custom name)"
3. Nhập tên: "Hotel App"
4. Copy App Password (16 ký tự)

### Bước 3: Cập Nhật .env
- Thay `your_email@gmail.com` bằng email Gmail của bạn
- Thay `your_gmail_app_password_here` bằng App Password vừa tạo

## Lưu Ý Bảo Mật
- Không commit file .env vào Git
- Sử dụng App Password thay vì mật khẩu thường
- Đổi JWT_SECRET thành chuỗi ngẫu nhiên mạnh

