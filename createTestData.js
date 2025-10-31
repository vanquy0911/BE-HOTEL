import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from './Models/PaymentModel.js';
import Booking from './Models/BookingModel.js';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';

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

const createTestData = async () => {
  try {
    await connectDB();

    console.log('\n🔍 Tạo dữ liệu test...\n');

    // 1. Tạo user test
    const testUser = await User.findOne({ email: 'test@example.com' });
    if (!testUser) {
      const newUser = await User.create({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'password123',
        phone: '0123456789',
        role: 'user'
      });
      console.log('✅ Tạo user test:', newUser.email);
    } else {
      console.log('✅ User test đã tồn tại:', testUser.email);
    }

    // 2. Tạo room test
    const testRoom = await Room.findOne({ roomNumber: 'TEST001' });
    if (!testRoom) {
      const newRoom = await Room.create({
        roomNumber: 'TEST001',
        name: 'Test Room',
        type: 'Deluxe',
        price: 1000000,
        capacity: 2,
        description: 'Test room for payment',
        available: true
      });
      console.log('✅ Tạo room test:', newRoom.roomNumber);
    } else {
      console.log('✅ Room test đã tồn tại:', testRoom.roomNumber);
    }

    // 3. Tạo booking test
    const user = await User.findOne({ email: 'test@example.com' });
    const room = await Room.findOne({ roomNumber: 'TEST001' });
    
    if (user && room) {
      const testBooking = await Booking.create({
        user: user._id,
        room: room._id,
        checkInDate: new Date('2024-12-25'),
        checkOutDate: new Date('2024-12-27'),
        totalPrice: 2000000,
        status: 'pending',
        paymentStatus: 'pending'
      });
      console.log('✅ Tạo booking test:', testBooking._id);

      // 4. Tạo payment test
      const testPayment = await Payment.create({
        bookingId: testBooking._id,
        amount: 2000000,
        method: 'cash',
        status: 'pending',
        notes: 'Test payment'
      });
      console.log('✅ Tạo payment test:', testPayment._id);
    }

    // 5. Kiểm tra dữ liệu
    const paymentCount = await Payment.countDocuments();
    const bookingCount = await Booking.countDocuments();
    const userCount = await User.countDocuments();
    const roomCount = await Room.countDocuments();

    console.log('\n📊 Thống kê dữ liệu:');
    console.log(`   - Users: ${userCount}`);
    console.log(`   - Rooms: ${roomCount}`);
    console.log(`   - Bookings: ${bookingCount}`);
    console.log(`   - Payments: ${paymentCount}`);

    console.log('\n✅ Tạo dữ liệu test hoàn tất!');

  } catch (error) {
    console.error('❌ Lỗi khi tạo dữ liệu test:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Đã ngắt kết nối MongoDB');
  }
};

createTestData();

