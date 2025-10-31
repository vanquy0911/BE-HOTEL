// checkRooms.js - Kiểm tra dữ liệu rooms
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from './Models/RoomModel.js';

dotenv.config();

const checkRooms = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const rooms = await Room.find();
    console.log(`🏨 Found ${rooms.length} rooms:`);
    
    if (rooms.length === 0) {
      console.log('❌ Không có phòng nào trong database!');
      console.log('💡 Hãy chạy: npm run seed để tạo dữ liệu mẫu');
    } else {
      rooms.forEach(room => {
        console.log(`  - ID: ${room._id}`);
        console.log(`  - Name: ${room.name}`);
        console.log(`  - Number: ${room.roomNumber}`);
        console.log(`  - Available: ${room.available}`);
        console.log(`  - Price: ${room.pricePerNight} VND`);
        console.log('  ---');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

checkRooms();




