// seedBookingData.js - Script để thêm dữ liệu booking mẫu
import mongoose from 'mongoose';
import dotenv from 'dotenv';
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

const seedBookingData = async () => {
  try {
    console.log('🔍 Bắt đầu tạo dữ liệu booking mẫu...');

    // Lấy danh sách users và rooms
    const users = await User.find().limit(5);
    const rooms = await Room.find().limit(5);

    console.log(`👥 Tìm thấy ${users.length} users`);
    console.log(`🏨 Tìm thấy ${rooms.length} rooms`);

    if (users.length === 0) {
      console.log('❌ Không có user nào. Vui lòng tạo user trước.');
      return;
    }

    if (rooms.length === 0) {
      console.log('❌ Không có room nào. Vui lòng tạo room trước.');
      return;
    }

    // Xóa dữ liệu booking cũ
    await Booking.deleteMany({});
    console.log('🗑️ Đã xóa dữ liệu booking cũ');

    // Tạo dữ liệu booking mẫu
    const sampleBookings = [
      {
        user: users[0]._id,
        room: rooms[0]._id,
        roomQuantity: 1,
        checkInDate: new Date('2024-01-15'),
        checkOutDate: new Date('2024-01-18'),
        totalPrice: rooms[0].pricePerNight * 3,
        status: 'pending',
        note: 'Khách hàng yêu cầu phòng tầng cao'
      },
      {
        user: users[1] ? users[1]._id : users[0]._id,
        room: rooms[1] ? rooms[1]._id : rooms[0]._id,
        roomQuantity: 2,
        checkInDate: new Date('2024-01-20'),
        checkOutDate: new Date('2024-01-22'),
        totalPrice: (rooms[1] ? rooms[1].pricePerNight : rooms[0].pricePerNight) * 2 * 2,
        status: 'confirmed',
        note: 'Đã xác nhận qua điện thoại'
      },
      {
        user: users[2] ? users[2]._id : users[0]._id,
        room: rooms[2] ? rooms[2]._id : rooms[0]._id,
        roomQuantity: 1,
        checkInDate: new Date('2024-01-10'),
        checkOutDate: new Date('2024-01-12'),
        totalPrice: (rooms[2] ? rooms[2].pricePerNight : rooms[0].pricePerNight) * 2,
        status: 'cancelled',
        note: 'Khách hủy do thay đổi kế hoạch'
      },
      {
        user: users[3] ? users[3]._id : users[0]._id,
        room: rooms[3] ? rooms[3]._id : rooms[0]._id,
        roomQuantity: 1,
        checkInDate: new Date('2024-01-25'),
        checkOutDate: new Date('2024-01-28'),
        totalPrice: (rooms[3] ? rooms[3].pricePerNight : rooms[0].pricePerNight) * 3,
        status: 'pending',
        note: 'Chờ xác nhận từ khách hàng'
      },
      {
        user: users[4] ? users[4]._id : users[0]._id,
        room: rooms[4] ? rooms[4]._id : rooms[0]._id,
        roomQuantity: 1,
        checkInDate: new Date('2024-02-01'),
        checkOutDate: new Date('2024-02-05'),
        totalPrice: (rooms[4] ? rooms[4].pricePerNight : rooms[0].pricePerNight) * 4,
        status: 'confirmed',
        note: 'Đặt phòng cho kỳ nghỉ dài'
      }
    ];

    // Tạo bookings
    for (const bookingData of sampleBookings) {
      const booking = new Booking(bookingData);
      await booking.save();
      console.log(`✅ Đã tạo booking: ${booking._id}`);
    }

    console.log('🎉 Hoàn thành tạo dữ liệu booking mẫu!');
    console.log(`📊 Đã tạo ${sampleBookings.length} bookings mẫu`);

    // Hiển thị thống kê
    const pendingCount = await Booking.countDocuments({ status: 'pending' });
    const confirmedCount = await Booking.countDocuments({ status: 'confirmed' });
    const cancelledCount = await Booking.countDocuments({ status: 'cancelled' });

    console.log('\n📈 Thống kê booking:');
    console.log(`🟡 Pending: ${pendingCount}`);
    console.log(`🔵 Confirmed: ${confirmedCount}`);
    console.log(`🔴 Cancelled: ${cancelledCount}`);
    
  } catch (error) {
    console.error('❌ Lỗi khi tạo dữ liệu booking:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Chạy seed booking data
connectDB().then(() => {
  seedBookingData();
});




