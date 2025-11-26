// seedServices.js - Script để thêm dữ liệu dịch vụ mẫu
import mongoose from "mongoose";
import dotenv from "dotenv";
import Service from "./Models/ServiceModel.js";

dotenv.config();

const sampleServices = [
  {
    name: "Dịch vụ đưa đón sân bay",
    description: "Dịch vụ đưa đón khách từ sân bay về khách sạn và ngược lại. Xe 4 chỗ và 7 chỗ có sẵn.",
    category: "transport",
    price: 200000,
    priceUnit: "VND",
    isActive: true,
    requiresBooking: true,
    advanceBookingHours: 24
  },
  {
    name: "Giặt ủi",
    description: "Dịch vụ giặt ủi quần áo cho khách. Giặt thường và giặt khô.",
    category: "laundry",
    price: 50000,
    priceUnit: "per_kg",
    isActive: true,
    requiresBooking: false
  },
  {
    name: "Massage & Spa",
    description: "Dịch vụ massage thư giãn và chăm sóc sức khỏe. Có nhiều gói dịch vụ khác nhau.",
    category: "spa",
    price: 500000,
    priceUnit: "VND",
    isActive: true,
    requiresBooking: true,
    advanceBookingHours: 2,
    operatingHours: {
      open: "09:00",
      close: "22:00",
      is24Hours: false
    }
  },
  {
    name: "Phòng gym",
    description: "Phòng tập gym hiện đại với đầy đủ thiết bị. Miễn phí cho khách lưu trú.",
    category: "fitness",
    price: 0,
    priceUnit: "VND",
    isFree: true,
    isActive: true,
    operatingHours: {
      open: "06:00",
      close: "23:00",
      is24Hours: false
    }
  },
  {
    name: "Phòng họp",
    description: "Phòng họp với sức chứa 20-50 người. Có đầy đủ thiết bị trình chiếu và wifi.",
    category: "conference",
    price: 1000000,
    priceUnit: "per_hour",
    isActive: true,
    requiresBooking: true,
    advanceBookingHours: 48
  },
  {
    name: "Nhà hàng buffet sáng",
    description: "Buffet sáng đa dạng với các món Á - Âu. Phục vụ từ 6:00 - 10:00.",
    category: "dining",
    price: 200000,
    priceUnit: "VND",
    isActive: true,
    operatingHours: {
      open: "06:00",
      close: "10:00",
      is24Hours: false
    }
  },
  {
    name: "Dịch vụ đặt tour",
    description: "Hỗ trợ đặt tour du lịch trong thành phố và các điểm tham quan gần đó.",
    category: "other",
    price: 0,
    priceUnit: "VND",
    isActive: true,
    requiresBooking: true,
    advanceBookingHours: 24
  },
  {
    name: "Dịch vụ cho thuê xe máy",
    description: "Cho thuê xe máy để khách tự do di chuyển. Có bảo hiểm và mũ bảo hiểm.",
    category: "transport",
    price: 150000,
    priceUnit: "per_day",
    isActive: true,
    requiresBooking: true,
    advanceBookingHours: 12
  }
];

const seedServices = async () => {
  try {
    // Kết nối MongoDB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/hotel");
    console.log("✅ Đã kết nối MongoDB");

    // Xóa tất cả dịch vụ cũ (tùy chọn)
    // await Service.deleteMany({});
    // console.log("✅ Đã xóa dữ liệu cũ");

    // Thêm dịch vụ mẫu
    const existingServices = await Service.find({});
    if (existingServices.length > 0) {
      console.log(`⚠️  Đã có ${existingServices.length} dịch vụ trong database. Bỏ qua việc seed.`);
      console.log("💡 Nếu muốn seed lại, hãy xóa dữ liệu cũ trước.");
      process.exit(0);
    }

    const insertedServices = await Service.insertMany(sampleServices);
    console.log(`✅ Đã thêm ${insertedServices.length} dịch vụ mẫu vào database:`);
    
    insertedServices.forEach(service => {
      console.log(`   - ${service.name} (${service.category})`);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi khi seed dữ liệu:", error);
    process.exit(1);
  }
};

seedServices();




