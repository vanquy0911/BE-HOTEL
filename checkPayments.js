import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Payment from './Models/PaymentModel.js';
import Booking from './Models/BookingModel.js';
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

const checkPayments = async () => {
  try {
    await connectDB();

    console.log('\n🔍 Kiểm tra dữ liệu thanh toán...\n');

    // 1. Kiểm tra tất cả payments
    const allPayments = await Payment.find({});
    console.log(`📊 Tổng số payments trong DB: ${allPayments.length}`);

    if (allPayments.length > 0) {
      console.log('\n📋 Chi tiết payments:');
      allPayments.forEach((payment, index) => {
        console.log(`\n${index + 1}. Payment ID: ${payment._id}`);
        console.log(`   - Amount: ${payment.amount}`);
        console.log(`   - Method: ${payment.method}`);
        console.log(`   - Status: ${payment.status}`);
        console.log(`   - Booking ID: ${payment.bookingId}`);
        console.log(`   - Created: ${payment.createdAt}`);
      });
    } else {
      console.log('❌ Không có payment nào trong database!');
    }

    // 2. Kiểm tra bookings
    const allBookings = await Booking.find({});
    console.log(`\n📊 Tổng số bookings trong DB: ${allBookings.length}`);

    if (allBookings.length > 0) {
      console.log('\n📋 Chi tiết bookings:');
      allBookings.forEach((booking, index) => {
        console.log(`\n${index + 1}. Booking ID: ${booking._id}`);
        console.log(`   - User: ${booking.user}`);
        console.log(`   - Room: ${booking.room}`);
        console.log(`   - Status: ${booking.status}`);
        console.log(`   - Payment Status: ${booking.paymentStatus}`);
        console.log(`   - Total Price: ${booking.totalPrice}`);
        console.log(`   - Created: ${booking.createdAt}`);
      });
    }

    // 3. Kiểm tra users
    const allUsers = await User.find({});
    console.log(`\n📊 Tổng số users trong DB: ${allUsers.length}`);

    // 4. Kiểm tra payments với populate
    console.log('\n🔍 Kiểm tra payments với populate...');
    const paymentsWithPopulate = await Payment.find({})
      .populate('bookingId', 'checkInDate checkOutDate totalPrice status')
      .populate('bookingId.user', 'firstName lastName email phone')
      .populate('cashierId', 'firstName lastName')
      .sort({ createdAt: -1 });

    console.log(`📊 Payments với populate: ${paymentsWithPopulate.length}`);
    if (paymentsWithPopulate.length > 0) {
      console.log('📋 Sample payment với populate:', JSON.stringify(paymentsWithPopulate[0], null, 2));
    }

    console.log('\n✅ Kiểm tra hoàn tất!');

  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Đã ngắt kết nối MongoDB');
  }
};

checkPayments();

