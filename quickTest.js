// Quick test - tạo dữ liệu thanh toán
import mongoose from 'mongoose';
import dotenv from 'dotenv';

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

const createQuickData = async () => {
  try {
    await connectDB();

    // Tạo payment trực tiếp
    const Payment = mongoose.model('Payment', new mongoose.Schema({
      bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
      amount: Number,
      method: String,
      status: String,
      notes: String,
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }));

    // Tạo payment test
    const testPayment = await Payment.create({
      bookingId: new mongoose.Types.ObjectId(),
      amount: 2000000,
      method: 'cash',
      status: 'pending',
      notes: 'Test payment - Thanh toán tại quầy'
    });

    console.log('✅ Tạo payment test thành công:', testPayment._id);
    console.log('🎯 Bây giờ hãy refresh trang Payment Management!');

  } catch (error) {
    console.error('❌ Lỗi:', error.message);
  } finally {
    await mongoose.disconnect();
  }
};

createQuickData();

