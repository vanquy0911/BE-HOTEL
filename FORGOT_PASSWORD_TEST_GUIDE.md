# Hướng Dẫn Test Chức Năng Quên Mật Khẩu

## Các Bước Đã Hoàn Thành

### ✅ 1. Sửa Frontend
- Đã sửa `ForgotPassword.tsx` để gọi API thực tế thay vì giả lập
- Đã thêm import config để sử dụng API_BASE_URL
- Đã sửa cả `handleSubmit` và `handleResendEmail`

### ✅ 2. Sửa Backend
- Đã sửa UserModel để sử dụng `resetPasswordExpire` thống nhất
- Backend controller đã có sẵn logic gửi email

### ✅ 3. Tạo Hướng Dẫn Cấu Hình
- Đã tạo `env-setup-guide.md` với hướng dẫn chi tiết

## Các Bước Cần Làm Thêm

### 🔧 1. Tạo File .env
Tạo file `.env` trong thư mục `BE-HOTEL` với nội dung từ `env-setup-guide.md`

### 🔧 2. Cấu Hình Gmail
- Bật 2-Factor Authentication
- Tạo App Password
- Cập nhật EMAIL_USER và EMAIL_PASS trong .env

### 🔧 3. Test Chức Năng

#### Test Frontend:
1. Chạy Frontend: `npm run dev` (port 3000)
2. Vào trang `/forgot-password`
3. Nhập email hợp lệ
4. Kiểm tra console để xem API call

#### Test Backend:
1. Chạy Backend: `npm start` (port 5000)
2. Kiểm tra console để xem log email
3. Kiểm tra email inbox

#### Test API trực tiếp:
```bash
curl -X POST http://localhost:5000/api/users/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Lưu Ý Debug

### Nếu không nhận được email:
1. Kiểm tra Spam/Junk folder
2. Kiểm tra console backend có lỗi gì không
3. Kiểm tra Gmail App Password có đúng không
4. Kiểm tra EMAIL_USER có đúng format không

### Nếu Frontend báo lỗi:
1. Kiểm tra Backend có chạy không (port 5000)
2. Kiểm tra CORS configuration
3. Kiểm tra API endpoint có đúng không

## Kết Quả Mong Đợi

Sau khi hoàn thành:
- Frontend gọi API thành công
- Backend gửi email với link reset password
- User nhận được email trong hộp thư
- Link trong email dẫn đến trang reset password
