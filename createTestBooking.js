// createTestBooking.js - Tạo booking test đơn giản
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './Models/BookingModel.js';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';

dotenv.config();

const createTestBooking = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get first user and room
    const user = await User.findOne();
    const room = await Room.findOne();

    if (!user) {
      console.log('❌ No user found. Please create a user first.');
      return;
    }

    if (!room) {
      console.log('❌ No room found. Please create a room first.');
      return;
    }

    console.log('👤 User:', user.email);
    console.log('🏨 Room:', room.name);

    // Create test bookings
    const testBookings = [
      {
        user: user._id,
        room: room._id,
        checkInDate: new Date('2024-01-15'),
        checkOutDate: new Date('2024-01-18'),
        totalPrice: room.pricePerNight * 3,
        status: 'pending',
        note: 'Test booking 1'
      },
      {
        user: user._id,
        room: room._id,
        checkInDate: new Date('2024-01-20'),
        checkOutDate: new Date('2024-01-22'),
        totalPrice: room.pricePerNight * 2,
        status: 'confirmed',
        note: 'Test booking 2'
      },
      {
        user: user._id,
        room: room._id,
        checkInDate: new Date('2024-01-10'),
        checkOutDate: new Date('2024-01-12'),
        totalPrice: room.pricePerNight * 2,
        status: 'cancelled',
        note: 'Test booking 3'
      }
    ];

    // Clear existing bookings
    await Booking.deleteMany({});
    console.log('🗑️ Cleared existing bookings');

    // Create new bookings
    for (const bookingData of testBookings) {
      const booking = new Booking(bookingData);
      await booking.save();
      console.log(`✅ Created booking: ${booking._id} (${booking.status})`);
    }

    console.log('🎉 Test bookings created successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

createTestBooking();




