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

const testPayments = async () => {
  try {
    await connectDB();

    console.log('\n🔍 Kiểm tra dữ liệu thanh toán...\n');

    // 1. Kiểm tra số lượng payments
    const paymentCount = await Payment.countDocuments();
    console.log(`📊 Tổng số thanh toán: ${paymentCount}`);

    // 2. Kiểm tra payments với populate
    const payments = await Payment.find()
      .populate('bookingId', 'checkInDate checkOutDate totalPrice status')
      .populate('bookingId.user', 'firstName lastName email phone')
      .populate('cashierId', 'firstName lastName')
      .sort({ createdAt: -1 });

    console.log(`📋 Danh sách thanh toán (${payments.length}):`);
    payments.forEach((payment, index) => {
      console.log(`\n${index + 1}. Payment ID: ${payment._id}`);
      console.log(`   - Amount: ${payment.amount} ${payment.currency}`);
      console.log(`   - Method: ${payment.method}`);
      console.log(`   - Status: ${payment.status}`);
      console.log(`   - Created: ${payment.createdAt}`);
      
      if (payment.bookingId) {
        console.log(`   - Booking ID: ${payment.bookingId._id}`);
        console.log(`   - Booking Status: ${payment.bookingId.status}`);
        if (payment.bookingId.user) {
          console.log(`   - Customer: ${payment.bookingId.user.firstName} ${payment.bookingId.user.lastName}`);
          console.log(`   - Email: ${payment.bookingId.user.email}`);
        }
      }
    });

    // 3. Kiểm tra bookings
    const bookingCount = await Booking.countDocuments();
    console.log(`\n📊 Tổng số booking: ${bookingCount}`);

    // 4. Kiểm tra users
    const userCount = await User.countDocuments();
    console.log(`📊 Tổng số users: ${userCount}`);

    // 5. Kiểm tra admin users
    const adminUsers = await User.find({ role: 'admin' });
    console.log(`👑 Số admin users: ${adminUsers.length}`);
    adminUsers.forEach(admin => {
      console.log(`   - Admin: ${admin.firstName} ${admin.lastName} (${admin.email})`);
    });

    console.log('\n✅ Kiểm tra hoàn tất!');

  } catch (error) {
    console.error('❌ Lỗi khi kiểm tra:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Đã ngắt kết nối MongoDB');
  }
};

testPayments();

