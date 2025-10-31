// seedData.js - Script để thêm dữ liệu mẫu
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from './Models/RoomModel.js';
import Location from './Models/LocationModel.js';

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

const seedData = async () => {
  try {
    // Xóa dữ liệu cũ
    await Room.deleteMany({});
    await Location.deleteMany({});
    console.log('🗑️ Đã xóa dữ liệu cũ');

    // Tạo location mẫu
    const location1 = new Location({
      address: "123 Đường Bãi Biển, Quận 1",
      province: "TP. Hồ Chí Minh",
      city: "TP. Hồ Chí Minh",
      nearbyPlaces: ["Bãi biển Vũng Tàu", "Chợ Bến Thành", "Nhà thờ Đức Bà"],
      coordinates: {
        lat: 10.7769,
        lng: 106.7009
      },
      tags: "Trung tâm thành phố"
    });

    const location2 = new Location({
      address: "456 Đường Núi, Quận 3",
      province: "TP. Hồ Chí Minh", 
      city: "TP. Hồ Chí Minh",
      nearbyPlaces: ["Công viên Lê Văn Tám", "Chợ Tân Định"],
      coordinates: {
        lat: 10.7870,
        lng: 106.6910
      },
      tags: "Gần công viên"
    });

    await location1.save();
    await location2.save();
    console.log('📍 Đã tạo location mẫu');

    // Tạo rooms mẫu
    const rooms = [
      {
        name: "Phòng Deluxe Ocean View",
        roomNumber: "101",
        bedType: "king",
        maxOccupancy: 2,
        roomType: "VIP",
        size: 45,
        pricePerNight: 2500000,
        fee: 200000,
        descriptionfee: "Phí dịch vụ spa và gym",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=500",
        description: "Phòng sang trọng với view biển tuyệt đẹp, đầy đủ tiện nghi hiện đại",
        view: "Ocean View",
        available: true,
        amenities: ["WiFi", "TV", "Minibar", "Spa", "Gym"],
        location: location1._id
      },
      {
        name: "Phòng Standard City View",
        roomNumber: "201",
        bedType: "đôi",
        maxOccupancy: 2,
        roomType: "đôi",
        size: 30,
        pricePerNight: 1500000,
        fee: 100000,
        descriptionfee: "Phí dịch vụ cơ bản",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=500",
        description: "Phòng tiêu chuẩn với view thành phố, thoải mái và tiện nghi",
        view: "City View",
        available: true,
        amenities: ["WiFi", "TV", "Minibar"],
        location: location2._id
      },
      {
        name: "Phòng Suite Premium",
        roomNumber: "301",
        bedType: "king",
        maxOccupancy: 4,
        roomType: "suite",
        size: 60,
        pricePerNight: 3500000,
        fee: 300000,
        descriptionfee: "Phí dịch vụ cao cấp",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=500",
        description: "Suite cao cấp với không gian rộng rãi, phù hợp cho gia đình",
        view: "Ocean View",
        available: true,
        amenities: ["WiFi", "TV", "Minibar", "Spa", "Gym", "Balcony"],
        location: location1._id
      },
      {
        name: "Phòng Single Economy",
        roomNumber: "102",
        bedType: "đơn",
        maxOccupancy: 1,
        roomType: "đơn",
        size: 20,
        pricePerNight: 800000,
        fee: 50000,
        descriptionfee: "Phí dịch vụ cơ bản",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=500",
        description: "Phòng đơn tiết kiệm, phù hợp cho khách du lịch một mình",
        view: "Garden View",
        available: true,
        amenities: ["WiFi", "TV"],
        location: location2._id
      }
    ];

    for (const roomData of rooms) {
      const room = new Room(roomData);
      await room.save();
    }

    console.log('🏨 Đã tạo rooms mẫu');
    console.log('✅ Hoàn thành seed data!');
    
  } catch (error) {
    console.error('❌ Lỗi khi seed data:', error);
  } finally {
    mongoose.connection.close();
  }
};

// Chạy seed data
connectDB().then(() => {
  seedData();
});
