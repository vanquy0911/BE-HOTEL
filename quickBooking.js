import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './Models/BookingModel.js';
import User from './Models/UserModel.js';
import Room from './Models/RoomModel.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Connected to MongoDB');
  
  const user = await User.findOne();
  const room = await Room.findOne();
  
  if (user && room) {
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
    console.log('Booking created:', booking._id);
  } else {
    console.log('No user or room found');
  }
  
  mongoose.connection.close();
}).catch(console.error);




