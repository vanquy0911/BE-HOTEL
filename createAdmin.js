// createAdmin.js - Script tạo tài khoản admin
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './Models/UserModel.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Kết nối MongoDB thành công');
  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error.message);
    process.exit(1);
  }
};

const createAdmin = async () => {
  try {
    // Xóa admin cũ nếu có
    await User.deleteOne({ email: 'admin@hotel.com' });
    console.log('🗑️ Đã xóa admin cũ (nếu có)');

    // Tạo password hash
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Tạo admin user
    const admin = new User({
      fullName: 'Admin Hotel',
      email: 'admin@hotel.com',
      phone: '0123456789',
      password: hashedPassword,
      role: 'admin'
    });

    await admin.save();
    console.log('✅ Tạo tài khoản admin thành công!');
    console.log('📧 Email: admin@hotel.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Role: admin');
    
    // Test password
    const testPassword = await bcrypt.compare('admin123', admin.password);
    console.log('🔐 Test password (admin123):', testPassword);
    
  } catch (error) {
    console.error('❌ Lỗi khi tạo admin:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Chạy script
connectDB().then(() => {
  createAdmin();
});
