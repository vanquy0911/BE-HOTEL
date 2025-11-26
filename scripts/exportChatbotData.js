// scripts/exportChatbotData.js - Tạo nội dung tri thức tự động cho chatbot
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import connectDB from "../config/configdb.js";
import Service from "../Models/ServiceModel.js";
import Promotion from "../Models/PromotionModel.js";
import Room from "../Models/RoomModel.js";
import ContactInfo from "../Models/ContactInfoModel.js";
import NearbyPlace from "../Models/NearbyPlaceModel.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DATA_PATH = path.join(
  __dirname,
  "../data/knowledge-base/generated-data.md"
);
const OUTPUT_FAQ_PATH = path.join(
  __dirname,
  "../data/knowledge-base/generated-faq.md"
);

const formatCurrency = (value = 0) => {
  if (typeof value !== "number") return `${value || 0} VNĐ`;
  return value.toLocaleString("vi-VN", { style: "currency", currency: "VND" });
};

const formatDateRange = (start, end) => {
  if (!start || !end) return "Không rõ thời gian";
  const options = { day: "2-digit", month: "2-digit", year: "numeric" };
  const startStr = new Date(start).toLocaleDateString("vi-VN", options);
  const endStr = new Date(end).toLocaleDateString("vi-VN", options);
  return `${startStr} - ${endStr}`;
};

const mapBoolean = (value, trueLabel = "Có", falseLabel = "Không") =>
  value ? trueLabel : falseLabel;

const getCheapestRoom = (rooms = []) => {
  if (!rooms.length) return null;
  const sorted = rooms
    .filter((room) => typeof room.pricePerNight === "number")
    .sort((a, b) => (a.pricePerNight || Infinity) - (b.pricePerNight || Infinity));
  return sorted[0] || null;
};

const pickBudgetFriendlyPromo = (promotions = []) => {
  return promotions
    .filter((promo) => promo.isActive)
    .sort((a, b) => (a.discountValue || 0) - (b.discountValue || 0))
    .pop() || null;
};

const buildServicesSection = (services = []) => {
  if (!services.length) return "## Dịch vụ\nHiện chưa có dữ liệu dịch vụ.\n";

  const lines = services
    .map((service) => {
      const priceDisplay = service.isFree
        ? "Miễn phí"
        : `${formatCurrency(service.price)} / ${service.priceUnit || "dịch vụ"}`;
      return [
        `### ${service.name}`,
        `- Nhóm: ${service.category || "Khác"}`,
        `- Mô tả: ${service.description || "Chưa có mô tả."}`,
        `- Giá: ${priceDisplay}`,
        `- Hoạt động: ${service.operatingHours || "Theo yêu cầu"}`,
        `- Cần đặt trước: ${mapBoolean(service.requiresBooking)}`,
        `- Ghi chú: ${service.notes || "Không"}`,
        "",
      ].join("\n");
    })
    .join("\n");

  return `## Dịch vụ đang cung cấp\n${lines}`;
};

const buildPromotionsSection = (promotions = []) => {
  if (!promotions.length) return "## Khuyến mãi\nChưa có ưu đãi nào.\n";

  const lines = promotions
    .map((promo) => {
      const discount =
        promo.discountType === "percentage"
          ? `${promo.discountValue}%`
          : formatCurrency(promo.discountValue);
      const roomTypes =
        promo.applicableRoomTypes?.length > 0
          ? promo.applicableRoomTypes.join(", ")
          : "Tất cả loại phòng";
      return [
        `### Mã ${promo.code}`,
        `- Tên chương trình: ${promo.name}`,
        `- Hình thức: ${discount}`,
        `- Điều kiện tối thiểu: ${formatCurrency(promo.minBookingAmount || 0)}, tối thiểu ${
          promo.minNights || 0
        } đêm`,
        `- Loại phòng áp dụng: ${roomTypes}`,
        `- Hiệu lực: ${formatDateRange(promo.startDate, promo.endDate)}`,
        `- Công khai: ${mapBoolean(promo.isPublic)}`,
        "",
      ].join("\n");
    })
    .join("\n");

  return `## Chương trình khuyến mãi\n${lines}`;
};

const buildRoomsSection = (rooms = []) => {
  if (!rooms.length) return "## Loại phòng\nHiện chưa có dữ liệu phòng.\n";

  const lines = rooms
    .map((room) => {
      return [
        `### ${room.name}`,
        `- Mã phòng: ${room.code || "N/A"}`,
        `- Loại: ${room.roomType || "Không xác định"}`,
        `- Giá cơ bản: ${formatCurrency(room.pricePerNight || 0)} / đêm`,
        `- Sức chứa: ${room.maxGuests || room.capacity || 2} khách`,
        `- Tiện nghi: ${Array.isArray(room.amenities) && room.amenities.length ? room.amenities.join(", ") : "Theo tiêu chuẩn"}`,
        "",
      ].join("\n");
    })
    .join("\n");

  return `## Danh mục phòng\n${lines}`;
};

const buildContactSection = (contactInfo) => {
  if (!contactInfo) return "## Liên hệ\nChưa cập nhật thông tin liên hệ.\n";

  const phones = [
    contactInfo.phone?.main && `- Hotline: ${contactInfo.phone.main}`,
    contactInfo.phone?.booking && `- Booking: ${contactInfo.phone.booking}`,
  ]
    .filter(Boolean)
    .join("\n");

  const emails = [
    contactInfo.email?.info && `- Email chung: ${contactInfo.email.info}`,
    contactInfo.email?.booking && `- Email đặt phòng: ${contactInfo.email.booking}`,
  ]
    .filter(Boolean)
    .join("\n");

  const social = Object.entries(contactInfo.socialMedia || {})
    .filter(([, url]) => !!url)
    .map(([key, url]) => `- ${key}: ${url}`)
    .join("\n");

  const businessHours = contactInfo.businessHours
    ? `- Giờ mở cửa: ${contactInfo.businessHours.open} - ${contactInfo.businessHours.close}`
    : "";

  return [
    "## Thông tin liên hệ",
    `- Tên khách sạn: ${contactInfo.hotelName || "Rayal Hotel"}`,
    `- Địa chỉ: ${contactInfo.address || "Chưa cập nhật"}`,
    phones,
    emails,
    businessHours,
    social ? "- Mạng xã hội:\n" + social : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildNearbySection = (places = []) => {
  if (!places.length) return "## Địa điểm lân cận\nChưa có dữ liệu.\n";

  const lines = places
    .map((place) => {
      return [
        `### ${place.name}`,
        `- Loại: ${place.category || "Khác"}`,
        `- Khoảng cách: ${place.distance || "Không rõ"}`,
        `- Đi bộ: ${place.walkingTime || "Không rõ"}, Đi xe: ${place.drivingTime || "Không rõ"}`,
        `- Địa chỉ: ${place.address || "Chưa cập nhật"}`,
        place.description ? `- Mô tả: ${place.description}` : "",
        "",
      ].join("\n");
    })
    .join("\n");

  return `## Địa điểm gần khách sạn\n${lines}`;
};

const buildBudgetTipsSection = (rooms = [], promotions = []) => {
  const cheapestRoom = getCheapestRoom(rooms);
  const budgetPromo = pickBudgetFriendlyPromo(promotions);

  if (!cheapestRoom) {
    return "## Gợi ý đặt phòng ngân sách thấp\nChưa có dữ liệu phòng để gợi ý.\n";
  }

  const promoSentence = budgetPromo
    ? `- Áp dụng mã ${budgetPromo.code} (${budgetPromo.discountType === "percentage" ? `${budgetPromo.discountValue}%` : formatCurrency(budgetPromo.discountValue)}), đảm bảo đơn tối thiểu ${formatCurrency(budgetPromo.minBookingAmount || 0)} và ${budgetPromo.minNights || 0} đêm.\n`
    : "- Theo dõi mục Khuyến mãi để nhận mã giảm giá đang mở.\n";

  return [
    "## Gợi ý đặt phòng ngân sách thấp",
    `- Giá thấp nhất hiện tại: ${cheapestRoom.name} từ ${formatCurrency(cheapestRoom.pricePerNight || 0)} / đêm.`,
    "- Nếu ngân sách dưới mức này, bot nên hướng khách:",
    "  1. Đặt sớm và chọn loại phòng Standard / Flash Sale trong form đặt phòng.",
    "  2. Áp dụng mã khuyến mãi đang còn hiệu lực, hoặc yêu cầu nhân viên giữ suất hủy phút chót.",
    "  3. Nhấn “Chat với nhân viên”/gọi hotline 0901 234 567 nếu cần hỗ trợ cọc nhanh.",
    promoSentence,
    "",
  ].join("\n");
};

const buildGeneratedFAQ = ({
  services = [],
  promotions = [],
  rooms = [],
  contactInfo,
  cheapestRoom,
  budgetPromo,
}) => {
  const entries = [];

  services.slice(0, 5).forEach((service) => {
    entries.push({
      question: `Dịch vụ ${service.name} cung cấp những gì và hoạt động lúc nào?`,
      answer: `${service.description || "Dịch vụ đặc biệt"} - giá ${
        service.isFree ? "miễn phí" : formatCurrency(service.price)
      } (${service.priceUnit || "dịch vụ"}). Hoạt động: ${service.operatingHours || "Theo yêu cầu"}.`,
    });
  });

  promotions.slice(0, 5).forEach((promo) => {
    const discount =
      promo.discountType === "percentage"
        ? `${promo.discountValue}%`
        : formatCurrency(promo.discountValue);
    entries.push({
      question: `Mã ${promo.code} áp dụng như thế nào?`,
      answer: `Chương trình ${promo.name} giảm ${discount}, áp dụng cho ${promo.applicableRoomTypes?.length ? promo.applicableRoomTypes.join(", ") : "tất cả phòng"} với đơn tối thiểu ${formatCurrency(promo.minBookingAmount || 0)} và ít nhất ${promo.minNights || 0} đêm. Hiệu lực ${formatDateRange(promo.startDate, promo.endDate)}.`,
    });
  });

  rooms.slice(0, 5).forEach((room) => {
    entries.push({
      question: `Phòng ${room.name} có gì đặc biệt?`,
      answer: `Loại ${room.roomType || "khác"}, giá ${formatCurrency(room.pricePerNight || 0)}/đêm, chứa tối đa ${room.maxGuests || room.capacity || 2} khách. Tiện nghi: ${Array.isArray(room.amenities) && room.amenities.length ? room.amenities.join(", ") : "Tiện nghi tiêu chuẩn"}.`,
    });
  });

  if (contactInfo) {
    entries.push({
      question: "Tôi có thể liên hệ khách sạn bằng cách nào?",
      answer: `Hotline: ${contactInfo.phone?.main || "Chưa cập nhật"}, email: ${
        contactInfo.email?.info || contactInfo.email?.booking || "Chưa cập nhật"
      }, địa chỉ: ${contactInfo.address || "Chưa cập nhật"}.`,
    });
  }

  if (cheapestRoom) {
    const promoTip = budgetPromo
      ? `Bạn có thể áp dụng mã ${budgetPromo.code} để giảm thêm ${
          budgetPromo.discountType === "percentage"
            ? `${budgetPromo.discountValue}%`
            : formatCurrency(budgetPromo.discountValue)
        }.`
      : "Hãy theo dõi mục Khuyến mãi để nhận các mã giảm phù hợp.";
    entries.push({
      question: "Ngân sách của tôi dưới 1.000.000 VNĐ thì đặt phòng thế nào?",
      answer: `Giá thấp nhất hiện tại là ${formatCurrency(
        cheapestRoom.pricePerNight || 0
      )}/đêm cho phòng ${cheapestRoom.name}. Bạn có thể đặt sớm, chọn Flash Sale/Standard, áp dụng mã khuyến mãi đang mở và yêu cầu nhân viên hỗ trợ giữ suất hủy phút chót. ${promoTip}`,
    });
  }

  if (!entries.length) {
    return "# Generated FAQ\nHiện chưa có dữ liệu để tạo Q&A.\n";
  }

  const content = entries
    .map(
      (entry, index) =>
        `**Q${index + 1}: ${entry.question}**\nA: ${entry.answer}\n`
    )
    .join("\n");

  return `# Generated FAQ\n${content}`;
};

async function exportData() {
  try {
    console.log("🔄 Exporting chatbot knowledge data...");
    await connectDB();

    const [services, promotions, rooms, contactInfo, nearbyPlaces] =
      await Promise.all([
        Service.find({ isActive: true }).sort({ category: 1, name: 1 }),
        Promotion.find({}).sort({ startDate: -1 }),
        Room.find({}).sort({ pricePerNight: 1 }),
        ContactInfo.findOne({ isActive: true }),
        NearbyPlace.find({ isActive: true }).sort({ distance: 1 }),
      ]);

    const sections = [
      "# Dữ liệu tự động cho Chatbot",
      buildContactSection(contactInfo),
      buildRoomsSection(rooms),
      buildServicesSection(services),
      buildPromotionsSection(promotions),
      buildBudgetTipsSection(rooms, promotions),
      buildNearbySection(nearbyPlaces),
    ].join("\n");

    fs.writeFileSync(OUTPUT_DATA_PATH, sections, "utf-8");
    console.log(`✅ Saved structured data to ${OUTPUT_DATA_PATH}`);

    const cheapestRoom = getCheapestRoom(rooms);
    const budgetPromo = pickBudgetFriendlyPromo(promotions);

    const faqContent = buildGeneratedFAQ({
      services,
      promotions,
      rooms,
      contactInfo,
      cheapestRoom,
      budgetPromo,
    });
    fs.writeFileSync(OUTPUT_FAQ_PATH, faqContent, "utf-8");
    console.log(`✅ Saved auto-generated FAQ to ${OUTPUT_FAQ_PATH}`);

    console.log("🎉 Export completed. Chạy lại scripts/ingestKnowledgeBase.js để cập nhật vector store.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Export failed:", error);
    process.exit(1);
  }
}

exportData();

