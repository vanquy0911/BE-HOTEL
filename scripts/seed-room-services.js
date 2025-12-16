import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Room from "../Models/RoomModel.js";

dotenv.config();

// Đọc cấu hình dịch vụ chung của khách sạn (để reuse ghi chú/giá)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hotelInfoPath = path.resolve(__dirname, "../config/hotelInfo.json");
let hotelInfo = {};
try {
  const raw = fs.readFileSync(hotelInfoPath, "utf-8");
  hotelInfo = JSON.parse(raw);
} catch (err) {
  console.error("❌ Không đọc được hotelInfo.json, sẽ dùng fallback text đơn giản:", err.message);
}

const servicesCfg = hotelInfo.services || {};

const getServiceNote = (key) => {
  const cfg = servicesCfg[key] || {};
  return {
    priceRange: cfg.priceRange || "",
    notes: cfg.notes || ""
  };
};

const upsertPaidService = (paidServices, service) => {
  if (!service?.key) return paidServices;
  const existingIndex = paidServices.findIndex((s) => s.key === service.key);
  if (existingIndex >= 0) {
    paidServices[existingIndex] = {
      ...paidServices[existingIndex],
      ...service
    };
  } else {
    paidServices.push(service);
  }
  return paidServices;
};

const seedRoomServices = async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI chưa được thiết lập. Vui lòng set URI (Atlas/remote) hoặc chạy mongod local và đặt MONGODB_URI tương ứng.");
    }
    await mongoose.connect(uri);
    console.log("✅ Đã kết nối MongoDB để cập nhật dịch vụ theo phòng");

    const rooms = await Room.find({}).lean();
    console.log(`🔍 Tìm thấy ${rooms.length} phòng trong database`);

    for (const room of rooms) {
      const includedSet = new Set(room.includedServices || []);
      let paidServices = Array.isArray(room.paidServices) ? [...room.paidServices] : [];

      // Mặc định: tất cả phòng đều được dùng gym + parking miễn phí
      includedSet.add("gym");
      includedSet.add("parking");

      // Lấy notes/price từ hotelInfo
      const bfCfg = getServiceNote("restaurant");
      const shuttleCfg = getServiceNote("airportPickup");

      // Logic mẫu theo loại phòng:
      // - suite & VIP: bao gồm buffet sáng, đưa đón trả phí
      // - còn lại: buffet sáng trả phí, đưa đón trả phí
      const type = room.roomType || "";
      const isSuiteOrVip = ["suite", "VIP", "vip"].includes(type);

      if (isSuiteOrVip) {
        includedSet.add("breakfast");
      } else {
        // Nếu chưa bao gồm breakfast thì cho vào paidServices
        if (!includedSet.has("breakfast")) {
          paidServices = upsertPaidService(paidServices, {
            key: "breakfast",
            priceNote: bfCfg.priceRange || "Buffet sáng khoảng 200.000đ/suất",
            notes: bfCfg.notes || hotelInfo?.localInfo?.breakfast || ""
          });
        }
      }

      // Đưa đón sân bay: mặc định là dịch vụ trả phí cho mọi phòng
      paidServices = upsertPaidService(paidServices, {
        key: "airportPickup",
        priceNote: shuttleCfg.priceRange || "Từ 200.000đ/chiều (4/7 chỗ)",
        notes: shuttleCfg.notes || "Cần đặt trước 24h"
      });

      const includedServices = Array.from(includedSet);

      await Room.updateOne(
        { _id: room._id },
        {
          $set: {
            includedServices,
            paidServices
          }
        }
      );

      console.log(
        `✅ Updated room services: ${room.name} (${room.roomType})`,
        {
          includedServices,
          paidServices
        }
      );
    }

    console.log("🎉 Hoàn tất cập nhật dịch vụ cho tất cả phòng");
    process.exit(0);
  } catch (err) {
    console.error("❌ Lỗi khi seed dịch vụ theo phòng:", err);
    process.exit(1);
  }
};

seedRoomServices();


