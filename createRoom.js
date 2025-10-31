// createRoom.js - Tạo room mẫu nếu chưa có
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from './Models/RoomModel.js';
import Location from './Models/LocationModel.js';

dotenv.config();

const createRoom = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check if rooms exist
    const existingRooms = await Room.find();
    if (existingRooms.length > 0) {
      console.log(`✅ Found ${existingRooms.length} existing rooms`);
      console.log('First room ID:', existingRooms[0]._id);
      return;
    }

    // Create location first
    let location = await Location.findOne();
    if (!location) {
      location = new Location({
        address: "123 Đường ABC, Quận 1",
        province: "TP. Hồ Chí Minh", 
        city: "TP. Hồ Chí Minh",
        nearbyPlaces: ["Trung tâm thành phố", "Sân bay"],
        coordinates: { lat: 10.8231, lng: 106.6297 }
      });
      await location.save();
      console.log('✅ Created default location');
    }

    // Create sample room
    const room = new Room({
      name: "Phòng Deluxe Ocean View",
      roomNumber: "101",
      bedType: "king",
      maxOccupancy: 2,
      roomType: "VIP",
      size: 45,
      pricePerNight: 1500000,
      fee: 200000,
      description: "Phòng sang trọng với view biển tuyệt đẹp",
      view: "Ocean View",
      available: true,
      isAvailable: 1,
      amenities: ["WiFi", "TV", "Minibar", "Spa"],
      image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=500",
      location: location._id
    });

    await room.save();
    console.log('✅ Created sample room:', room._id);
    console.log('Room name:', room.name);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.connection.close();
  }
};

createRoom();




