// createBookingData.js - Tạo dữ liệu booking mẫu
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './Models/BookingModel.js';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';

dotenv.config();

const createBookingData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Kết nối MongoDB thành công');

    // Lấy users và rooms
    const users = await User.find().limit(3);
    const rooms = await Room.find().limit(3);

    if (users.length === 0 || rooms.length === 0) {
      console.log('❌ Cần có ít nhất 1 user và 1 room');
      return;
    }

    // Xóa booking cũ
    await Booking.deleteMany({});
    console.log('🗑️ Đã xóa booking cũ');

    // Tạo booking mẫu
    const bookings = [
      {
        user: users[0]._id,
        room: rooms[0]._id,
        checkInDate: new Date('2024-01-15'),
        checkOutDate: new Date('2024-01-18'),
        totalPrice: rooms[0].pricePerNight * 3,
        status: 'pending',
        note: 'Chờ xác nhận'
      },
      {
        user: users[0]._id,
        room: rooms[1] ? rooms[1]._id : rooms[0]._id,
        checkInDate: new Date('2024-01-20'),
        checkOutDate: new Date('2024-01-22'),
        totalPrice: (rooms[1] ? rooms[1].pricePerNight : rooms[0].pricePerNight) * 2,
        status: 'confirmed',
        note: 'Đã xác nhận'
      },
      {
        user: users[0]._id,
        room: rooms[2] ? rooms[2]._id : rooms[0]._id,
        checkInDate: new Date('2024-01-10'),
        checkOutDate: new Date('2024-01-12'),
        totalPrice: (rooms[2] ? rooms[2].pricePerNight : rooms[0].pricePerNight) * 2,
        status: 'cancelled',
        note: 'Đã hủy'
      }
    ];

    for (const bookingData of bookings) {
      const booking = new Booking(bookingData);
      await booking.save();
      console.log(`✅ Tạo booking: ${booking._id}`);
    }

    console.log('🎉 Hoàn thành!');
    
  } catch (error) {
    console.error('❌ Lỗi:', error);
  } finally {
    mongoose.connection.close();
  }
};

createBookingData();




