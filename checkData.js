// checkData.js - Kiểm tra dữ liệu trong database
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';
import Booking from './Models/BookingModel.js';

dotenv.config();

const checkData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check users
    const users = await User.find();
    console.log(`👥 Users: ${users.length}`);
    users.forEach(user => {
      console.log(`  - ${user.email} (${user.role})`);
    });

    // Check rooms
    const rooms = await Room.find();
    console.log(`🏨 Rooms: ${rooms.length}`);
    rooms.forEach(room => {
      console.log(`  - ${room.name} (${room.roomNumber}) - Available: ${room.available}`);
    });

    // Check bookings
    const bookings = await Booking.find();
    console.log(`📅 Bookings: ${bookings.length}`);
    bookings.forEach(booking => {
      console.log(`  - ${booking._id} (${booking.status})`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

checkData();




