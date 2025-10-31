// addBooking.js - Tạo booking mẫu đơn giản
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './Models/BookingModel.js';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';

dotenv.config();

const addBooking = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get first user and room
    const user = await User.findOne();
    const room = await Room.findOne();

    if (!user || !room) {
      console.log('❌ Need at least 1 user and 1 room');
      return;
    }

    // Create booking
    const booking = new Booking({
      user: user._id,
      room: room._id,
      checkInDate: new Date('2024-01-15'),
      checkOutDate: new Date('2024-01-18'),
      totalPrice: room.pricePerNight * 3,
      status: 'pending',
      note: 'Test booking'
    });

    await booking.save();
    console.log('✅ Booking created:', booking._id);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

addBooking();




