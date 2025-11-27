// scripts/addGroupRooms.js - Thêm phòng cho nhóm lớn (6-8 người)
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Room from '../Models/RoomModel.js';
import Location from '../Models/LocationModel.js';

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

const addGroupRooms = async () => {
  try {
    // Lấy location mặc định
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
      console.log('✅ Đã tạo location mặc định');
    }

    // Kiểm tra xem đã có phòng này chưa
    const existingRoom601 = await Room.findOne({ roomNumber: "601" });
    const existingRoom602 = await Room.findOne({ roomNumber: "602" });
    const existingRoom801 = await Room.findOne({ roomNumber: "801" });
    const existingRoom802 = await Room.findOne({ roomNumber: "802" });

    // 2 phòng cho 6 người
    const roomsFor6 = [
      {
        name: "Phòng Family 6 Người",
        roomNumber: "601",
        bedType: "king",
        maxOccupancy: 6,
        roomType: "suite", // Dùng suite vì phòng lớn
        size: 80,
        pricePerNight: 5000000, // 5.000.000 VNĐ/đêm
        fee: 300000,
        descriptionfee: "Phí dịch vụ gia đình",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=500",
        description: "Phòng rộng rãi phù hợp cho gia đình 6 người, có 2 phòng ngủ riêng và phòng khách",
        view: "City View",
        available: true,
        amenities: ["WiFi miễn phí", "TV 55 inch", "Điều hòa", "Minibar", "Phòng tắm riêng", "Máy sấy tóc", "Ban công rộng", "Bàn làm việc", "Két an toàn", "Phòng khách riêng", "Sofa bed", "Dịch vụ phòng 24/7"],
        location: location._id
      },
      {
        name: "Phòng Deluxe Family 6 Người",
        roomNumber: "602",
        bedType: "king",
        maxOccupancy: 6,
        roomType: "suite",
        size: 75,
        pricePerNight: 4800000, // 4.800.000 VNĐ/đêm
        fee: 250000,
        descriptionfee: "Phí dịch vụ gia đình",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=500",
        description: "Phòng Deluxe gia đình với không gian thoải mái cho 6 người, có giường phụ và sofa bed",
        view: "Garden View",
        available: true,
        amenities: ["WiFi miễn phí", "TV 50 inch", "Điều hòa", "Minibar", "Phòng tắm riêng", "Máy sấy tóc", "Ban công", "Bàn làm việc", "Két an toàn", "Sofa bed", "Dịch vụ phòng 24/7"],
        location: location._id
      }
    ];

    // 2 phòng cho 8 người
    const roomsFor8 = [
      {
        name: "Phòng Suite Luxury 8 Người",
        roomNumber: "801",
        bedType: "king",
        maxOccupancy: 8,
        roomType: "suite",
        size: 120,
        pricePerNight: 8000000, // 8.000.000 VNĐ/đêm
        fee: 500000,
        descriptionfee: "Phí dịch vụ cao cấp cho đoàn lớn",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=500",
        description: "Suite cao cấp rộng rãi với 3 phòng ngủ riêng và phòng khách lớn, phù hợp cho đoàn 8 người hoặc gia đình lớn",
        view: "Ocean View",
        available: true,
        amenities: ["WiFi miễn phí", "TV 65 inch Smart TV", "Điều hòa", "Minibar cao cấp", "Phòng tắm xa xỉ với bồn tắm jacuzzi", "Máy sấy tóc", "Ban công rộng", "Bàn làm việc", "Két an toàn", "Phòng khách riêng", "Sofa bed", "Hệ thống âm thanh", "Dịch vụ phòng 24/7", "Bếp mini"],
        location: location._id
      },
      {
        name: "Phòng Presidential 8 Người",
        roomNumber: "802",
        bedType: "king",
        maxOccupancy: 8,
        roomType: "suite",
        size: 110,
        pricePerNight: 7500000, // 7.500.000 VNĐ/đêm
        fee: 400000,
        descriptionfee: "Phí dịch vụ cao cấp cho đoàn lớn",
        isAvailable: 1,
        image: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=500",
        description: "Phòng Presidential với không gian sang trọng, có 3 phòng ngủ và phòng khách rộng, lý tưởng cho đoàn 8 người",
        view: "Panorama View",
        available: true,
        amenities: ["WiFi miễn phí", "TV 65 inch Smart TV", "Điều hòa", "Minibar cao cấp", "Phòng tắm với bồn tắm", "Máy sấy tóc", "Ban công rộng", "Bàn làm việc", "Két an toàn", "Phòng khách riêng", "Sofa bed", "Hệ thống âm thanh", "Dịch vụ phòng 24/7", "Bếp mini", "Máy giặt"],
        location: location._id
      }
    ];

    // Thêm phòng 6 người
    for (const roomData of roomsFor6) {
      if (roomData.roomNumber === "601" && existingRoom601) {
        console.log('⚠️ Phòng 601 đã tồn tại, bỏ qua');
        continue;
      }
      if (roomData.roomNumber === "602" && existingRoom602) {
        console.log('⚠️ Phòng 602 đã tồn tại, bỏ qua');
        continue;
      }
      const room = new Room(roomData);
      await room.save();
      console.log(`✅ Đã tạo phòng ${roomData.roomNumber}: ${roomData.name} (${roomData.maxOccupancy} người)`);
    }

    // Thêm phòng 8 người
    for (const roomData of roomsFor8) {
      if (roomData.roomNumber === "801" && existingRoom801) {
        console.log('⚠️ Phòng 801 đã tồn tại, bỏ qua');
        continue;
      }
      if (roomData.roomNumber === "802" && existingRoom802) {
        console.log('⚠️ Phòng 802 đã tồn tại, bỏ qua');
        continue;
      }
      const room = new Room(roomData);
      await room.save();
      console.log(`✅ Đã tạo phòng ${roomData.roomNumber}: ${roomData.name} (${roomData.maxOccupancy} người)`);
    }

    console.log('✅ Hoàn thành thêm phòng cho nhóm lớn!');
    
  } catch (error) {
    console.error('❌ Lỗi khi thêm phòng:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

// Chạy script
connectDB().then(() => {
  addGroupRooms();
});


