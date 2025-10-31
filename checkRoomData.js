import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from './Models/PaymentModel.js';
import Booking from './Models/BookingModel.js';
import Room from './Models/RoomModel.js';
import User from './Models/UserModel.js';

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

const checkRoomData = async () => {
  try {
    await connectDB();

    console.log('\n🔍 Kiểm tra dữ liệu phòng và booking...\n');

    // 1. Kiểm tra rooms
    const rooms = await Room.find({});
    console.log(`📊 Tổng số rooms: ${rooms.length}`);
    if (rooms.length > 0) {
      console.log('📋 Sample room:', rooms[0]);
    }

    // 2. Kiểm tra bookings
    const bookings = await Booking.find({}).populate('room', 'name roomNumber type price');
    console.log(`\n📊 Tổng số bookings: ${bookings.length}`);
    if (bookings.length > 0) {
      console.log('📋 Sample booking:', bookings[0]);
      console.log('📋 Booking room:', bookings[0].room);
    }

    // 3. Kiểm tra payments với populate
    const payments = await Payment.find({})
      .populate({
        path: 'bookingId',
        select: 'checkInDate checkOutDate totalPrice status',
        populate: [
          {
            path: 'user',
            select: 'firstName lastName email phone'
          },
          {
            path: 'room',
            select: 'name roomNumber type price'
          }
        ]
      });

    console.log(`\n📊 Tổng số payments: ${payments.length}`);
    if (payments.length > 0) {
      console.log('📋 Sample payment:', payments[0]);
      console.log('📋 Payment booking:', payments[0].bookingId);
      console.log('📋 Payment user:', payments[0].bookingId?.user);
      console.log('📋 Payment room:', payments[0].bookingId?.room);
    }

    console.log('\n✅ Kiểm tra hoàn tất!');

  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Đã ngắt kết nối MongoDB');
  }
};

checkRoomData();

