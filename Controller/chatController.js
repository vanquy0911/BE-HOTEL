import asyncHandler from "express-async-handler";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";
import Room from "../Models/RoomModel.js";
import Booking from "../Models/BookingModel.js";
import crypto from "crypto";
import dotenv from "dotenv";
import { detectLanguage, getLanguage } from "../utils/languageDetector.js";

dotenv.config();

// ✅ Import RAG Service
let ragService = null;
try {
  const ragModule = await import("../services/ragService.js").catch(() => null);
  if (ragModule) {
    ragService = ragModule.default;
    console.log("✅ RAG Service loaded");
  }
} catch (error) {
  console.warn("⚠️  RAG Service not available:", error.message);
}

// Initialize Gemini AI (nếu có API key và package đã cài)
let genAI = null;
let geminiModel = null;
let geminiAvailable = false;
let GoogleGenerativeAI = null;

// Khởi tạo Gemini API
(async () => {
  try {
    // Kiểm tra xem package đã được cài chưa
    const geminiModule = await import("@google/generative-ai").catch(() => null);
    
    if (geminiModule && geminiModule.GoogleGenerativeAI) {
      GoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (apiKey && apiKey.trim() !== "") {
        genAI = new GoogleGenerativeAI(apiKey);
        
        // Import safety settings
        const { HarmCategory, HarmBlockThreshold } = geminiModule;
        
        // Khởi tạo model với safety settings
        geminiModel = genAI.getGenerativeModel({ 
          model: "gemini-2.5-flash",
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
          generationConfig: {
            temperature: 0.7, // Tạo response tự nhiên nhưng vẫn kiểm soát
            topP: 0.8,
            topK: 40,
          }
        });
        geminiAvailable = true;
        console.log("✅ Gemini API initialized successfully with safety settings");
      } else {
        console.log("⚠️  GEMINI_API_KEY not found in .env file, using mock responses");
        console.log("💡 Để sử dụng Gemini API, hãy:");
        console.log("   1. Cài đặt: npm install @google/generative-ai");
        console.log("   2. Thêm vào .env: GEMINI_API_KEY=your_api_key_here");
      }
    } else {
      console.log("⚠️  Package @google/generative-ai chưa được cài đặt, using mock responses");
      console.log("💡 Chạy lệnh: npm install @google/generative-ai");
    }
  } catch (error) {
    console.error("❌ Error initializing Gemini API:", error.message);
    console.log("⚠️  Falling back to mock responses");
    geminiAvailable = false;
  }
})();

// ✅ Hàm tính tổng tiền với phụ thu trẻ em
// @param {number} basePricePerNight - Giá phòng/đêm
// @param {number} nights - Số đêm
// @param {number} roomQuantity - Số phòng
// @param {number} adults - Số người lớn
// @param {Array} children - Mảng trẻ em: [{age: 5}, {age: 8}, {age: 13}] hoặc []
// @returns {Object} {baseTotal, childSurcharge, totalPrice}
const calculateTotalPriceWithChildSurcharge = (
  basePricePerNight,
  nights,
  roomQuantity,
  adults = 1,
  children = []
) => {
  // Tính giá cơ bản (giá phòng * số đêm * số phòng)
  const baseTotal = basePricePerNight * nights * roomQuantity;
  
  // Tính phụ thu trẻ em
  let childSurcharge = 0;
  
  // Nếu có trẻ em, tính phụ thu
  if (children && children.length > 0) {
    // Giả sử giá phòng chia đều cho số người lớn (hoặc 1 nếu không có người lớn)
    // Đây là giá mỗi người lớn mỗi đêm
    const pricePerAdultPerNight = basePricePerNight / Math.max(adults, 1);
    
    children.forEach(child => {
      const childAge = child.age || child;
      
      if (childAge < 6) {
        // Trẻ dưới 6 tuổi: miễn phí nếu ở chung giường với ba mẹ, không phụ thu
        childSurcharge += 0;
      } else if (childAge >= 6 && childAge < 12) {
        // Trẻ từ 6 đến 11 tuổi: phụ thu 50% giá người lớn cho mỗi bé
        childSurcharge += (pricePerAdultPerNight * 0.5) * nights * roomQuantity;
      } else {
        // Trẻ từ 12 tuổi trở lên: tính như người lớn (100% giá người lớn)
        childSurcharge += pricePerAdultPerNight * nights * roomQuantity;
      }
    });
  }
  
  const totalPrice = baseTotal + childSurcharge;
  
  return {
    baseTotal,
    childSurcharge,
    totalPrice
  };
};

// System prompt cho AI chatbot khách sạn
const SYSTEM_PROMPT = `Bạn là trợ lý ảo chuyên nghiệp của Rayal Park Hotel - một khách sạn 5 sao tại Việt Nam.

QUY TẮC NGÔN NGỮ QUAN TRỌNG (MANDATORY):
- LUÔN LUÔN trả lời bằng ĐÚNG NGÔN NGỮ mà khách hàng sử dụng trong câu hỏi
- Nếu khách hỏi bằng tiếng Anh → trả lời bằng tiếng Anh
- Nếu khách hỏi bằng tiếng Việt → trả lời bằng tiếng Việt
- Giữ nguyên ngôn ngữ trong suốt cuộc hội thoại
- KHÔNG BAO GIỜ trộn lẫn 2 ngôn ngữ trong một câu trả lời
- Nếu bạn thấy instruction "IMPORTANT: You MUST respond in English" → BẮT BUỘC trả lời bằng tiếng Anh
- Nếu bạn thấy instruction "QUAN TRỌNG: Bạn PHẢI trả lời bằng tiếng Việt" → BẮT BUỘC trả lời bằng tiếng Việt

NHIỆM VỤ CỦA BẠN:
- Tư vấn khách hàng về dịch vụ khách sạn một cách thân thiện, chuyên nghiệp
- Trả lời các câu hỏi về giá phòng, đặt phòng, dịch vụ
- Hướng dẫn khách hàng sử dụng website
- Luôn lịch sự, nhiệt tình và hữu ích

THÔNG TIN KHÁCH SẠN:
- Tên: Rayal Park Hotel
- Địa chỉ: 123 Đường ABC, Quận 1, TP.HCM, Việt Nam~
- Hotline: 0901 234 567
- Email: info@rayalpark.com
- Facebook: facebook.com/rayalparkhotel

GIÁ PHÒNG (CHỈ KHI ĐƯỢC HỎI):
- Phòng Đơn: 1.500.000 - 2.000.000 VNĐ/đêm
- Phòng Đôi: 2.500.000 - 3.500.000 VNĐ/đêm
- Phòng VIP: 4.000.000 - 5.000.000 VNĐ/đêm
- Suite: 6.000.000+ VNĐ/đêm

DỊCH VỤ (CHỈ KHI ĐƯỢC HỎI):
- WiFi miễn phí tốc độ cao
- Dịch vụ phòng 24/7
- Nhà hàng đẳng cấp
- Spa & Wellness
- Hội nghị & Sự kiện
- Đưa đón sân bay
- Bể bơi ngoài trời
- Gym & Fitness

CHÍNH SÁCH HỦY PHÒNG (CHỈ KHI ĐƯỢC HỎI):
- Hủy trước 48 giờ: Miễn phí
- Hủy trong vòng 24-48 giờ: Phí 30% giá phòng
- Hủy trong vòng 24 giờ: Phí 50% giá phòng
- Không hủy (No-show): Phí 100% giá phòng

QUY TẮC TRẢ LỜI (QUAN TRỌNG):
- TRẢ LỜI NGẮN GỌN, ĐÚNG TRỌNG TÂM - KHÔNG DÀI DÒNG
- Trả lời trực tiếp câu hỏi, không giải thích dài dòng
- Khi có thông tin phòng tìm được → ƯU TIÊN hiển thị phòng ngay, không giới thiệu dài
- Chỉ nói những gì cần thiết, bỏ qua thông tin không liên quan
- KHÔNG lặp lại thông tin đã có trong danh sách phòng
- Giữ thái độ thân thiện, chuyên nghiệp
- Nếu không biết câu trả lời, hướng dẫn khách liên hệ hotline
- Sử dụng emoji một cách hợp lý để tạo cảm giác thân thiện

Hãy trả lời câu hỏi của khách hàng một cách NGẮN GỌN, ĐÚNG TRỌNG TÂM bằng ĐÚNG NGÔN NGỮ mà họ sử dụng.`;

// Mock AI response function (fallback khi không có Gemini API)
const getMockAIResponse = (userMessage) => {
  
  const lowerMessage = userMessage.toLowerCase();
  
  // Knowledge base về khách sạn - TRẢ LỜI NGẮN GỌN
  if (lowerMessage.includes("giá") || lowerMessage.includes("price") || lowerMessage.includes("cost")) {
    return "Giá phòng tại Rayal Park Hotel:\n\n" +
           "• Phòng Đơn: 1.500.000 - 2.000.000 VNĐ/đêm\n" +
           "• Phòng Đôi: 2.500.000 - 3.500.000 VNĐ/đêm\n" +
           "• Phòng VIP: 4.000.000 - 5.000.000 VNĐ/đêm\n\n" +
           "Bạn muốn tôi tìm phòng trống không?";
  }
  
  if (lowerMessage.includes("phòng trống") || lowerMessage.includes("available") || lowerMessage.includes("trống")) {
    return "Tôi sẽ tìm phòng trống cho bạn. Bạn vui lòng cho tôi biết:\n" +
           "• Ngày nhận phòng\n" +
           "• Ngày trả phòng\n" +
           "• Số lượng khách";
  }
  
  if (lowerMessage.includes("hủy") || lowerMessage.includes("cancel") || lowerMessage.includes("chính sách")) {
    return "Chính sách hủy phòng:\n\n" +
           "• Hủy trước 48 giờ: Miễn phí\n" +
           "• Hủy 24-48 giờ: Phí 30%\n" +
           "• Hủy trong 24 giờ: Phí 50%\n" +
           "• No-show: Phí 100%";
  }
  
  if (lowerMessage.includes("dịch vụ") || lowerMessage.includes("service") || lowerMessage.includes("tiện ích")) {
    return "Khách sạn có các dịch vụ: WiFi miễn phí, dịch vụ phòng 24/7, nhà hàng, spa, bể bơi, gym.\n\n" +
           "Bạn muốn biết chi tiết dịch vụ nào?";
  }
  
  if (lowerMessage.includes("đặt phòng") || lowerMessage.includes("booking") || lowerMessage.includes("reserve")) {
    return "Để đặt phòng, bạn có thể:\n" +
           "1. Truy cập trang 'Đặt Phòng' trên website\n" +
           "2. Hoặc gọi hotline: 0901 234 567";
  }
  
  if (lowerMessage.includes("chào") || lowerMessage.includes("hello") || lowerMessage.includes("xin chào") || lowerMessage.includes("hi")) {
    return "Xin chào! Tôi có thể giúp bạn:\n" +
           "• Tư vấn giá phòng\n" +
           "• Tìm phòng trống\n" +
           "• Hướng dẫn đặt phòng\n\n" +
           "Bạn cần hỗ trợ gì? 😊";
  }
  
  // Default response - NGẮN GỌN
  return "Tôi có thể giúp bạn về giá phòng, đặt phòng, dịch vụ khách sạn.\n\n" +
         "Nếu câu hỏi phức tạp, vui lòng liên hệ:\n" +
         "📞 Hotline: 0901 234 567";
};

// ========== CONTENT FILTERING ==========
// List từ khóa nhạy cảm (có thể mở rộng)
const SENSITIVE_KEYWORDS = [
  // Explicit content
  'sex', 'porn', 'xxx', 'nude', 'naked', 'adult', 'erotic',
  // Violence
  'kill', 'murder', 'violence', 'weapon', 'bomb', 'terrorist', 'assassinate',
  // Hate speech
  'racist', 'discrimination', 'hate', 'nazi',
  // Illegal activities
  'drug', 'cocaine', 'heroin', 'marijuana', 'cannabis',
  // Vietnamese sensitive words
  'phim người lớn', 'khiêu dâm', 'bạo lực', 'ma túy',
  'tự tử', 'giết người', 'sát hại', ' đụ má mày', 'vcl', 'cc', 'cl', 'đmm', 'như con cặc',
  
];

// Function kiểm tra nội dung nhạy cảm
const containsSensitiveContent = (text) => {
  const lowerText = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some(keyword => 
    lowerText.includes(keyword.toLowerCase())
  );
};

// Function để sanitize input
const sanitizeInput = (userMessage) => {
  // Kiểm tra nội dung nhạy cảm
  if (containsSensitiveContent(userMessage)) {
    return {
      isSensitive: true,
      message: null
    };
  }
  
  return {
    isSensitive: false,
    message: userMessage
  };
};

// Function để parse ngày từ text (hôm nay, ngày mai, 15/12, etc.)
const parseDateFromText = (text) => {
  const lowerText = text.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Hôm nay
  if (lowerText.includes("hôm nay") || lowerText.includes("today")) {
    return new Date(today);
  }
  
  // Ngày mai
  if (lowerText.includes("ngày mai") || lowerText.includes("tomorrow")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }
  
  // Ngày kia
  if (lowerText.includes("ngày kia") || lowerText.includes("day after tomorrow")) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter;
  }
  
  // Parse định dạng dd/mm hoặc dd/mm/yyyy
  const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1; // Month is 0-indexed
    const year = dateMatch[3] ? parseInt(dateMatch[3]) : today.getFullYear();
    const parsedDate = new Date(year, month, day);
    parsedDate.setHours(0, 0, 0, 0);
    
    // Nếu ngày trong quá khứ (cùng năm), giả sử là năm sau
    if (parsedDate < today && !dateMatch[3]) {
      parsedDate.setFullYear(year + 1);
    }
    
    return parsedDate;
  }
  
  return null;
};

// Function để parse yêu cầu tìm phòng từ câu hỏi
const parseRoomSearchRequest = (userMessage) => {
  const lowerMessage = userMessage.toLowerCase();
  const criteria = {
    maxOccupancy: null,
    view: null,
    roomType: null,
    priceRange: null,
    checkInDate: null,
    checkOutDate: null
  };

  // Tìm số người (4 người, cho 4 người, 4 người, v.v.)
  const occupancyMatch = lowerMessage.match(/(\d+)\s*người|cho\s*(\d+)|(\d+)\s*người/);
  if (occupancyMatch) {
    criteria.maxOccupancy = parseInt(occupancyMatch[1] || occupancyMatch[2] || occupancyMatch[3]);
  }

  // Tìm view (biển, view biển, nhìn biển, v.v.)
  if (lowerMessage.includes("biển") || lowerMessage.includes("ocean") || lowerMessage.includes("sea")) {
    criteria.view = "biển";
  } else if (lowerMessage.includes("núi") || lowerMessage.includes("mountain")) {
    criteria.view = "núi";
  } else if (lowerMessage.includes("thành phố") || lowerMessage.includes("city")) {
    criteria.view = "thành phố";
  }

  // Tìm loại phòng
  if (lowerMessage.includes("vip") || lowerMessage.includes("suite")) {
    criteria.roomType = lowerMessage.includes("suite") ? "suite" : "VIP";
  } else if (lowerMessage.includes("đơn")) {
    criteria.roomType = "đơn";
  } else if (lowerMessage.includes("đôi")) {
    criteria.roomType = "đôi";
  }

  // ✅ Parse ngày check-in/out từ text
  const datePatterns = [
    /(?:từ|from|check-in|nhận phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow).*?(?:đến|to|check-out|trả phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow)/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)\s*(?:đến|-|to)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)/i
  ];
  
  for (const pattern of datePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      criteria.checkInDate = parseDateFromText(match[1]);
      criteria.checkOutDate = parseDateFromText(match[2]);
      if (criteria.checkInDate && criteria.checkOutDate && criteria.checkInDate >= criteria.checkOutDate) {
        // Nếu check-out <= check-in, thêm 1 ngày cho check-out
        criteria.checkOutDate = new Date(criteria.checkInDate);
        criteria.checkOutDate.setDate(criteria.checkOutDate.getDate() + 1);
      }
      break;
    }
  }
  
  // Nếu chỉ có 1 ngày, giả sử là check-in, check-out = check-in + 1 ngày
  if (!criteria.checkInDate && !criteria.checkOutDate) {
    const singleDate = parseDateFromText(userMessage);
    if (singleDate) {
      criteria.checkInDate = singleDate;
      criteria.checkOutDate = new Date(singleDate);
      criteria.checkOutDate.setDate(criteria.checkOutDate.getDate() + 1);
    }
  }

  return criteria;
};

// Function để check phòng trống theo ngày cụ thể
const checkRoomAvailability = async (roomId, checkInDate, checkOutDate) => {
  try {
    if (!checkInDate || !checkOutDate) {
      return true; // Nếu không có dates, coi như available
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    checkIn.setHours(0, 0, 0, 0);
    checkOut.setHours(0, 0, 0, 0);

    // Kiểm tra booking overlap
    const overlappingBooking = await Booking.findOne({
      room: roomId,
      status: { $in: ['pending', 'confirmed'] }, // Chỉ check pending và confirmed
      $or: [
        {
          checkInDate: { $lt: checkOut },
          checkOutDate: { $gt: checkIn },
        },
      ],
    });

    return !overlappingBooking; // Trả về true nếu không có booking overlap
  } catch (error) {
    console.error("Error checking room availability:", error);
    return false; // Nếu có lỗi, coi như không available
  }
};

// Function để tìm phòng theo tiêu chí (với check availability theo dates)
const searchRooms = async (criteria) => {
  try {
    let filter = {
      available: true,
      isAvailable: { $gt: 0 }
    };

    // Filter theo số người
    if (criteria.maxOccupancy) {
      // ✅ Ưu tiên phòng có maxOccupancy chính xác hoặc gần với yêu cầu
      // Giới hạn trong khoảng hợp lý: maxOccupancy >= yêu cầu và <= yêu cầu + 2
      // Ví dụ: nếu yêu cầu 4 người, chỉ lấy phòng 4-6 người, không lấy phòng 8 người trở lên
      const maxOccupancyLimit = criteria.maxOccupancy + 2;
      filter.maxOccupancy = { 
        $gte: criteria.maxOccupancy,
        $lte: maxOccupancyLimit
      };
    }

    // Filter theo view
    if (criteria.view) {
      filter.view = { $regex: criteria.view, $options: "i" };
    }

    // Filter theo loại phòng
    if (criteria.roomType) {
      filter.roomType = criteria.roomType;
    }

    // Lấy tất cả phòng phù hợp, KHÔNG giới hạn số lượng
    let rooms = await Room.find(filter)
      .populate("location", "address province city")
      .lean();
    
    // ✅ Ưu tiên phòng có maxOccupancy chính xác với yêu cầu
    if (criteria.maxOccupancy) {
      // Tách phòng thành 2 nhóm: phòng có maxOccupancy = yêu cầu và phòng có maxOccupancy > yêu cầu
      const exactMatchRooms = rooms.filter(r => r.maxOccupancy === criteria.maxOccupancy);
      const largerRooms = rooms.filter(r => r.maxOccupancy > criteria.maxOccupancy);
      
      // Sắp xếp phòng lớn hơn theo maxOccupancy tăng dần (phòng gần với yêu cầu nhất trước)
      largerRooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
      
      // Ưu tiên phòng chính xác, sau đó mới đến phòng lớn hơn (đã sắp xếp)
      rooms = [...exactMatchRooms, ...largerRooms];
    } else {
      // Nếu không có yêu cầu về số người, sắp xếp theo maxOccupancy tăng dần
      rooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
    }

    // ✅ Nếu có dates, check availability cho từng phòng
    if (criteria.checkInDate && criteria.checkOutDate) {
      const availableRooms = [];
      
      for (const room of rooms) {
        const isAvailable = await checkRoomAvailability(
          room._id,
          criteria.checkInDate,
          criteria.checkOutDate
        );
        
        if (isAvailable) {
          availableRooms.push(room);
        }
      }
      
      // ✅ Giữ nguyên thứ tự ưu tiên (phòng chính xác trước, phòng lớn hơn sau)
      // KHÔNG giới hạn số lượng, trả về TẤT CẢ phòng available
      rooms = availableRooms;
    }
    // Nếu không có dates, giữ nguyên danh sách đã sắp xếp (KHÔNG giới hạn)
    
    // ✅ Log để debug
    if (criteria.maxOccupancy) {
      const exactCount = rooms.filter(r => r.maxOccupancy === criteria.maxOccupancy).length;
      const largerCount = rooms.filter(r => r.maxOccupancy > criteria.maxOccupancy).length;
      console.log(`🔍 Searching rooms for ${criteria.maxOccupancy} people. Found ${rooms.length} rooms:`);
      console.log(`   - Phòng chính xác ${criteria.maxOccupancy} người: ${exactCount} phòng`);
      console.log(`   - Phòng lớn hơn: ${largerCount} phòng`);
      console.log(`   Rooms: ${rooms.map(r => `${r.name} (${r.maxOccupancy} người)`).join(', ')}`);
    }

    return rooms;
  } catch (error) {
    console.error("Error searching rooms:", error);
    return [];
  }
};

// Function để parse booking intent từ user message
const parseBookingIntent = (userMessage, context = {}) => {
  const lowerMessage = userMessage.toLowerCase();
  const intent = {
    action: null, // 'select_room', 'confirm_booking', 'provide_dates', 'provide_personal_info'
    roomId: null,
    roomNumber: null,
    roomQuantity: 1,
    checkInDate: null,
    checkOutDate: null,
    nights: null,
    maxOccupancy: null, // ✅ Thêm để parse số người
    // ✅ Thêm để parse thông tin cá nhân
    fullName: null,
    email: null,
    phone: null,
    // ✅ Thêm để parse thông tin người lớn và trẻ em
    adults: null,
    children: null, // Array: [{age: 5}, {age: 8}, {age: 13}]
    // ✅ Thêm để parse xác nhận đặt phòng
    confirmBooking: false
  };
  
  // ✅ Kiểm tra xem có xác nhận đặt phòng hoặc chốt phòng không
  // "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này" = muốn xác nhận phòng đã chọn
  const isConfirmingSelectedRoom = lowerMessage.includes("chốt phòng") || 
    lowerMessage.includes("đặt phòng đó") || 
    lowerMessage.includes("đặt phòng này") ||
    (lowerMessage.includes("phòng đó") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt"))) ||
    (lowerMessage.includes("phòng này") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt")));
  
  if (isConfirmingSelectedRoom) {
    // Nếu đã có selectedRoom, đây là yêu cầu xác nhận và hiển thị chi tiết phòng đã chọn
    if (context.selectedRoom || context.bookingContext?.roomId) {
      intent.action = 'confirm_room_selection'; // Action mới để phân biệt với confirm_booking
      intent.confirmBooking = false; // Chưa phải confirm booking, chỉ confirm room selection
    }
  } else if (lowerMessage.includes("có") || lowerMessage.includes("đồng ý") || lowerMessage.includes("ok") || 
      lowerMessage.includes("đặt luôn") || 
      lowerMessage.includes("yes") || lowerMessage.includes("okay") ||
      lowerMessage.includes("xác nhận") || lowerMessage.includes("confirm")) {
    // Chỉ coi là confirm booking nếu đã có selectedRoom hoặc bookingContext.roomId
    if (context.selectedRoom || context.bookingContext?.roomId) {
      intent.action = 'confirm_booking';
      intent.confirmBooking = true;
    }
  }
  
  // ✅ Parse thông tin cá nhân (tên, email, số điện thoại)
  // Parse email
  const emailMatch = userMessage.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
  if (emailMatch) {
    intent.email = emailMatch[1];
  }
  
  // Parse số điện thoại (format VN: 0xxx xxx xxx hoặc +84xxx xxx xxx)
  const phoneMatch = userMessage.match(/(?:0|\+84)[0-9]{9,10}/);
  if (phoneMatch) {
    intent.phone = phoneMatch[0].replace(/^\+84/, '0');
  }
  
  // Parse tên (nếu có pattern "tên tôi là", "tôi là", "họ tên", etc.)
  const namePatterns = [
    /(?:tên|họ tên|tên tôi là|tôi là|name is|my name is)[\s:]+([A-Za-zÀ-ỹ\s]+)/i,
    /^([A-Za-zÀ-ỹ\s]{3,30})$/ // Chỉ tên, không có từ khóa khác
  ];
  for (const pattern of namePatterns) {
    const nameMatch = userMessage.match(pattern);
    if (nameMatch && !lowerMessage.includes("phòng") && !lowerMessage.includes("room")) {
      intent.fullName = nameMatch[1].trim();
      break;
    }
  }

  // ✅ Kiểm tra xem có chọn phòng không (ƯU TIÊN: phân biệt "phòng thứ X" vs "phòng X người")
  // Nếu có "người" sau số → không phải chọn phòng, mà là tìm phòng cho X người
  const hasNgười = lowerMessage.includes("người") || lowerMessage.includes("people");
  
  // ✅ QUAN TRỌNG: Nếu có lastRoomSearchResults, ưu tiên parse chọn phòng từ list
  const hasRoomList = context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0;
  let forcedRoomSelection = false;
  
  // ✅ NEW: Cho phép user chọn phòng bằng cách nhập "2.", "2)" hoặc "2 - ..." ngay cả khi có chữ "người"
  if (hasRoomList) {
    const listOptionMatch = userMessage.trim().match(/^(\d+)\s*[\.\)\-:]/);
    if (listOptionMatch) {
      const listRoomNum = parseInt(listOptionMatch[1]);
      if (!isNaN(listRoomNum) && listRoomNum >= 1 && listRoomNum <= context.lastRoomSearchResults.length) {
        intent.action = 'select_room';
        intent.roomNumber = listRoomNum;
        forcedRoomSelection = true;
        console.log(`✅ Detected list option selection via prefix pattern: room #${listRoomNum}`);
      }
    }
  }
  
  // Chỉ parse chọn phòng nếu KHÔNG có "người" sau số
  if (!hasNgười || forcedRoomSelection) {
    // Ưu tiên các pattern rõ ràng về chọn phòng từ list
    const roomSelectPatterns = [
      /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(?:số|thứ|number)\s*(\d+)/i, // "chọn phòng số 2", "đặt phòng thứ 3", "vậy tôi chọn đặc phòng số 1"
      /phòng\s*(?:số|thứ|number)\s*(\d+)/i, // "phòng số 2", "phòng thứ 3", "phòng thứ 4"
      /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(\d+)(?!\s*người)/i, // "chọn phòng 2" (không có "người" sau)
      /phòng\s*(\d+)(?!\s*người)/i, // "phòng 2" (không có "người" sau) - chỉ khi có context.lastRoomSearchResults
      /số\s*(\d+)/i, // "số 2"
      /^(\d+)$/ // Chỉ có số (chỉ khi có context.lastRoomSearchResults)
    ];
    
    for (const pattern of roomSelectPatterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        const roomNum = parseInt(match[1]);
        // ✅ Nếu có list phòng, ưu tiên coi đây là chọn phòng từ list
        if (hasRoomList && roomNum >= 1 && roomNum <= context.lastRoomSearchResults.length) {
          intent.action = 'select_room';
          intent.roomNumber = roomNum;
          break;
        }
        // Chỉ coi là chọn phòng nếu:
        // 1. Số hợp lý (1-20) VÀ
        // 2. Có từ khóa "chọn/đặt/phòng thứ/phòng số"
        const hasSelectKeyword = /(?:chọn|đặt|muốn|book|select|số|thứ)/i.test(lowerMessage);
        if (roomNum >= 1 && roomNum <= 20 && hasSelectKeyword) {
          intent.action = 'select_room';
          intent.roomNumber = roomNum;
          break;
        }
      }
    }
  }

  // Kiểm tra xem có số phòng không (2 phòng, 3 phòng, etc.)
  const quantityMatch = lowerMessage.match(/(\d+)\s*(?:phòng|room)/);
  if (quantityMatch) {
    intent.roomQuantity = parseInt(quantityMatch[1]);
  }
  
  // ✅ Parse số người từ user message (4 người, cho 4 người, etc.)
  const occupancyMatch = lowerMessage.match(/(?:cho\s*)?(\d+)\s*(?:người|khách)/);
  if (occupancyMatch) {
    intent.maxOccupancy = parseInt(occupancyMatch[1]);
  }
  
  // ✅ Parse thông tin người lớn và trẻ em
  // Pattern: "2 người lớn và 1 trẻ em 5 tuổi", "2 adults and 1 child age 8", "2 người lớn 1 trẻ em 9 tuổi"
  const adultsMatch = lowerMessage.match(/(\d+)\s*(?:người lớn|adults?|người)/i);
  if (adultsMatch) {
    intent.adults = parseInt(adultsMatch[1]);
  }
  
  // ✅ Parse trẻ em với tuổi: "1 trẻ em 5 tuổi", "2 trẻ em 8 và 10 tuổi", "1 child age 8", "1 trẻ em 9 tuổi"
  // Pattern tổng quát: "X người lớn Y trẻ em Z tuổi" (không cần "và" hoặc "với")
  const childrenPatterns = [
    // Pattern 1: "với/có/và X trẻ em Y tuổi" hoặc "X trẻ em Y tuổi"
    /(?:có|với|and|và)\s*(\d+)\s*(?:trẻ em|children?|bé)\s*(?:(\d+)\s*tuổi|age\s*(\d+))/gi,
    // Pattern 2: "X trẻ em Y tuổi" (không có từ nối)
    /(\d+)\s*(?:trẻ em|children?|bé)\s*(?:(\d+)\s*tuổi|age\s*(\d+))/gi,
    // Pattern 3: "trẻ em Y tuổi" (không có số lượng, mặc định 1)
    /trẻ em\s*(\d+)\s*tuổi/gi,
    // Pattern 4: "X người lớn Y trẻ em Z tuổi" (pattern liền nhau, không có từ nối)
    /(\d+)\s*(?:người lớn|adults?)\s+(\d+)\s*(?:trẻ em|children?|bé)\s+(\d+)\s*tuổi/gi
  ];
  
  const children = [];
  for (let i = 0; i < childrenPatterns.length; i++) {
    const pattern = childrenPatterns[i];
    let match;
    // Reset lastIndex để tránh vấn đề với global regex
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(userMessage)) !== null) {
      let count, age;
      
      if (i === 3) {
        // Pattern 4: "X người lớn Y trẻ em Z tuổi"
        count = parseInt(match[2]); // Số trẻ em
        age = parseInt(match[3]); // Tuổi
      } else if (i === 2) {
        // Pattern 3: "trẻ em Y tuổi" (không có số lượng)
        count = 1;
        age = parseInt(match[1]);
      } else {
        // Pattern 1 và 2
        count = parseInt(match[1] || 1);
        age = parseInt(match[2] || match[3] || match[4]);
      }
      
      if (age && age > 0 && age < 18) {
        for (let j = 0; j < count; j++) {
          children.push({ age });
        }
        // Chỉ lấy match đầu tiên từ pattern 4 để tránh duplicate
        if (i === 3) break;
      }
    }
  }
  
  // ✅ Parse nhiều trẻ em với tuổi khác nhau - LINH HOẠT HƠN
  // Pattern: "2 trẻ em 5 và 8 tuổi", "3 trẻ em 4, 7 và 12 tuổi", "2 trẻ em 6 và 9 tuổi"
  
  // Pattern 1: "X trẻ em Y và Z tuổi" (2 trẻ em với 2 tuổi)
  const twoChildrenMatch = lowerMessage.match(/(\d+)\s*(?:trẻ em|children?|bé).*?(\d+)\s+và\s+(\d+)\s*tuổi/i);
  if (twoChildrenMatch && !children.length) {
    const count = parseInt(twoChildrenMatch[1]);
    const age1 = parseInt(twoChildrenMatch[2]);
    const age2 = parseInt(twoChildrenMatch[3]);
    if (age1 && age2 && count >= 2) {
      // Nếu có 2 trẻ em, mỗi trẻ một tuổi
      if (count === 2) {
        children.push({ age: age1 }, { age: age2 });
      } else {
        // Nếu có nhiều hơn 2 trẻ em, phân bổ đều
        const half = Math.floor(count / 2);
        for (let i = 0; i < half; i++) {
          children.push({ age: age1 });
        }
        for (let i = 0; i < count - half; i++) {
          children.push({ age: age2 });
        }
      }
    }
  }
  
  // Pattern 2: "X trẻ em Y, Z và W tuổi" (3+ trẻ em với nhiều tuổi)
  const multipleAgesMatch = userMessage.match(/(\d+)\s*(?:trẻ em|children?|bé).*?(\d+(?:\s*,\s*\d+)*)\s+và\s+(\d+)\s*tuổi/i);
  if (multipleAgesMatch && !children.length) {
    const count = parseInt(multipleAgesMatch[1]);
    const agesStr = multipleAgesMatch[2] + ', ' + multipleAgesMatch[3]; // "4, 7, 12"
    const ages = agesStr.split(',').map(a => parseInt(a.trim())).filter(a => a > 0 && a < 18);
    
    if (ages.length > 0 && count >= ages.length) {
      // Phân bổ tuổi cho từng trẻ em
      for (let i = 0; i < count; i++) {
        const ageIndex = i % ages.length; // Lặp lại tuổi nếu cần
        children.push({ age: ages[ageIndex] });
      }
    }
  }
  
  // Pattern 3: "X trẻ em Y, Z, W tuổi" (3+ trẻ em, không có "và" cuối)
  const multipleAgesNoAndMatch = userMessage.match(/(\d+)\s*(?:trẻ em|children?|bé).*?(\d+(?:\s*,\s*\d+)+)\s*tuổi/i);
  if (multipleAgesNoAndMatch && !children.length) {
    const count = parseInt(multipleAgesNoAndMatch[1]);
    const agesStr = multipleAgesNoAndMatch[2]; // "4, 7, 12"
    const ages = agesStr.split(',').map(a => parseInt(a.trim())).filter(a => a > 0 && a < 18);
    
    if (ages.length > 0 && count >= ages.length) {
      // Phân bổ tuổi cho từng trẻ em
      for (let i = 0; i < count; i++) {
        const ageIndex = i % ages.length; // Lặp lại tuổi nếu cần
        children.push({ age: ages[ageIndex] });
      }
    }
  }
  
  // Pattern 4: "X người lớn Y trẻ em Z và W tuổi" (pattern liền nhau)
  const adultsChildrenAgesMatch = userMessage.match(/(\d+)\s*(?:người lớn|adults?)\s+(\d+)\s*(?:trẻ em|children?|bé)\s+(\d+)\s+và\s+(\d+)\s*tuổi/i);
  if (adultsChildrenAgesMatch && !children.length) {
    const adultsCount = parseInt(adultsChildrenAgesMatch[1]);
    const childrenCount = parseInt(adultsChildrenAgesMatch[2]);
    const age1 = parseInt(adultsChildrenAgesMatch[3]);
    const age2 = parseInt(adultsChildrenAgesMatch[4]);
    
    if (adultsCount && childrenCount >= 2 && age1 && age2) {
      intent.adults = adultsCount;
      if (childrenCount === 2) {
        children.push({ age: age1 }, { age: age2 });
      } else {
        // Phân bổ đều cho nhiều trẻ em
        const half = Math.floor(childrenCount / 2);
        for (let i = 0; i < half; i++) {
          children.push({ age: age1 });
        }
        for (let i = 0; i < childrenCount - half; i++) {
          children.push({ age: age2 });
        }
      }
    }
  }
  
  if (children.length > 0) {
    intent.children = children;
    // Nếu có trẻ em, tính lại maxOccupancy = adults + children.length
    if (intent.adults) {
      intent.maxOccupancy = intent.adults + children.length;
    } else {
      // Nếu không có adults được parse, mặc định 1 người lớn
      intent.adults = 1;
      intent.maxOccupancy = 1 + children.length;
    }
  }

  // ✅ Kiểm tra xem có ngày check-in/out không (sử dụng parseDateFromText)
  const datePatterns = [
    /(?:từ|from|check-in|nhận phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow).*?(?:đến|to|check-out|trả phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow)/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)\s*(?:đến|-|to)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)/i
  ];
  
  for (const pattern of datePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      intent.checkInDate = parseDateFromText(match[1]);
      intent.checkOutDate = parseDateFromText(match[2]);
      if (intent.checkInDate && intent.checkOutDate) {
        if (intent.checkInDate >= intent.checkOutDate) {
          // Nếu check-out <= check-in, thêm 1 ngày cho check-out
          intent.checkOutDate = new Date(intent.checkInDate);
          intent.checkOutDate.setDate(intent.checkOutDate.getDate() + 1);
        }
        intent.nights = Math.ceil((intent.checkOutDate - intent.checkInDate) / (1000 * 60 * 60 * 24));
      }
      break;
    }
  }
  
  // Nếu chỉ có 1 ngày, giả sử là check-in
  if (!intent.checkInDate && !intent.checkOutDate) {
    const singleDate = parseDateFromText(userMessage);
    if (singleDate) {
      intent.checkInDate = singleDate;
      intent.checkOutDate = new Date(singleDate);
      intent.checkOutDate.setDate(intent.checkOutDate.getDate() + 1);
      intent.nights = 1;
    }
  }

  // Kiểm tra từ context (nếu đã có trong session)
  if (context.bookingContext) {
    if (context.bookingContext.roomId) intent.roomId = context.bookingContext.roomId;
    if (context.bookingContext.checkInDate) intent.checkInDate = new Date(context.bookingContext.checkInDate);
    if (context.bookingContext.checkOutDate) intent.checkOutDate = new Date(context.bookingContext.checkOutDate);
    if (context.bookingContext.roomQuantity) intent.roomQuantity = context.bookingContext.roomQuantity;
  }
  
  // ✅ Nếu đã có selectedRoom trong context, không cần parse lại
  if (context.selectedRoom && !intent.roomId) {
    intent.roomId = context.selectedRoom._id;
  }

  return intent;
};

// Function để tạo booking link với query params
const createBookingLink = (bookingData) => {
  const params = new URLSearchParams();
  
  if (bookingData.roomId) params.append('roomId', bookingData.roomId);
  if (bookingData.checkInDate) {
    const checkIn = bookingData.checkInDate instanceof Date 
      ? bookingData.checkInDate.toISOString().split('T')[0]
      : bookingData.checkInDate;
    params.append('checkIn', checkIn);
  }
  if (bookingData.checkOutDate) {
    const checkOut = bookingData.checkOutDate instanceof Date
      ? bookingData.checkOutDate.toISOString().split('T')[0]
      : bookingData.checkOutDate;
    params.append('checkOut', checkOut);
  }
  if (bookingData.roomQuantity && bookingData.roomQuantity > 1) {
    params.append('roomQuantity', bookingData.roomQuantity);
  }
  if (bookingData.guests) {
    params.append('guests', bookingData.guests);
  }
  if (bookingData.fullName) {
    params.append('fullName', bookingData.fullName);
  }
  if (bookingData.email) {
    params.append('email', bookingData.email);
  }
  if (bookingData.phone) {
    params.append('phone', bookingData.phone);
  }
  if (bookingData.note) {
    params.append('note', bookingData.note);
  }

  // Lấy base URL từ env hoặc dùng default
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${baseUrl}/booking?${params.toString()}`;
};

// ✅ Helper function để generate context data cho phòng đã chọn (đơn giản hóa - chỉ cung cấp data, không hướng dẫn cách trả lời)
const generateSelectedRoomPrompt = (selectedRoomInfo, bookingContext, language) => {
  const hasDates = bookingContext?.checkInDate && bookingContext?.checkOutDate;
  const hasGuests = bookingContext?.guests || bookingContext?.maxOccupancy;
  const roomQuantity = bookingContext?.roomQuantity || 1;
  
  const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG ĐÃ CHỌN' : 'SELECTED ROOM INFORMATION';
  
  // Chỉ cung cấp thông tin context, không hướng dẫn cách trả lời (đã có trong knowledge base)
  let roomInfo = `Khách hàng đã chọn phòng từ danh sách:\n` +
    `- Tên phòng: ${selectedRoomInfo.name}\n` +
    `- Giá: ${selectedRoomInfo.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm\n` +
    `- Loại: ${selectedRoomInfo.roomType}\n` +
    `- Sức chứa: ${selectedRoomInfo.maxOccupancy} người\n` +
    `- View: ${selectedRoomInfo.view}\n` +
    `- Số phòng: ${roomQuantity}\n`;
  
  if (hasDates) {
    const checkIn = new Date(bookingContext.checkInDate);
    const checkOut = new Date(bookingContext.checkOutDate);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    // ✅ Tính tổng giá với phụ thu trẻ em (nếu có)
    const adults = bookingContext.adults || bookingContext.guests || 1;
    const children = bookingContext.children || [];
    
    const priceCalculation = calculateTotalPriceWithChildSurcharge(
      selectedRoomInfo.pricePerNight,
      nights,
      roomQuantity,
      adults,
      children
    );
    
    const totalPrice = priceCalculation.totalPrice;
    
    roomInfo += `- Check-in: ${checkIn.toLocaleDateString('vi-VN')}\n` +
      `- Check-out: ${checkOut.toLocaleDateString('vi-VN')}\n` +
      `- Số đêm: ${nights} đêm\n`;
    
    // Hiển thị chi tiết phụ thu trẻ em nếu có
    if (priceCalculation.childSurcharge > 0 && children.length > 0) {
      roomInfo += `- Giá cơ bản: ${priceCalculation.baseTotal.toLocaleString('vi-VN')} VNĐ\n`;
      
      // Tính phụ thu cho từng trẻ em để hiển thị chi tiết
      const pricePerAdultPerNight = selectedRoomInfo.pricePerNight / Math.max(adults, 1);
      const childSurchargeDetails = [];
      
      children.forEach((child, index) => {
        const childAge = child.age || child;
        let surchargePerChild = 0;
        let policy = '';
        
        if (childAge < 6) {
          surchargePerChild = 0;
          policy = 'miễn phí';
        } else if (childAge >= 6 && childAge < 12) {
          surchargePerChild = (pricePerAdultPerNight * 0.5) * nights * roomQuantity;
          policy = '50% giá người lớn';
        } else {
          surchargePerChild = pricePerAdultPerNight * nights * roomQuantity;
          policy = '100% giá người lớn';
        }
        
        if (surchargePerChild > 0) {
          childSurchargeDetails.push(`  • Trẻ ${index + 1} (${childAge} tuổi): ${surchargePerChild.toLocaleString('vi-VN')} VNĐ (${policy})`);
        } else {
          childSurchargeDetails.push(`  • Trẻ ${index + 1} (${childAge} tuổi): miễn phí`);
        }
      });
      
      if (childSurchargeDetails.length > 0) {
        roomInfo += `- Phụ thu trẻ em: ${priceCalculation.childSurcharge.toLocaleString('vi-VN')} VNĐ\n`;
        roomInfo += `  Chi tiết:\n${childSurchargeDetails.join('\n')}\n`;
      }
    } else if (children.length > 0) {
      // Có trẻ em nhưng không có phụ thu (tất cả đều dưới 6 tuổi)
      roomInfo += `- Trẻ em: miễn phí (tất cả đều dưới 6 tuổi)\n`;
    }
    
    roomInfo += `- Tổng tiền: ${totalPrice.toLocaleString('vi-VN')} VNĐ\n`;
  } else {
    roomInfo += `- Check-in/out: Chưa có\n`;
  }
  
  if (hasGuests) {
    roomInfo += `- Số người: ${hasGuests} người\n`;
  } else {
    roomInfo += `- Số người: Chưa có\n`;
  }
  
  roomInfo += `\nLưu ý: Tham khảo kịch bản trong chatbot-scenarios.md (section 1.1 và 1.8) để xử lý đúng cách.`;
  
  return {
    label: roomInfoLabel,
    content: roomInfo
  };
};

// ✅ AI Response function với Gemini API, Room Search VÀ RAG
const getAIResponse = async (userMessage, context = {}, conversationHistory = []) => {
  // ✅ KIỂM TRA NỘI DUNG NHẠY CẢM TRƯỚC KHI XỬ LÝ
  const sanitized = sanitizeInput(userMessage);
  
  if (sanitized.isSensitive) {
    return {
      text: "Xin lỗi, tôi không thể trả lời câu hỏi này. Tôi là trợ lý ảo của khách sạn và chỉ có thể hỗ trợ các câu hỏi liên quan đến dịch vụ khách sạn như: đặt phòng, giá phòng, dịch vụ, chính sách hủy phòng. Nếu bạn có câu hỏi khác, vui lòng liên hệ trực tiếp qua hotline: 0901 234 567.",
      rooms: null,
      hasRooms: false
    };
  }
  
  const lowerMessage = userMessage.toLowerCase();
  
  // ✅ QUAN TRỌNG: Nếu đã có selectedRoom, không tìm lại phòng từ database
  // Chỉ tìm phòng mới nếu user thực sự yêu cầu tìm phòng VÀ chưa có selectedRoom
  const hasSelectedRoom = context.selectedRoom && context.selectedRoom._id;
  const hasRoomList = context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0;
  
  // ✅ Kiểm tra xem user có yêu cầu tìm phòng MỚI không (ví dụ: "tìm phòng khác", "cho list mới", "tìm lại")
  const isRequestingNewSearch = lowerMessage.includes("tìm phòng khác") ||
    lowerMessage.includes("tìm lại") ||
    lowerMessage.includes("cho list mới") ||
    lowerMessage.includes("hiển thị danh sách") ||
    lowerMessage.includes("tìm kiếm") ||
    lowerMessage.includes("search") ||
    lowerMessage.includes("tìm phòng mới");
  
  // ✅ Kiểm tra xem user có nói "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này" không
  // Nếu có và đã có selectedRoom, KHÔNG được tìm phòng mới, chỉ hiển thị chi tiết phòng đã chọn
  const isConfirmingSelectedRoom = (lowerMessage.includes("chốt phòng") || 
    lowerMessage.includes("đặt phòng đó") || 
    lowerMessage.includes("đặt phòng này") ||
    (lowerMessage.includes("phòng đó") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt"))) ||
    (lowerMessage.includes("phòng này") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt")))) && hasSelectedRoom;
  
  // Kiểm tra xem có phải yêu cầu tìm phòng không (chỉ khi chưa có selectedRoom VÀ không phải là chọn phòng từ list VÀ không phải là chốt phòng đã chọn)
  // ✅ Nếu đã có list phòng và user không yêu cầu tìm mới, không coi là yêu cầu tìm phòng
  const isRoomSearchRequest = !hasSelectedRoom && !isRequestingNewSearch && !isConfirmingSelectedRoom && (
    (lowerMessage.includes("đặt phòng") && !hasRoomList) || // Chỉ coi là tìm phòng nếu chưa có list
    (lowerMessage.includes("tìm phòng") && !hasRoomList) ||
    lowerMessage.includes("phòng trống") ||
    lowerMessage.includes("phòng nào") ||
    lowerMessage.includes("có phòng") ||
    // ✅ THÊM: Nhận diện "đặt phòng X người", "muốn đặt phòng X người", "phòng X người"
    (lowerMessage.match(/(?:đặt|muốn|tìm|book).*?phòng.*?\d+\s*người/i)) ||
    (lowerMessage.match(/\d+\s*người.*?(?:đặt|muốn|tìm|book).*?phòng/i)) ||
    (lowerMessage.match(/phòng.*?\d+\s*người/i) && !hasRoomList) ||
    (lowerMessage.includes("cho") && (lowerMessage.includes("người") || lowerMessage.match(/\d+\s*người/)) && !hasRoomList) ||
    // ✅ THÊM: Nhận diện "tìm phòng X người lớn Y trẻ em", "cần phòng X người lớn Y trẻ em Z tuổi"
    (lowerMessage.match(/(?:tìm|cần|đặt|muốn).*?phòng.*?\d+\s*(?:người lớn|adults?).*?\d+\s*(?:trẻ em|children?)/i)) ||
    (lowerMessage.match(/\d+\s*(?:người lớn|adults?).*?\d+\s*(?:trẻ em|children?).*?\d+\s*tuổi/i)) ||
    ((lowerMessage.includes("view") || lowerMessage.includes("biển") || lowerMessage.includes("núi")) && !hasRoomList) ||
    (lowerMessage.match(/\d{1,2}\/\d{1,2}/) && !lowerMessage.includes("ngày nhận") && !lowerMessage.includes("ngày trả") && !lowerMessage.includes("check-in") && !lowerMessage.includes("check-out") && !hasRoomList) || // Có ngày nhưng không phải là cung cấp ngày cho booking đã chọn
    ((lowerMessage.includes("hôm nay") || lowerMessage.includes("ngày mai") || lowerMessage.includes("ngày kia")) && !hasRoomList)
  );

  let roomSearchResults = null;
  let searchCriteria = null;
  
  // ✅ QUAN TRỌNG: Tự động tìm phòng khi user cung cấp đủ thông tin (dates + guests)
  // Kiểm tra bookingContext từ context để tự động tìm phòng
  const bookingContext = context.bookingContext || {};
  const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
  const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
  const shouldAutoSearchRooms = hasDates && hasGuests && !hasSelectedRoom && !bookingContext.roomId;
  
  // ✅ Auto-search rooms nếu có đủ thông tin và chưa có selectedRoom
  if (shouldAutoSearchRooms && (!roomSearchResults || roomSearchResults.length === 0)) {
    try {
      console.log('✅ Auto-searching rooms with provided info:', {
        checkIn: bookingContext.checkInDate,
        checkOut: bookingContext.checkOutDate,
        guests: hasGuests
      });
      
      // Đảm bảo dates là Date objects
      const checkInDate = bookingContext.checkInDate instanceof Date 
        ? bookingContext.checkInDate 
        : new Date(bookingContext.checkInDate);
      const checkOutDate = bookingContext.checkOutDate instanceof Date 
        ? bookingContext.checkOutDate 
        : new Date(bookingContext.checkOutDate);
      
      // Validate dates
      if (!isNaN(checkInDate.getTime()) && !isNaN(checkOutDate.getTime())) {
        // Tự động tìm phòng với criteria từ bookingContext
        const autoSearchCriteria = {
          checkInDate: checkInDate,
          checkOutDate: checkOutDate,
          maxOccupancy: bookingContext.guests || bookingContext.maxOccupancy,
          isAvailable: true,
          status: 'active'
        };
        
        roomSearchResults = await searchRooms(autoSearchCriteria);
        console.log(`✅ Auto-found ${roomSearchResults ? roomSearchResults.length : 0} available rooms`);
        
        // Đánh dấu để AI biết đã tự động tìm phòng và nên hiển thị room cards
        if (roomSearchResults && roomSearchResults.length > 0) {
          context.autoSearchedRooms = true;
        }
      }
    } catch (autoSearchError) {
      console.error('❌ Error in auto-search rooms:', autoSearchError);
      // Không throw error, tiếp tục xử lý bình thường
    }
  }

  // ✅ Nếu đã có selectedRoom, vẫn parse dates từ message để cập nhật bookingContext
  if (hasSelectedRoom) {
    searchCriteria = parseRoomSearchRequest(userMessage);
    // ✅ Lưu dates vào context nếu có (ngay cả khi đã có selectedRoom)
    if (searchCriteria.checkInDate || searchCriteria.checkOutDate) {
      if (!context.bookingContext) context.bookingContext = {};
      if (searchCriteria.checkInDate) {
        context.bookingContext.checkInDate = searchCriteria.checkInDate;
      }
      if (searchCriteria.checkOutDate) {
        context.bookingContext.checkOutDate = searchCriteria.checkOutDate;
      }
      console.log(`📅 Updated dates for selected room: ${searchCriteria.checkInDate?.toISOString().split('T')[0]} to ${searchCriteria.checkOutDate?.toISOString().split('T')[0]}`);
    }
  }

  // ✅ QUAN TRỌNG: Nếu user nói "chốt phòng đó" và đã có selectedRoom, KHÔNG tìm phòng mới
  if (isConfirmingSelectedRoom) {
    console.log('✅ User confirming selected room, skipping room search');
    roomSearchResults = null; // Không tìm phòng mới
  }
  // Nếu là yêu cầu tìm phòng VÀ chưa có selectedRoom VÀ không phải là chốt phòng đã chọn, tìm phòng trước
  else if (isRoomSearchRequest && !hasSelectedRoom) {
    searchCriteria = parseRoomSearchRequest(userMessage);
    
    // ✅ Lưu dates vào context nếu có
    if (searchCriteria.checkInDate || searchCriteria.checkOutDate) {
      if (!context.bookingContext) context.bookingContext = {};
      if (searchCriteria.checkInDate) {
        context.bookingContext.checkInDate = searchCriteria.checkInDate;
      }
      if (searchCriteria.checkOutDate) {
        context.bookingContext.checkOutDate = searchCriteria.checkOutDate;
      }
    }
    
    // Tìm phòng với criteria (bao gồm dates để check availability)
    roomSearchResults = await searchRooms(searchCriteria);
    
    // Log để debug
    if (searchCriteria.checkInDate && searchCriteria.checkOutDate) {
      console.log(`🔍 Searching rooms from ${searchCriteria.checkInDate.toISOString().split('T')[0]} to ${searchCriteria.checkOutDate.toISOString().split('T')[0]}`);
      console.log(`✅ Found ${roomSearchResults.length} available rooms`);
    }
  }

  // Nếu có Gemini API và đã được khởi tạo thành công, sử dụng nó
  if (geminiAvailable && geminiModel) {
    try {
      // ✅ RAG: Retrieve relevant documents từ knowledge base
      let retrievedDocs = [];
      let ragAvailable = false;
      
      if (ragService) {
        try {
          await ragService.initialize();
          console.log(`🔍 RAG: Searching for: "${userMessage}"`);
          retrievedDocs = await ragService.retrieve(userMessage, 3);
          
          if (retrievedDocs && retrievedDocs.length > 0) {
            ragAvailable = true;
            console.log(`📚 RAG: Retrieved ${retrievedDocs.length} relevant documents`);
            console.log(`   Top result score: ${retrievedDocs[0].score.toFixed(3)}`);
            console.log(`   Top result source: ${retrievedDocs[0].metadata?.source || 'unknown'}`);
            console.log(`   Top result preview: ${retrievedDocs[0].text.substring(0, 100)}...`);
          } else {
            console.warn('⚠️  RAG: No documents retrieved (vector store might be empty)');
            console.warn('💡 Run: npm run ingest-kb to populate knowledge base');
          }
        } catch (ragError) {
          console.error('❌ RAG retrieval failed:', ragError.message);
          console.error('   Stack:', ragError.stack);
          // Continue without RAG if it fails
        }
      } else {
        console.warn('⚠️  RAG Service not available');
      }

      // Build prompt
      let prompt;
      // ✅ SỬA: Dùng language từ context (đã được update từ detectedLanguage)
      const language = context.language || 'vi';
      
      // ✅ THÊM: Log để debug
      console.log(`🔤 Current language context: ${language}`);
      console.log(`📝 User message: "${userMessage.substring(0, 100)}..."`);
      
      // ✅ Labels theo ngôn ngữ
      const userLabel = language === 'vi' ? 'Khách hàng' : 'Customer';
      const botLabel = language === 'vi' ? 'Bạn' : 'You';
      const historyLabel = language === 'vi' ? 'Lịch sử hội thoại' : 'Conversation history';
      
      // ✅ THÊM: Instruction rõ ràng về ngôn ngữ ở ĐẦU prompt
      const languageHeader = language === 'vi'
        ? "⚠️ QUAN TRỌNG: Bạn PHẢI trả lời bằng TIẾNG VIỆT trong toàn bộ câu trả lời này.\n\n"
        : "⚠️ IMPORTANT: You MUST respond in ENGLISH for this entire response.\n\n";
      
      if (ragAvailable && retrievedDocs.length > 0) {
        // ✅ Dùng RAG prompt với retrieved context
        prompt = languageHeader + SYSTEM_PROMPT + "\n\n";
        
        // Build RAG context
        const langLabel = language === 'vi' ? 'THÔNG TIN THAM KHẢO' : 'REFERENCE INFORMATION';
        const langNote = language === 'vi' 
          ? 'LƯU Ý: Sử dụng thông tin trên để trả lời câu hỏi. Nếu thông tin không có trong knowledge base, hãy nói rõ và hướng dẫn khách liên hệ hotline.'
          : 'NOTE: Use the information above to answer the question. If the information is not in the knowledge base, please clarify and guide the customer to contact the hotline.';

        prompt += `${langLabel} TỪ KNOWLEDGE BASE:\n`;
        prompt += "=".repeat(50) + "\n";

        retrievedDocs.forEach((doc, index) => {
          prompt += `\n[Document ${index + 1}]\n`;
          prompt += `${doc.text}\n`;
          if (doc.metadata?.source) {
            prompt += `${language === 'vi' ? 'Nguồn' : 'Source'}: ${doc.metadata.source}\n`;
          }
          prompt += "\n";
        });

        prompt += "=".repeat(50) + "\n\n";
        prompt += `${langNote}\n\n`;
        
        // ✅ Thêm thông tin phòng đã chọn nếu có (QUAN TRỌNG - phải đúng thông tin)
        if (context.selectedRoom) {
          const selectedRoomInfo = context.selectedRoom;
          const bookingContext = context.bookingContext || {};
          const roomPrompt = generateSelectedRoomPrompt(selectedRoomInfo, bookingContext, language);
          
          prompt += `\n\n${roomPrompt.label}:\n`;
          prompt += "=".repeat(50) + "\n";
          prompt += `${roomPrompt.content}\n`;
          prompt += "=".repeat(50) + "\n\n";
          
          // ✅ Nếu user nói "chốt phòng đó" hoặc "đặt phòng đó", PHẢI hiển thị chi tiết phòng, KHÔNG tìm phòng mới
          if (context.showRoomDetails || context.shouldNotSearchRooms) {
            const confirmRoomLabel = language === 'vi' ? 'CONTEXT: KHÁCH MUỐN CHỐT PHÒNG ĐÃ CHỌN' : 'CONTEXT: CUSTOMER WANTS TO CONFIRM SELECTED ROOM';
            const confirmRoomContext = language === 'vi'
              ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã nói "chốt phòng đó" hoặc "đặt phòng đó".\n` +
                `Bạn PHẢI hiển thị CHI TIẾT phòng đã chọn (tên, giá, loại, sức chứa, view, tiện nghi).\n` +
                `Bạn PHẢI gửi 2 link cho khách:\n` +
                `- Link xem chi tiết phòng: [Xem chi tiết phòng](link sẽ được thêm tự động)\n` +
                `- Link đặt phòng: [Đặt phòng ngay](link sẽ được thêm tự động)\n` +
                `Bạn KHÔNG được tìm phòng mới hoặc hiển thị danh sách phòng khác.\n` +
                `QUAN TRỌNG: KHÔNG hỏi thông tin cá nhân (họ tên, email, số điện thoại) trong chat. User sẽ click vào link để đặt phòng trên booking form.\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer said "confirm this room" or "book this room".\n` +
                `You MUST display DETAILED information of the selected room (name, price, type, capacity, view, amenities).\n` +
                `You MUST send 2 links to the customer:\n` +
                `- Room detail link: [View Room Details](link will be added automatically)\n` +
                `- Booking link: [Book Now](link will be added automatically)\n` +
                `You MUST NOT search for new rooms or display other room lists.\n` +
                `IMPORTANT: DO NOT ask for personal information (name, email, phone) in chat. User will click the link to book on the booking form.\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${confirmRoomLabel}:\n${confirmRoomContext}\n\n`;
          }
          
          // ✅ Nếu user đã chọn phòng (có selectedRoom), PHẢI gửi link xem chi tiết và đặt phòng
          if (context.selectedRoom && !context.showRoomDetails) {
            const roomSelectedLabel = language === 'vi' ? 'CONTEXT: KHÁCH ĐÃ CHỌN PHÒNG' : 'CONTEXT: CUSTOMER HAS SELECTED A ROOM';
            const roomSelectedContext = language === 'vi'
              ? `⚠️ QUAN TRỌNG: Khách hàng đã chọn phòng: ${context.selectedRoom.name}.\n` +
                `Bạn PHẢI xác nhận phòng đã chọn và hiển thị thông tin phòng.\n` +
                `Bạn PHẢI tạo và trả về roomDetailLink để frontend hiển thị card phòng với button "Xem chi tiết".\n` +
                `QUAN TRỌNG: KHÔNG hỏi thông tin cá nhân (họ tên, email, số điện thoại) trong chat.\n` +
                `Kết thúc với: "Hãy nhấn vào card phòng bên dưới để xem chi tiết và đặt phòng. Mọi thắc mắc xin quay lại chat để tiếp tục hỏi nhé."\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️ IMPORTANT: Customer has selected room: ${context.selectedRoom.name}.\n` +
                `You MUST confirm the selected room and display room information.\n` +
                `You MUST create and return roomDetailLink for frontend to display room card with "View Details" button.\n` +
                `IMPORTANT: DO NOT ask for personal information (name, email, phone) in chat.\n` +
                `End with: "Please click on the room card below to view details and make a booking. If you have any questions, please return to chat to continue asking."\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${roomSelectedLabel}:\n${roomSelectedContext}\n\n`;
          }
        }
        
        // ✅ Cung cấp context nếu phòng không hợp lệ
        if (context.invalidRoomSelection) {
          const invalidInfo = context.invalidRoomSelection;
          const invalidLabel = language === 'vi' ? 'CONTEXT: PHÒNG KHÔNG HỢP LỆ' : 'CONTEXT: INVALID ROOM SELECTION';
          const invalidContext = language === 'vi'
            ? `Khách hàng đã chọn phòng số ${invalidInfo.requestedRoom}, nhưng chỉ có ${invalidInfo.availableRooms} phòng trong danh sách.\n` +
              `Danh sách phòng có sẵn:\n${invalidInfo.rooms.map(r => `   ${r.number}. ${r.name} - ${r.price.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Customer selected room #${invalidInfo.requestedRoom}, but only ${invalidInfo.availableRooms} rooms are available.\n` +
              `Available rooms:\n${invalidInfo.rooms.map(r => `   ${r.number}. ${r.name} - ${r.price.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${invalidLabel}:\n${invalidContext}\n\n`;
        }
        
        // ✅ Cung cấp context nếu không có danh sách phòng
        if (context.noRoomList && context.requestedRoomNumber) {
          const requestedRoomNum = context.requestedRoomNumber;
          const noListLabel = language === 'vi' ? 'CONTEXT: KHÁCH MUỐN CHỌN PHÒNG NHƯNG CHƯA CÓ DANH SÁCH' : 'CONTEXT: CUSTOMER WANTS TO SELECT ROOM BUT NO LIST';
          const noListContext = language === 'vi'
            ? `Khách hàng đã nói muốn chọn "phòng số ${requestedRoomNum}" nhưng hiện tại chưa có danh sách phòng trong context.\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Customer said they want to select "room number ${requestedRoomNum}" but there's no room list in context.\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${noListLabel}:\n${noListContext}\n\n`;
        }
        
        // ✅ Cung cấp context về phòng đã chọn (nếu có)
        if (context.selectedRoom && context.lastRoomSearchResults) {
          const selectedRoomInfo = context.selectedRoom;
          const roomIndex = context.lastRoomSearchResults.findIndex(r => r._id.toString() === selectedRoomInfo._id) + 1;
          const contextInfo = language === 'vi'
            ? `Context: Khách hàng đã chọn phòng số ${roomIndex} từ danh sách đã hiển thị trước đó.\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Context: Customer has selected room #${roomIndex} from the previously displayed list.\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${contextInfo}\n\n`;
        }
        
        // ✅ Cung cấp context về danh sách phòng đã hiển thị (nếu có)
        if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0 && !context.selectedRoom) {
          const roomListContext = language === 'vi'
            ? `Context: Đã có danh sách ${context.lastRoomSearchResults.length} phòng đã hiển thị cho khách hàng:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý khi khách chọn phòng từ list.`
            : `Context: There is a displayed list of ${context.lastRoomSearchResults.length} rooms for the customer:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `Refer to chatbot-scenarios.md section 1.8 for handling when customer selects a room from the list.`;
          
          prompt += `\n\n${roomListContext}\n\n`;
        }
        
        // ✅ Cung cấp context về booking status - QUAN TRỌNG: CHỈ nói "đã hoàn tất" khi bookingCreated === true
        const bookingContext = context.bookingContext || {};
        // ✅ Thông báo các thông tin còn thiếu
        if (bookingContext.missingFields && bookingContext.missingFields.length > 0) {
          const missingMap = {
            dates: language === 'vi' ? 'Ngày nhận/trả phòng' : 'Check-in/check-out dates',
            guests: language === 'vi' ? 'Số lượng khách' : 'Number of guests',
            fullName: language === 'vi' ? 'Họ và tên' : 'Full name',
            email: 'Email',
            phone: language === 'vi' ? 'Số điện thoại' : 'Phone number'
          };
          const missingText = bookingContext.missingFields.map(field => `- ${missingMap[field] || field}`).join('\n');
          const missingPrompt = language === 'vi'
            ? `⚠️⚠️⚠️ CHƯA ĐỦ THÔNG TIN ĐỂ ĐẶT PHÒNG!\nCác thông tin còn thiếu:\n${missingText}\nBạn PHẢI hỏi khách trong 1 câu gọn (hoặc tối đa 2 câu) để lấy đủ thông tin. KHÔNG được nói đã đặt xong khi còn thiếu dữ liệu.`
            : `⚠️⚠️⚠️ MISSING INFORMATION!\nStill missing:\n${missingText}\nYou MUST ask the customer (in max 1-2 sentences) to provide these details. DO NOT say booking is completed while information is missing.`;
          prompt += `\n\n${missingPrompt}\n\n`;
        }
        if (bookingContext.bookingCreated && bookingContext.bookingId) {
          // ✅ CHỈ KHI NÀY mới được nói "đã hoàn tất đặt phòng"
          const isTempUser = bookingContext.tempUserCreated === true;
          const bookingSuccessContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Booking đã được tạo THÀNH CÔNG trong database! Mã đặt phòng: ${bookingContext.bookingId}\n` +
              `${isTempUser ? '✅ Đã tạo tài khoản tạm cho khách hàng từ thông tin đã cung cấp.\n' : ''}` +
              `Bạn PHẢI nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng thành công".\n` +
              `KHÔNG cần yêu cầu đăng nhập nữa. Chỉ cần gửi link thanh toán.\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 6 để hướng dẫn thanh toán.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking has been created SUCCESSFULLY in database! Booking ID: ${bookingContext.bookingId}\n` +
              `${isTempUser ? '✅ Created temporary account for customer from provided information.\n' : ''}` +
              `You MUST say "booking completed" or "booking created successfully".\n` +
              `NO need to ask for login anymore. Just send payment link.\n` +
              `Refer to chatbot-scenarios.md section 1.1 step 6 for payment guidance.`;
          prompt += `\n\n${bookingSuccessContext}\n\n`;
        } else if (bookingContext.bookingError) {
          const bookingErrorContext = language === 'vi'
            ? `⚠️ QUAN TRỌNG: Lỗi khi tạo booking: ${bookingContext.bookingError}\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng". Phải thông báo lỗi và đề xuất giải pháp.\n` +
              `Tham khảo chatbot-scenarios.md để xử lý lỗi.`
            : `⚠️ IMPORTANT: Error creating booking: ${bookingContext.bookingError}\n` +
              `You MUST NOT say "booking completed". Must inform about error and suggest solutions.\n` +
              `Refer to chatbot-scenarios.md to handle error.`;
          prompt += `\n\n${bookingErrorContext}\n\n`;
        } else if (bookingContext.needPersonalInfo) {
          // ✅ CHƯA có đủ thông tin - KHÔNG được nói "đã hoàn tất"
          const needInfoContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: CHƯA tạo booking! Cần thu thập thông tin cá nhân (tên, email, số điện thoại) để tạo booking.\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng".\n` +
              `Bạn PHẢI hỏi thông tin còn thiếu (đặc biệt là EMAIL - bắt buộc).\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 5 để thu thập thông tin.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking NOT created yet! Need to collect personal information (name, email, phone) to create booking.\n` +
              `You MUST NOT say "booking completed" or "booking created".\n` +
              `You MUST ask for missing information (especially EMAIL - required).\n` +
              `Refer to chatbot-scenarios.md section 1.1 step 5 to collect information.`;
          prompt += `\n\n${needInfoContext}\n\n`;
        } else if (bookingContext.needLogin) {
          // ✅ CHƯA tạo booking - cần đăng nhập (trường hợp này không còn xảy ra nữa vì đã tạo user tạm)
          // Nhưng vẫn giữ để xử lý edge cases
          const needLoginContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: CHƯA tạo booking! User chưa đăng nhập nhưng đã cung cấp thông tin cá nhân.\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng".\n` +
              `Bạn PHẢI hướng dẫn đăng nhập hoặc tạo tài khoản để hoàn tất booking.\n` +
              `Tham khảo chatbot-scenarios.md để xử lý.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking NOT created yet! User not logged in but has provided personal information.\n` +
              `You MUST NOT say "booking completed" or "booking created".\n` +
              `You MUST guide login or create account to complete booking.\n` +
              `Refer to chatbot-scenarios.md for handling.`;
          prompt += `\n\n${needLoginContext}\n\n`;
        } else if (bookingContext.confirmBooking && bookingContext.roomId && bookingContext.checkInDate && bookingContext.checkOutDate) {
          // ✅ Đã xác nhận nhưng chưa tạo booking - cần kiểm tra xem có đủ thông tin không
          const readyToBookContext = language === 'vi'
            ? `Context: Khách hàng đã xác nhận muốn đặt phòng và đã có thông tin cơ bản (phòng, ngày, giá).\n` +
              `NHƯNG: Chưa tạo booking trong database. Cần kiểm tra xem có đủ thông tin cá nhân (tên, email, số điện thoại) không.\n` +
              `Nếu thiếu, PHẢI hỏi thông tin còn thiếu. KHÔNG được nói "đã hoàn tất đặt phòng".\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 5-6 để xử lý.`
            : `Context: Customer has confirmed booking and has basic information (room, dates, price).\n` +
              `HOWEVER: Booking not created in database yet. Need to check if personal information (name, email, phone) is complete.\n` +
              `If missing, MUST ask for missing information. MUST NOT say "booking completed".\n` +
              `Refer to chatbot-scenarios.md section 1.1 steps 5-6 for handling.`;
          prompt += `\n\n${readyToBookContext}\n\n`;
        }
        
        // Thêm thông tin phòng tìm được nếu có (chỉ cung cấp data, không hướng dẫn cách trả lời)
        if (roomSearchResults && roomSearchResults.length > 0) {
          const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG TÌM ĐƯỢC' : 'ROOM INFORMATION FOUND';
          
          prompt += `\n\n${roomInfoLabel}:\n`;
          roomSearchResults.forEach((room, index) => {
            prompt += `${index + 1}. ${room.name} - ${room.roomType}\n`;
            prompt += `   ${language === 'vi' ? 'Giá' : 'Price'}: ${room.pricePerNight.toLocaleString('vi-VN')} VND/night\n`;
            prompt += `   ${language === 'vi' ? 'Số người' : 'Max occupancy'}: ${room.maxOccupancy}\n`;
            prompt += `   View: ${room.view || 'N/A'}\n`;
            prompt += `   ID: ${room._id}\n\n`;
          });
          prompt += `Tham khảo chatbot-scenarios.md section 1.1 để xử lý đúng cách.\n\n`;
        } else if (isRoomSearchRequest && roomSearchResults && roomSearchResults.length === 0) {
          const noRoomNote = language === 'vi'
            ? "Context: Không tìm thấy phòng nào phù hợp với yêu cầu. Tham khảo chatbot-scenarios.md để xử lý đúng cách."
            : "Context: No rooms found matching the request. Refer to chatbot-scenarios.md for proper handling.";
          prompt += `\n\n${noRoomNote}\n\n`;
        }
      } else {
        // Fallback: dùng logic cũ nếu không có RAG
        prompt = languageHeader + SYSTEM_PROMPT + "\n\n";
        
        // ✅ Thêm thông tin phòng đã chọn nếu có (QUAN TRỌNG - phải đúng thông tin)
        if (context.selectedRoom) {
          const selectedRoomInfo = context.selectedRoom;
          const bookingContext = context.bookingContext || {};
          const roomPrompt = generateSelectedRoomPrompt(selectedRoomInfo, bookingContext, language);
          
          prompt += `\n\n${roomPrompt.label}:\n`;
          prompt += "=".repeat(50) + "\n";
          prompt += `${roomPrompt.content}\n`;
          prompt += "=".repeat(50) + "\n\n";
          
          // ✅ Nếu user nói "chốt phòng đó" hoặc "đặt phòng đó", PHẢI hiển thị chi tiết phòng, KHÔNG tìm phòng mới
          if (context.showRoomDetails || context.shouldNotSearchRooms) {
            const confirmRoomLabel = language === 'vi' ? 'CONTEXT: KHÁCH MUỐN CHỐT PHÒNG ĐÃ CHỌN' : 'CONTEXT: CUSTOMER WANTS TO CONFIRM SELECTED ROOM';
            const confirmRoomContext = language === 'vi'
              ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã nói "chốt phòng đó" hoặc "đặt phòng đó".\n` +
                `Bạn PHẢI hiển thị CHI TIẾT phòng đã chọn (tên, giá, loại, sức chứa, view, tiện nghi).\n` +
                `Bạn PHẢI gửi 2 link cho khách:\n` +
                `- Link xem chi tiết phòng: [Xem chi tiết phòng](link sẽ được thêm tự động)\n` +
                `- Link đặt phòng: [Đặt phòng ngay](link sẽ được thêm tự động)\n` +
                `Bạn KHÔNG được tìm phòng mới hoặc hiển thị danh sách phòng khác.\n` +
                `QUAN TRỌNG: KHÔNG hỏi thông tin cá nhân (họ tên, email, số điện thoại) trong chat. User sẽ click vào link để đặt phòng trên booking form.\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer said "confirm this room" or "book this room".\n` +
                `You MUST display DETAILED information of the selected room (name, price, type, capacity, view, amenities).\n` +
                `You MUST send 2 links to the customer:\n` +
                `- Room detail link: [View Room Details](link will be added automatically)\n` +
                `- Booking link: [Book Now](link will be added automatically)\n` +
                `You MUST NOT search for new rooms or display other room lists.\n` +
                `IMPORTANT: DO NOT ask for personal information (name, email, phone) in chat. User will click the link to book on the booking form.\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${confirmRoomLabel}:\n${confirmRoomContext}\n\n`;
          }
          
          // ✅ Nếu user đã chọn phòng (có selectedRoom), PHẢI gửi link xem chi tiết và đặt phòng
          if (context.selectedRoom && !context.showRoomDetails) {
            const roomSelectedLabel = language === 'vi' ? 'CONTEXT: KHÁCH ĐÃ CHỌN PHÒNG' : 'CONTEXT: CUSTOMER HAS SELECTED A ROOM';
            const roomSelectedContext = language === 'vi'
              ? `⚠️ QUAN TRỌNG: Khách hàng đã chọn phòng: ${context.selectedRoom.name}.\n` +
                `Bạn PHẢI xác nhận phòng đã chọn và hiển thị thông tin phòng.\n` +
                `Bạn PHẢI tạo và trả về roomDetailLink để frontend hiển thị card phòng với button "Xem chi tiết".\n` +
                `QUAN TRỌNG: KHÔNG hỏi thông tin cá nhân (họ tên, email, số điện thoại) trong chat.\n` +
                `Kết thúc với: "Hãy nhấn vào card phòng bên dưới để xem chi tiết và đặt phòng. Mọi thắc mắc xin quay lại chat để tiếp tục hỏi nhé."\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️ IMPORTANT: Customer has selected room: ${context.selectedRoom.name}.\n` +
                `You MUST confirm the selected room and display room information.\n` +
                `You MUST create and return roomDetailLink for frontend to display room card with "View Details" button.\n` +
                `IMPORTANT: DO NOT ask for personal information (name, email, phone) in chat.\n` +
                `End with: "Please click on the room card below to view details and make a booking. If you have any questions, please return to chat to continue asking."\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${roomSelectedLabel}:\n${roomSelectedContext}\n\n`;
          }
        }
        
        // ✅ Cung cấp context nếu phòng không hợp lệ (fallback)
        if (context.invalidRoomSelection) {
          const invalidInfo = context.invalidRoomSelection;
          const invalidLabel = language === 'vi' ? 'CONTEXT: PHÒNG KHÔNG HỢP LỆ' : 'CONTEXT: INVALID ROOM SELECTION';
          const invalidContext = language === 'vi'
            ? `Khách hàng đã chọn phòng số ${invalidInfo.requestedRoom}, nhưng chỉ có ${invalidInfo.availableRooms} phòng trong danh sách.\n` +
              `Danh sách phòng có sẵn:\n${invalidInfo.rooms.map(r => `   ${r.number}. ${r.name} - ${r.price.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Customer selected room #${invalidInfo.requestedRoom}, but only ${invalidInfo.availableRooms} rooms are available.\n` +
              `Available rooms:\n${invalidInfo.rooms.map(r => `   ${r.number}. ${r.name} - ${r.price.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${invalidLabel}:\n${invalidContext}\n\n`;
        }
        
        // ✅ Cung cấp context nếu không có danh sách phòng (fallback)
        if (context.noRoomList && context.requestedRoomNumber) {
          const requestedRoomNum = context.requestedRoomNumber;
          const noListLabel = language === 'vi' ? 'CONTEXT: KHÁCH MUỐN CHỌN PHÒNG NHƯNG CHƯA CÓ DANH SÁCH' : 'CONTEXT: CUSTOMER WANTS TO SELECT ROOM BUT NO LIST';
          const noListContext = language === 'vi'
            ? `Khách hàng đã nói muốn chọn "phòng số ${requestedRoomNum}" nhưng hiện tại chưa có danh sách phòng trong context.\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Customer said they want to select "room number ${requestedRoomNum}" but there's no room list in context.\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${noListLabel}:\n${noListContext}\n\n`;
        }
        
        // ✅ Cung cấp context về phòng đã chọn (nếu có) - fallback
        if (context.selectedRoom && context.lastRoomSearchResults) {
          const selectedRoomInfo = context.selectedRoom;
          const roomIndex = context.lastRoomSearchResults.findIndex(r => r._id.toString() === selectedRoomInfo._id) + 1;
          const contextInfo = language === 'vi'
            ? `Context: Khách hàng đã chọn phòng số ${roomIndex} từ danh sách đã hiển thị trước đó.\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
            : `Context: Customer has selected room #${roomIndex} from the previously displayed list.\n` +
              `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
          
          prompt += `\n\n${contextInfo}\n\n`;
        }
        
        // ✅ Cung cấp context về danh sách phòng đã hiển thị (nếu có) - fallback
        if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0 && !context.selectedRoom) {
          const roomListContext = language === 'vi'
            ? `Context: Đã có danh sách ${context.lastRoomSearchResults.length} phòng đã hiển thị cho khách hàng:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý khi khách chọn phòng từ list.`
            : `Context: There is a displayed list of ${context.lastRoomSearchResults.length} rooms for the customer:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `Refer to chatbot-scenarios.md section 1.8 for handling when customer selects a room from the list.`;
          
          prompt += `\n\n${roomListContext}\n\n`;
        }
        
        // ✅ Cung cấp context về booking status (fallback) - QUAN TRỌNG: CHỈ nói "đã hoàn tất" khi bookingCreated === true
        const bookingContextFallback = context.bookingContext || {};
        // ✅ Thông báo các thông tin còn thiếu (fallback)
        if (bookingContextFallback.missingFields && bookingContextFallback.missingFields.length > 0) {
          const missingMap = {
            dates: language === 'vi' ? 'Ngày nhận/trả phòng' : 'Check-in/check-out dates',
            guests: language === 'vi' ? 'Số lượng khách' : 'Number of guests',
            fullName: language === 'vi' ? 'Họ và tên' : 'Full name',
            email: 'Email',
            phone: language === 'vi' ? 'Số điện thoại' : 'Phone number'
          };
          const missingText = bookingContextFallback.missingFields.map(field => `- ${missingMap[field] || field}`).join('\n');
          const missingPrompt = language === 'vi'
            ? `⚠️⚠️⚠️ CHƯA ĐỦ THÔNG TIN ĐỂ ĐẶT PHÒNG!\nCác thông tin còn thiếu:\n${missingText}\nBạn PHẢI hỏi khách trong 1 câu gọn (hoặc tối đa 2 câu) để lấy đủ thông tin. KHÔNG được nói đã đặt xong khi còn thiếu dữ liệu.`
            : `⚠️⚠️⚠️ MISSING INFORMATION!\nStill missing:\n${missingText}\nYou MUST ask the customer (in max 1-2 sentences) to provide these details. DO NOT say booking is completed while information is missing.`;
          prompt += `\n\n${missingPrompt}\n\n`;
        }
        if (bookingContextFallback.bookingCreated && bookingContextFallback.bookingId) {
          // ✅ CHỈ KHI NÀY mới được nói "đã hoàn tất đặt phòng"
          const isTempUser = bookingContextFallback.tempUserCreated === true;
          const bookingSuccessContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Booking đã được tạo THÀNH CÔNG trong database! Mã đặt phòng: ${bookingContextFallback.bookingId}\n` +
              `${isTempUser ? '✅ Đã tạo tài khoản tạm cho khách hàng từ thông tin đã cung cấp.\n' : ''}` +
              `Bạn PHẢI nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng thành công".\n` +
              `KHÔNG cần yêu cầu đăng nhập nữa. Chỉ cần gửi link thanh toán.\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 6 để hướng dẫn thanh toán.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking has been created SUCCESSFULLY in database! Booking ID: ${bookingContextFallback.bookingId}\n` +
              `${isTempUser ? '✅ Created temporary account for customer from provided information.\n' : ''}` +
              `You MUST say "booking completed" or "booking created successfully".\n` +
              `NO need to ask for login anymore. Just send payment link.\n` +
              `Refer to chatbot-scenarios.md section 1.1 step 6 for payment guidance.`;
          prompt += `\n\n${bookingSuccessContext}\n\n`;
        } else if (bookingContextFallback.bookingError) {
          const bookingErrorContext = language === 'vi'
            ? `⚠️ QUAN TRỌNG: Lỗi khi tạo booking: ${bookingContextFallback.bookingError}\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng". Phải thông báo lỗi và đề xuất giải pháp.\n` +
              `Tham khảo chatbot-scenarios.md để xử lý lỗi.`
            : `⚠️ IMPORTANT: Error creating booking: ${bookingContextFallback.bookingError}\n` +
              `You MUST NOT say "booking completed". Must inform about error and suggest solutions.\n` +
              `Refer to chatbot-scenarios.md to handle error.`;
          prompt += `\n\n${bookingErrorContext}\n\n`;
        } else if (bookingContextFallback.needPersonalInfo) {
          // ✅ CHƯA có đủ thông tin - KHÔNG được nói "đã hoàn tất"
          const needInfoContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: CHƯA tạo booking! Cần thu thập thông tin cá nhân (tên, email, số điện thoại) để tạo booking.\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng".\n` +
              `Bạn PHẢI hỏi thông tin còn thiếu (đặc biệt là EMAIL - bắt buộc).\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 5 để thu thập thông tin.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking NOT created yet! Need to collect personal information (name, email, phone) to create booking.\n` +
              `You MUST NOT say "booking completed" or "booking created".\n` +
              `You MUST ask for missing information (especially EMAIL - required).\n` +
              `Refer to chatbot-scenarios.md section 1.1 step 5 to collect information.`;
          prompt += `\n\n${needInfoContext}\n\n`;
        } else if (bookingContextFallback.needLogin) {
          // ✅ CHƯA tạo booking - cần đăng nhập
          const needLoginContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: CHƯA tạo booking! User chưa đăng nhập nhưng đã cung cấp thông tin cá nhân.\n` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng".\n` +
              `Bạn PHẢI hướng dẫn đăng nhập hoặc tạo tài khoản để hoàn tất booking.\n` +
              `Tham khảo chatbot-scenarios.md để xử lý.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking NOT created yet! User not logged in but has provided personal information.\n` +
              `You MUST NOT say "booking completed" or "booking created".\n` +
              `You MUST guide login or create account to complete booking.\n` +
              `Refer to chatbot-scenarios.md for handling.`;
          prompt += `\n\n${needLoginContext}\n\n`;
        } else if (bookingContextFallback.confirmBooking && bookingContextFallback.roomId && bookingContextFallback.checkInDate && bookingContextFallback.checkOutDate) {
          // ✅ Đã xác nhận nhưng chưa tạo booking - cần kiểm tra xem có đủ thông tin không
          const readyToBookContext = language === 'vi'
            ? `Context: Khách hàng đã xác nhận muốn đặt phòng và đã có thông tin cơ bản (phòng, ngày, giá).\n` +
              `NHƯNG: Chưa tạo booking trong database. Cần kiểm tra xem có đủ thông tin cá nhân (tên, email, số điện thoại) không.\n` +
              `Nếu thiếu, PHẢI hỏi thông tin còn thiếu. KHÔNG được nói "đã hoàn tất đặt phòng".\n` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 5-6 để xử lý.`
            : `Context: Customer has confirmed booking and has basic information (room, dates, price).\n` +
              `HOWEVER: Booking not created in database yet. Need to check if personal information (name, email, phone) is complete.\n` +
              `If missing, MUST ask for missing information. MUST NOT say "booking completed".\n` +
              `Refer to chatbot-scenarios.md section 1.1 steps 5-6 for handling.`;
          prompt += `\n\n${readyToBookContext}\n\n`;
        }
        
        // ✅ QUAN TRỌNG: Nếu đã tự động tìm phòng (autoSearchedRooms), bot PHẢI hiển thị room cards ngay
        if (context.autoSearchedRooms && roomSearchResults && roomSearchResults.length > 0) {
          const autoSearchLabel = language === 'vi' ? 'CONTEXT: ĐÃ TỰ ĐỘNG TÌM PHÒNG' : 'CONTEXT: AUTO-SEARCHED ROOMS';
          const autoSearchContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã cung cấp đủ thông tin (ngày check-in/out, số người, email, phone).\n` +
              `Bạn ĐÃ TỰ ĐỘNG tìm phòng trống và tìm thấy ${roomSearchResults.length} phòng phù hợp.\n` +
              `Bạn PHẢI hiển thị danh sách phòng này với room cards (frontend sẽ hiển thị tự động).\n` +
              `Bạn KHÔNG được hỏi lại về việc tìm phòng hoặc hỏi "bạn muốn chúng tôi tự động kiểm tra phòng hay không".\n` +
              `Bạn PHẢI trả lời ngắn gọn: "Tôi đã tự động kiểm tra và tìm thấy [X] phòng phù hợp với yêu cầu của quý khách. Vui lòng xem chi tiết các phòng bên dưới và chọn phòng bạn muốn đặt."\n` +
              `Sau đó frontend sẽ tự động hiển thị room cards với button "Xem chi tiết" cho từng phòng.`
            : `⚠️⚠️⚠️ IMPORTANT: Customer has provided complete information (check-in/out dates, number of guests, email, phone).\n` +
              `You HAVE AUTO-SEARCHED for available rooms and found ${roomSearchResults.length} suitable rooms.\n` +
              `You MUST display this room list with room cards (frontend will display automatically).\n` +
              `You MUST NOT ask again about searching for rooms or ask "would you like us to automatically check rooms".\n` +
              `You MUST respond briefly: "I have automatically checked and found [X] rooms suitable for your requirements. Please see the room details below and choose the room you want to book."\n` +
              `Then frontend will automatically display room cards with "View Details" button for each room.`;
          
          prompt += `\n\n${autoSearchLabel}:\n${autoSearchContext}\n\n`;
        }
        
        // ✅ Thêm thông tin phòng tìm được nếu có - TÍNH GIÁ CHI TIẾT VỚI PHỤ THU TRẺ EM
        if (roomSearchResults && roomSearchResults.length > 0) {
          const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG TÌM ĐƯỢC' : 'ROOM INFORMATION FOUND';
          const bookingContext = context.bookingContext || {};
          const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
          const adults = bookingContext.adults || bookingContext.guests || 1;
          const children = bookingContext.children || [];
          
          prompt += `\n\n${roomInfoLabel}:\n`;
          prompt += "=".repeat(50) + "\n";
          prompt += `${language === 'vi' ? 'QUAN TRỌNG' : 'IMPORTANT'}: ${language === 'vi' ? 'Các phòng này đã được đánh số thứ tự (1, 2, 3, 4...). Khách hàng có thể chọn phòng bằng cách nói "phòng số X" hoặc "chọn phòng số X".' : 'These rooms are numbered (1, 2, 3, 4...). Customers can select a room by saying "room number X" or "choose room number X".'}\n\n`;
          
          roomSearchResults.forEach((room, index) => {
            prompt += `\n${index + 1}. ${room.name} - ${room.roomType} (${language === 'vi' ? 'Số thứ tự' : 'Number'}: ${index + 1})\n`;
            prompt += `   ${language === 'vi' ? 'Giá cơ bản' : 'Base price'}: ${room.pricePerNight.toLocaleString('vi-VN')} VND/night\n`;
            prompt += `   ${language === 'vi' ? 'Sức chứa' : 'Max occupancy'}: ${room.maxOccupancy} ${language === 'vi' ? 'người' : 'people'}\n`;
            prompt += `   View: ${room.view || 'N/A'}\n`;
            
            // ✅ Tính giá chi tiết với phụ thu trẻ em nếu có ngày và thông tin trẻ em
            if (hasDates && children.length > 0) {
              const checkIn = new Date(bookingContext.checkInDate);
              const checkOut = new Date(bookingContext.checkOutDate);
              const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
              const roomQuantity = bookingContext.roomQuantity || 1;
              
              const priceCalculation = calculateTotalPriceWithChildSurcharge(
                room.pricePerNight,
                nights,
                roomQuantity,
                adults,
                children
              );
              
              prompt += `   ${language === 'vi' ? 'Số đêm' : 'Nights'}: ${nights} ${language === 'vi' ? 'đêm' : 'nights'}\n`;
              prompt += `   ${language === 'vi' ? 'Giá cơ bản cho' : 'Base price for'} ${nights} ${language === 'vi' ? 'đêm' : 'nights'}: ${priceCalculation.baseTotal.toLocaleString('vi-VN')} VND\n`;
              
              if (priceCalculation.childSurcharge > 0) {
                prompt += `   ${language === 'vi' ? 'Phụ thu trẻ em' : 'Child surcharge'}: ${priceCalculation.childSurcharge.toLocaleString('vi-VN')} VND\n`;
                
                // Chi tiết phụ thu cho từng trẻ
                const pricePerAdultPerNight = room.pricePerNight / Math.max(adults, 1);
                const childDetails = [];
                children.forEach((child, idx) => {
                  const childAge = child.age || child;
                  let surchargePerChild = 0;
                  let policy = '';
                  
                  if (childAge < 6) {
                    surchargePerChild = 0;
                    policy = language === 'vi' ? 'miễn phí' : 'free';
                  } else if (childAge >= 6 && childAge < 12) {
                    surchargePerChild = (pricePerAdultPerNight * 0.5) * nights * roomQuantity;
                    policy = '50%';
                  } else {
                    surchargePerChild = pricePerAdultPerNight * nights * roomQuantity;
                    policy = '100%';
                  }
                  
                  if (surchargePerChild > 0) {
                    childDetails.push(`     • ${language === 'vi' ? 'Trẻ' : 'Child'} ${idx + 1} (${childAge} ${language === 'vi' ? 'tuổi' : 'years'}): ${surchargePerChild.toLocaleString('vi-VN')} VND (${policy} ${language === 'vi' ? 'giá người lớn' : 'adult price'})`);
                  } else {
                    childDetails.push(`     • ${language === 'vi' ? 'Trẻ' : 'Child'} ${idx + 1} (${childAge} ${language === 'vi' ? 'tuổi' : 'years'}): ${language === 'vi' ? 'miễn phí' : 'free'}`);
                  }
                });
                
                if (childDetails.length > 0) {
                  prompt += `   ${language === 'vi' ? 'Chi tiết phụ thu' : 'Surcharge details'}:\n${childDetails.join('\n')}\n`;
                }
              } else {
                prompt += `   ${language === 'vi' ? 'Trẻ em' : 'Children'}: ${language === 'vi' ? 'miễn phí (tất cả đều dưới 6 tuổi)' : 'free (all under 6 years old)'}\n`;
              }
              
              prompt += `   ${language === 'vi' ? 'TỔNG CHI PHÍ DỰ KIẾN' : 'ESTIMATED TOTAL COST'}: ${priceCalculation.totalPrice.toLocaleString('vi-VN')} VND\n`;
            } else if (hasDates) {
              // Có ngày nhưng không có trẻ em
              const checkIn = new Date(bookingContext.checkInDate);
              const checkOut = new Date(bookingContext.checkOutDate);
              const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
              const roomQuantity = bookingContext.roomQuantity || 1;
              const baseTotal = room.pricePerNight * nights * roomQuantity;
              prompt += `   ${language === 'vi' ? 'Số đêm' : 'Nights'}: ${nights} ${language === 'vi' ? 'đêm' : 'nights'}\n`;
              prompt += `   ${language === 'vi' ? 'Tổng giá' : 'Total price'}: ${baseTotal.toLocaleString('vi-VN')} VND\n`;
            }
            
            prompt += `   ${language === 'vi' ? 'Tiện nghi' : 'Amenities'}: ${room.amenities?.join(', ') || 'N/A'}\n`;
            prompt += `\n`;
          });
          
          prompt += "=".repeat(50) + "\n";
          prompt += `\n${language === 'vi' ? 'QUAN TRỌNG' : 'IMPORTANT'}: ${language === 'vi' ? 'Bạn PHẢI hiển thị danh sách phòng này với giá chi tiết (bao gồm phụ thu trẻ em nếu có) để khách hàng có thể xem và quyết định. KHÔNG chỉ nói chung chung, PHẢI hiển thị từng phòng với giá cụ thể.' : 'You MUST display this room list with detailed prices (including child surcharge if any) so customers can view and decide. DO NOT just speak generally, MUST display each room with specific price.'}\n`;
          prompt += `Tham khảo chatbot-scenarios.md section 1.1 và 1.2 để xử lý đúng cách.\n\n`;
        } else if (isRoomSearchRequest && roomSearchResults && roomSearchResults.length === 0) {
          // ✅ KHÔNG tìm thấy phòng phù hợp – CHỈ được xin phép gợi ý phương án khác, KHÔNG được xin thêm thông tin đặt phòng cho phòng đã hết
          const noRoomNote = language === 'vi'
            ? "Context: KHÔNG tìm thấy phòng nào phù hợp với yêu cầu hiện tại (hết phòng hoặc không còn đúng loại phòng / ngày đã chọn).\n" +
              "Bạn CHỈ được:\n" +
              "- Xin lỗi khách vì hiện không còn phòng phù hợp.\n" +
              "- Đề xuất 1–2 phương án khác (đổi ngày, đổi loại phòng, gọi hotline nếu cần).\n" +
              "Bạn KHÔNG được hỏi thêm họ tên, email, số điện thoại để 'đặt phòng' cho khoảng thời gian hiện tại vì thực tế KHÔNG còn phòng.\n"
            : "Context: There are NO rooms available that match the current request (fully booked or no matching room/dates).\n" +
              "You MUST ONLY:\n" +
              "- Apologize and clearly state that no rooms are available.\n" +
              "- Offer 1–2 alternatives (change dates, change room type, call hotline if needed).\n" +
              "You MUST NOT ask for full booking details (name, email, phone) to book a room for dates that are not available.\n";
          prompt += `${noRoomNote}\n\n`;
        }
      }
      
      // ✅ SỬA: Thêm lịch sử hội thoại với labels đúng ngôn ngữ
      if (conversationHistory.length > 0) {
        prompt += `${historyLabel}:\n`;
        conversationHistory.slice(-6).forEach(msg => {
          prompt += `${msg.sender === 'user' ? userLabel : botLabel}: ${msg.message}\n`;
        });
        prompt += "\n";
      }

      // ✅ SỬA: Đảm bảo user message được thêm vào prompt với labels đúng ngôn ngữ
      if (!prompt.includes(`${userLabel}: ${userMessage}`) && !prompt.includes(`Customer: ${userMessage}`) && !prompt.includes(`Khách hàng: ${userMessage}`)) {
        prompt += `${userLabel}: ${userMessage}\n${botLabel}:`;
      }
      
      // ✅ THÊM: Instruction rõ ràng về ngôn ngữ ở cuối prompt (NHẤN MẠNH)
      const langInstruction = language === 'vi' 
        ? "\n\n⚠️⚠️⚠️ QUAN TRỌNG: Bạn PHẢI trả lời bằng TIẾNG VIỆT. KHÔNG được trả lời bằng tiếng Anh. ⚠️⚠️⚠️"
        : "\n\n⚠️⚠️⚠️ IMPORTANT: You MUST respond in ENGLISH. DO NOT respond in Vietnamese. ⚠️⚠️⚠️";
      prompt += langInstruction;
      
      // ✅ THÊM: Log prompt để debug (chỉ log 500 ký tự đầu)
      console.log(`📋 Prompt preview (first 500 chars): ${prompt.substring(0, 500)}...`);
      
      // Call Gemini API
      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // ✅ QUAN TRỌNG: Parse room types từ AI response và tìm phòng cụ thể nếu bot đề xuất phòng
      // Ví dụ: "3 phòng Đôi", "1 phòng Suite" -> tìm các phòng cụ thể từ database
      const Room = (await import('../Models/RoomModel.js')).default;
      const suggestedRoomTypes = [];
      
      // Parse room types từ AI response text
      // ✅ QUAN TRỌNG: Parse cả format có số lượng (ví dụ: "2 Phòng VIP", "3 Phòng Đôi") và không có số lượng (ví dụ: "Suite")
      const responseTextLower = text.toLowerCase();
      const roomTypePatterns = [
        // Format có số lượng: "3 Phòng Đôi", "2 Phòng VIP", "1 Phòng Suite", "2 Phòng VIP"
        { pattern: /(\d+)\s*(?:phòng\s*)?(?:đôi|double)/i, type: 'đôi', name: 'Phòng Đôi' },
        { pattern: /(\d+)\s*(?:phòng\s*)?(?:đơn|single)/i, type: 'đơn', name: 'Phòng Đơn' },
        { pattern: /(\d+)\s*(?:phòng\s*)?(?:vip)/i, type: 'VIP', name: 'Phòng VIP' },
        { pattern: /(\d+)\s*(?:phòng\s*)?(?:suite)/i, type: 'suite', name: 'Phòng Suite' },
        // Format không có số lượng nhưng có từ "phòng": "Phòng VIP", "Phòng Đôi", "Phòng Suite"
        { pattern: /(?:^|\s|:|\*|-)\s*phòng\s*(?:đôi|double)(?:\s|$|:|\*|-|,|\.)/i, type: 'đôi', name: 'Phòng Đôi', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*phòng\s*(?:đơn|single)(?:\s|$|:|\*|-|,|\.)/i, type: 'đơn', name: 'Phòng Đơn', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*phòng\s*(?:vip)(?:\s|$|:|\*|-|,|\.)/i, type: 'VIP', name: 'Phòng VIP', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*phòng\s*(?:suite)(?:\s|$|:|\*|-|,|\.)/i, type: 'suite', name: 'Phòng Suite', defaultQuantity: 1 },
        // Format không có từ "phòng": "Suite", "VIP", "Đôi" (chỉ có tên loại phòng)
        { pattern: /(?:^|\s|:|\*|-)\s*(?:suite)(?:\s|$|:|\*|-|,|\.)/i, type: 'suite', name: 'Phòng Suite', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*(?:vip)(?:\s|$|:|\*|-|,|\.)/i, type: 'VIP', name: 'Phòng VIP', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*(?:đôi|double)(?:\s|$|:|\*|-|,|\.)/i, type: 'đôi', name: 'Phòng Đôi', defaultQuantity: 1 },
        { pattern: /(?:^|\s|:|\*|-)\s*(?:đơn|single)(?:\s|$|:|\*|-|,|\.)/i, type: 'đơn', name: 'Phòng Đơn', defaultQuantity: 1 }
      ];
      
      for (const { pattern, type, name, defaultQuantity } of roomTypePatterns) {
        const match = text.match(pattern);
        if (match) {
          // ✅ QUAN TRỌNG: Lấy số lượng từ match[1] nếu có, nếu không dùng defaultQuantity hoặc 1
          const quantity = match[1] ? parseInt(match[1]) : (defaultQuantity || 1);
          
          // ✅ Tránh duplicate: chỉ thêm nếu chưa có room type này trong suggestedRoomTypes
          const existing = suggestedRoomTypes.find(s => s.type === type);
          if (!existing) {
            suggestedRoomTypes.push({ type, name, quantity });
            console.log(`✅ Parsed room type from AI response: ${quantity} ${name} (type: ${type})`);
          } else {
            // Nếu đã có, cập nhật quantity nếu lớn hơn
            if (quantity > existing.quantity) {
              existing.quantity = quantity;
            }
          }
        }
      }
      
      console.log(`✅ Total parsed room types: ${suggestedRoomTypes.length}`, suggestedRoomTypes);
      
      // ✅ QUAN TRỌNG: Nếu bot đề xuất room types, tìm phòng cụ thể và THAY THẾ roomSearchResults
      // (không merge để tránh duplicate và đảm bảo đúng số lượng)
      // ✅ LƯU Ý: Logic này chạy SAU khi AI đã trả lời, nên sẽ THAY THẾ roomSearchResults hiện có
      // ✅ QUAN TRỌNG: CHỈ parse và tìm phòng khi ĐÃ có đủ thông tin (dates + guests)
      // KHÔNG tìm phòng khi bot chỉ đang hỏi thông tin
      const bookingContext = context.bookingContext || {};
      const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
      const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
      const hasEnoughInfo = hasDates && hasGuests;
      
      if (suggestedRoomTypes.length > 0 && hasEnoughInfo) {
        try {
          const allSuggestedRooms = [];
          
          for (const { type, quantity, name } of suggestedRoomTypes) {
            // ✅ QUAN TRỌNG: Tìm phòng theo roomType CHÍNH XÁC, không filter theo maxOccupancy để tránh bỏ sót
            // Chỉ filter theo maxOccupancy khi cần thiết (ví dụ: tìm phòng cho 6 người)
            const searchCriteria = {
              roomType: type, // ✅ QUAN TRỌNG: Tìm chính xác theo roomType
              isAvailable: 1,
              status: 'active'
            };
            
            // ✅ QUAN TRỌNG: Thêm maxOccupancy nếu có để tìm phòng phù hợp với số người
            // Nhưng chỉ filter nếu số người lớn hơn 0 và có ý nghĩa
            const guests = bookingContext.guests || bookingContext.maxOccupancy;
            if (guests && guests > 0) {
              // Tính sức chứa tối thiểu cho mỗi phòng (ví dụ: 6 người / 3 phòng = 2 người/phòng)
              const minOccupancyPerRoom = Math.max(1, Math.floor(guests / quantity));
              // Tìm phòng có sức chứa >= minOccupancyPerRoom
              searchCriteria.maxOccupancy = { $gte: minOccupancyPerRoom };
              console.log(`🔍 Filtering by maxOccupancy for "${name}": >= ${minOccupancyPerRoom} (guests: ${guests}, quantity: ${quantity})`);
            }
            
            // Thêm dates nếu có để check availability
            if (hasDates) {
              searchCriteria.checkInDate = bookingContext.checkInDate;
              searchCriteria.checkOutDate = bookingContext.checkOutDate;
            }
            
            // Tìm phòng theo type
            const roomsByType = await searchRooms(searchCriteria);
            
            console.log(`🔍 Searching rooms for type "${type}" (${name}):`, {
              searchCriteria,
              found: roomsByType.length,
              requested: quantity,
              roomsPreview: roomsByType.slice(0, 3).map(r => ({ 
                id: r._id, 
                name: r.name, 
                roomType: r.roomType, 
                maxOccupancy: r.maxOccupancy 
              }))
            });
            
            // ✅ QUAN TRỌNG: Lấy ĐÚNG số lượng phòng theo đề xuất (ví dụ: 3 phòng Đôi -> lấy ĐÚNG 3 phòng)
            // Nếu không đủ số lượng, lấy tất cả có sẵn
            const roomsToAdd = roomsByType.slice(0, quantity);
            
            if (roomsToAdd.length > 0) {
              allSuggestedRooms.push(...roomsToAdd);
              console.log(`✅ Found ${roomsToAdd.length} rooms of type "${type}" (${name}) - requested: ${quantity}, found: ${roomsToAdd.length}`, {
                rooms: roomsToAdd.map(r => ({ 
                  id: r._id, 
                  name: r.name, 
                  roomType: r.roomType, 
                  maxOccupancy: r.maxOccupancy,
                  price: r.pricePerNight 
                }))
              });
            } else {
              console.warn(`⚠️ No rooms found for type "${type}" (${name}) - requested: ${quantity}`, {
                searchCriteria
              });
            }
          }
          
          // ✅ QUAN TRỌNG: THAY THẾ roomSearchResults (không merge) để đảm bảo đúng số lượng phòng
          if (allSuggestedRooms.length > 0) {
            roomSearchResults = allSuggestedRooms;
            context.autoSearchedRooms = true;
            // ✅ Lưu vào lastRoomSearchResults để user có thể chọn phòng số X
            context.lastRoomSearchResults = allSuggestedRooms.map((r, idx) => ({
              _id: r._id,
              name: r.name,
              roomType: r.roomType,
              pricePerNight: r.pricePerNight,
              maxOccupancy: r.maxOccupancy,
              view: r.view,
              image: r.image || r.thumbnailUrl || null,
              thumbnailUrl: r.thumbnailUrl || r.image || null,
              amenities: Array.isArray(r.amenities) ? r.amenities : [],
              _originalIndex: idx
            }));
            console.log(`✅ Added ${allSuggestedRooms.length} suggested rooms to roomSearchResults (replaced existing)`);
          }
        } catch (parseError) {
          console.error('❌ Error parsing and searching suggested room types:', parseError);
          // Không throw error, tiếp tục xử lý bình thường
        }
      }
      
      // ✅ Tính giá chi tiết cho từng phòng nếu có thông tin về trẻ em và ngày
      let enrichedRooms = null;
      if (roomSearchResults && roomSearchResults.length > 0) {
        const bookingContext = context.bookingContext || {};
        const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
        const adults = bookingContext.adults || bookingContext.guests || 1;
        const children = bookingContext.children || [];
        
        if (hasDates) {
          const checkIn = new Date(bookingContext.checkInDate);
          const checkOut = new Date(bookingContext.checkOutDate);
          const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
          const roomQuantity = bookingContext.roomQuantity || 1;
          
          enrichedRooms = roomSearchResults.map(room => {
            const priceCalculation = calculateTotalPriceWithChildSurcharge(
              room.pricePerNight,
              nights,
              roomQuantity,
              adults,
              children
            );
            
            // Tính chi tiết phụ thu cho từng trẻ em
            const pricePerAdultPerNight = room.pricePerNight / Math.max(adults, 1);
            const childSurchargeDetails = [];
            
            if (children.length > 0) {
              children.forEach((child, idx) => {
                const childAge = child.age || child;
                let surchargePerChild = 0;
                let policy = '';
                
                if (childAge < 6) {
                  surchargePerChild = 0;
                  policy = 'miễn phí';
                } else if (childAge >= 6 && childAge < 12) {
                  surchargePerChild = (pricePerAdultPerNight * 0.5) * nights * roomQuantity;
                  policy = '50% giá người lớn';
                } else {
                  surchargePerChild = pricePerAdultPerNight * nights * roomQuantity;
                  policy = '100% giá người lớn';
                }
                
                childSurchargeDetails.push({
                  childIndex: idx + 1,
                  age: childAge,
                  surcharge: surchargePerChild,
                  policy: policy
                });
              });
            }
            
            return {
              ...room.toObject ? room.toObject() : room,
              priceDetails: {
                basePricePerNight: room.pricePerNight,
                nights: nights,
                roomQuantity: roomQuantity,
                baseTotal: priceCalculation.baseTotal,
                childSurcharge: priceCalculation.childSurcharge,
                totalPrice: priceCalculation.totalPrice,
                childSurchargeDetails: childSurchargeDetails,
                adults: adults,
                children: children
              }
            };
          });
        } else {
          // Chưa có ngày, chỉ trả về giá cơ bản
          enrichedRooms = roomSearchResults.map(room => ({
            ...room.toObject ? room.toObject() : room,
            priceDetails: {
              basePricePerNight: room.pricePerNight,
              note: 'Chưa có thông tin ngày check-in/out, chưa thể tính tổng giá'
            }
          }));
        }
      }
      
      // Trả về response kèm dữ liệu phòng nếu có (với giá chi tiết)
      return {
        text: text.trim(),
        rooms: enrichedRooms || roomSearchResults || null,
        hasRooms: (enrichedRooms || roomSearchResults) && (enrichedRooms || roomSearchResults).length > 0
      };
    } catch (error) {
      // Kiểm tra xem có phải lỗi safety không
      const errorMessage = error.message || error.toString() || '';
      if (errorMessage.includes('safety') || 
          errorMessage.includes('blocked') ||
          errorMessage.includes('SAFETY') ||
          errorMessage.includes('blockedReason') ||
          error.code === 400) {
        console.warn("⚠️  Content blocked by safety filter");
        return {
          text: "Xin lỗi, tôi không thể trả lời câu hỏi này vì nó chứa nội dung không phù hợp. Tôi chỉ có thể hỗ trợ các câu hỏi về dịch vụ khách sạn như: đặt phòng, giá phòng, dịch vụ, chính sách. Vui lòng liên hệ hotline: 0901 234 567 để được hỗ trợ.",
          rooms: null,
          hasRooms: false
        };
      }
      
      console.error("Gemini API Error:", error.message || error);
      // Fallback to mock nếu có lỗi
      const mockResponse = getMockAIResponse(userMessage);
      if (roomSearchResults && roomSearchResults.length > 0) {
        // Response ngắn gọn khi có phòng
        const shortResponse = isRoomSearchRequest 
          ? `Tôi đã tìm thấy ${roomSearchResults.length} phòng phù hợp với yêu cầu của bạn:`
          : mockResponse;
        
        return {
          text: shortResponse,
          rooms: roomSearchResults,
          hasRooms: true
        };
      }
    
      return {
        text: mockResponse,
        rooms: null,
        hasRooms: false
      };
    }
  }
  
  // Fallback to mock nếu không có API key hoặc package chưa cài
  const mockResponse = getMockAIResponse(userMessage);
  
  // Nếu có room search results, thêm vào response
  if (roomSearchResults && roomSearchResults.length > 0) {
    let responseText = mockResponse + "\n\n";
    responseText += "📋 Tôi đã tìm thấy các phòng phù hợp với yêu cầu của bạn:\n\n";
    roomSearchResults.forEach((room, index) => {
      responseText += `${index + 1}. ${room.name} - ${room.roomType}\n`;
      responseText += `   💰 Giá: ${room.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm\n`;
      responseText += `   👥 Số người: ${room.maxOccupancy}\n`;
      responseText += `   🌅 View: ${room.view || 'N/A'}\n\n`;
    });
    responseText += "Bạn có muốn đặt một trong các phòng này không?";
    
    return {
      text: responseText,
      rooms: roomSearchResults,
      hasRooms: true
    };
  }
  
  return {
    text: mockResponse,
    rooms: null,
    hasRooms: false
  };
};

// Helper function to generate session ID
const generateSessionId = () => {
  return crypto.randomUUID ? crypto.randomUUID() : 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// @route   POST /api/chat/session
// @desc    Tạo session chat mới
// @access  Public (cho phép cả user và admin - admin dùng để check notification)
export const createSession = asyncHandler(async (req, res) => {
  try {
    const { language } = req.body; // ✅ Nhận language từ body
    
    const sessionId = generateSessionId();
    
    const session = await ChatSession.create({
      sessionId,
      userId: (req.user && req.user._id) ? req.user._id : null,
      context: {
        platform: "web",
        language: language || 'vi' // ✅ Lưu language vào context
      },
      platform: "web"
    });
    
    res.status(201).json({
      success: true,
      sessionId: session.sessionId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo session",
      error: error.message
    });
  }
});

// @route   POST /api/chat
// @desc    Gửi tin nhắn và nhận phản hồi từ AI
// @access  Public (chỉ dành cho user, admin không thể chat với bot)
export const chatWithAI = asyncHandler(async (req, res) => {
  try {
    const { message, sessionId, language } = req.body; // ✅ Nhận language từ body
    
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn không được để trống"
      });
    }
    
    // Tạo session mới nếu chưa có
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = generateSessionId();
      await ChatSession.create({
        sessionId: currentSessionId,
        userId: (req.user && req.user._id) ? req.user._id : null,
        context: {}
      });
    }
    
    // Lấy context từ session nếu có
    let session = await ChatSession.findOne({ sessionId: currentSessionId });
    const context = session?.context || {};
    
    // ✅ QUAN TRỌNG: Khai báo bookingContext TRƯỚC và restore từ session
    let bookingContext = {};
    if (session?.context?.bookingContext) {
      bookingContext = { ...session.context.bookingContext };
      console.log(`📋 Restored bookingContext from session:`, {
        roomId: bookingContext.roomId,
        roomName: bookingContext.roomName,
        hasCheckInDate: !!bookingContext.checkInDate,
        hasCheckOutDate: !!bookingContext.checkOutDate
      });
    } else if (context.bookingContext) {
      bookingContext = { ...context.bookingContext };
      console.log(`📋 Using bookingContext from context:`, {
        roomId: bookingContext.roomId,
        roomName: bookingContext.roomName
      });
    }
    
    
    // ✅ QUAN TRỌNG: Restore lastRoomSearchResults từ session (CHỈ 1 CHỖ DUY NHẤT - TRƯỚC parse intent)
    if (session?.context?.lastRoomSearchResults) {
      context.lastRoomSearchResults = session.context.lastRoomSearchResults;
      console.log(`✅ Restored lastRoomSearchResults from session (ONLY PLACE - BEFORE parseIntent):`, {
        count: context.lastRoomSearchResults.length,
        rooms: context.lastRoomSearchResults.map(r => ({ id: r._id, name: r.name }))
      });
    } else {
      console.log('ℹ️ No lastRoomSearchResults in session to restore', {
        hasSession: !!session,
        hasContext: !!session?.context,
        sessionContextKeys: session?.context ? Object.keys(session.context) : []
      });
    }
    
    // ✅ QUAN TRỌNG: Đảm bảo selectedRoom được restore từ session
    if (session?.context?.selectedRoom) {
      context.selectedRoom = session.context.selectedRoom;
      console.log(`📋 Restored selectedRoom: ${context.selectedRoom.name} (${context.selectedRoom.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm)`);
      
      // ✅ Nếu đã có selectedRoom, restore vào bookingContext luôn
      if (!bookingContext.roomId) {
        bookingContext.roomId = context.selectedRoom._id;
        bookingContext.roomName = context.selectedRoom.name;
        bookingContext.roomPrice = context.selectedRoom.pricePerNight;
        console.log(`✅ Restored selectedRoom to bookingContext: ${context.selectedRoom.name}`);
      }
    }
    
    // ✅ Restore các flag để AI biết phải hiển thị chi tiết phòng, không tìm phòng mới
    if (session?.context?.showRoomDetails) {
      context.showRoomDetails = session.context.showRoomDetails;
    }
    if (session?.context?.shouldNotSearchRooms) {
      context.shouldNotSearchRooms = session.context.shouldNotSearchRooms;
    }
    
    // ✅ AUTO-DETECT LANGUAGE từ user message nếu chưa có trong context
    let detectedLanguage = context.language;
    if (!detectedLanguage || (detectedLanguage !== 'vi' && detectedLanguage !== 'en')) {
      detectedLanguage = detectLanguage(message.trim());
      console.log(`🌐 Auto-detected language: ${detectedLanguage} from message: "${message.substring(0, 50)}..."`);
      
      // Update vào context và session
      if (session) {
        if (!session.context) {
          session.context = {};
        }
        session.context.language = detectedLanguage;
        await session.save();
        context.language = detectedLanguage;
      }
    }
    
    // ✅ Cập nhật language nếu được gửi từ frontend (override auto-detect)
    if (language && (language === 'vi' || language === 'en')) {
      if (session) {
        if (!session.context) {
          session.context = {};
        }
        session.context.language = language;
        await session.save();
        context.language = language;
      } else {
        // Nếu chưa có session, tạo mới với language
        currentSessionId = generateSessionId();
        session = await ChatSession.create({
          sessionId: currentSessionId,
          userId: (req.user && req.user._id) ? req.user._id : null,
          context: {
            platform: "web",
            language: language
          },
          platform: "web"
        });
        context.language = language;
      }
    }
    
    // Kiểm tra nếu session đang ở human mode
    // Nếu là human mode, cho phép cả admin và user gửi tin nhắn (không chặn)
    // Nếu là bot mode và user là admin, thì chặn admin chat với bot
    if (!session || session.chatType !== 'human') {
      // Chỉ chặn admin khi đang chat với bot (không phải human mode)
      if (req.user && req.user.role === "admin") {
        console.log('🚫 chatWithAI - Blocked admin from chatting with bot:', req.user.email);
        return res.status(403).json({
          success: false,
          message: "Admin không thể chat với bot. Vui lòng sử dụng Admin Chat để quản lý tin nhắn từ khách hàng."
        });
      }
    }
    
    // Debug: Log user info nếu có
    if (req.user) {
      console.log('✅ chatWithAI - User info:', {
        email: req.user.email,
        role: req.user.role,
        id: req.user._id,
        chatType: session?.chatType || 'bot'
      });
    }
    
    // Cập nhật userId nếu session chưa có userId nhưng user đã đăng nhập
    const userId = (req.user && req.user._id) ? req.user._id : null;
    
    if (session) {
      if (!session.userId && userId) {
        session.userId = userId;
        await session.save();
        console.log('✅ chatWithAI - Linked session to user:', req.user?.email || userId);
      } else if (session.userId && userId && session.userId.toString() !== userId.toString()) {
        // Nếu userId khác nhau, update lại (trường hợp user đổi account)
        session.userId = userId;
        await session.save();
        console.log('✅ chatWithAI - Updated session userId for:', req.user?.email || userId);
      }
    }
    
    // Lấy lịch sử hội thoại để AI có context
    const conversationHistory = await ChatMessage.find({ sessionId: currentSessionId })
      .sort({ timestamp: 1 })
      .limit(10)
      .select("message sender")
      .lean();
    
    // ✅ Parse booking intent từ user message
    const bookingIntent = parseBookingIntent(message.trim(), context);
    
    // ✅ Log để debug
    console.log(`🔍 Parsed booking intent:`, {
      action: bookingIntent.action,
      roomNumber: bookingIntent.roomNumber,
      hasLastRoomSearchResults: !!context.lastRoomSearchResults,
      lastRoomSearchResultsCount: context.lastRoomSearchResults?.length || 0
    });
    
    let bookingLink = null; // Link đến form đặt phòng với dữ liệu đã được điền sẵn
    let paymentLink = null; // Link thanh toán dựa trên booking đã tạo
    
    // ✅ QUAN TRỌNG: bookingContext đã được khai báo và restore từ session ở trên
    // Không cần khai báo lại, chỉ cần đảm bảo nó là object hợp lệ
    if (!bookingContext || typeof bookingContext !== 'object') {
      bookingContext = {};
    }
    
    // --- Restore selectedRoom & sync with bookingContext ---
    if (!context.selectedRoom && session?.context?.selectedRoom) {
      context.selectedRoom = session.context.selectedRoom;
      console.log('Restore selectedRoom from session at top:', {
        roomId: context.selectedRoom._id,
        name: context.selectedRoom.name,
      });
    }

    // ❌ ĐÃ XÓA: Restore lastRoomSearchResults trùng lặp (đã restore ở trên rồi)

    if (!bookingContext || typeof bookingContext !== 'object') {
      bookingContext = {};
    }

    if (context.selectedRoom) {
      bookingContext.roomId = bookingContext.roomId || context.selectedRoom._id;
      bookingContext.roomName = bookingContext.roomName || context.selectedRoom.name;
      bookingContext.roomPrice = bookingContext.roomPrice || context.selectedRoom.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
    }
    // --- end restore ---
    
    // ✅ QUAN TRỌNG: Khai báo roomsData và hasRooms TRƯỚC khi xử lý select_room để có thể thêm phòng vào
    let roomsData = null;
    let hasRooms = false;
    
    // ✅ Debug: Kiểm tra bookingContext trước khi parse intent
    console.log('🔍 bookingContext before parsing intent:', {
      roomId: bookingContext.roomId,
      roomName: bookingContext.roomName,
      hasSelectedRoom: !!context.selectedRoom,
      selectedRoomId: context.selectedRoom?._id
    });

    // ✅ Cập nhật dates từ bookingIntent nếu có
    if (bookingIntent.checkInDate) {
      bookingContext.checkInDate = bookingIntent.checkInDate;
    }
    if (bookingIntent.checkOutDate) {
      bookingContext.checkOutDate = bookingIntent.checkOutDate;
    }
    if (bookingIntent.nights) {
      bookingContext.nights = bookingIntent.nights;
    }
    // ✅ Cập nhật số người từ bookingIntent nếu có
    if (bookingIntent.maxOccupancy) {
      bookingContext.guests = bookingIntent.maxOccupancy;
      bookingContext.maxOccupancy = bookingIntent.maxOccupancy;
    }
    
    // ✅ Cập nhật thông tin người lớn và trẻ em từ bookingIntent nếu có
    if (bookingIntent.adults) {
      bookingContext.adults = bookingIntent.adults;
    }
    if (bookingIntent.children && bookingIntent.children.length > 0) {
      bookingContext.children = bookingIntent.children;
      console.log(`👶 Parsed children info: ${bookingIntent.children.length} children`, bookingIntent.children);
    }
    
    // ✅ Cập nhật thông tin cá nhân từ bookingIntent nếu có
    if (bookingIntent.fullName) {
      bookingContext.fullName = bookingIntent.fullName;
    }
    if (bookingIntent.email) {
      bookingContext.email = bookingIntent.email;
    }
    if (bookingIntent.phone) {
      bookingContext.phone = bookingIntent.phone;
    }
    const hasAllPersonalInfo = Boolean(
      bookingContext.fullName &&
      bookingContext.email &&
      bookingContext.phone
    );
    bookingContext.needPersonalInfo = !hasAllPersonalInfo;
    
    // ✅ LƯU Ý: Logic auto-search đã được di chuyển vào getAIResponse function (dòng 1056-1103)
    // để tránh lỗi scope với roomSearchResults
    
    // ✅ Xử lý khi user xác nhận đặt phòng
    if (bookingIntent.action === 'confirm_booking' && bookingIntent.confirmBooking) {
      bookingContext.confirmBooking = true;
      console.log('✅ User confirmed booking');
    }
    
    // ✅ Xử lý khi user nói "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này"
    // Đây là yêu cầu xác nhận và hiển thị chi tiết phòng đã chọn, KHÔNG tìm phòng mới
    if (bookingIntent.action === 'confirm_room_selection') {
      // ✅ QUAN TRỌNG: Restore selectedRoom từ session nếu chưa có trong context
      if (!context.selectedRoom && session?.context?.selectedRoom) {
        context.selectedRoom = session.context.selectedRoom;
        console.log(`✅ Restored selectedRoom from session (confirm_room_selection): ${context.selectedRoom.name}`);
      }
      
      if (context.selectedRoom || session?.context?.selectedRoom) {
        // ✅ QUAN TRỌNG: Luôn sử dụng selectedRoom từ context hoặc session
        const selectedRoomToUse = context.selectedRoom || session.context.selectedRoom;
        
        // ✅ QUAN TRỌNG: LUÔN gán vào bookingContext khi có selectedRoom
        bookingContext.roomId = selectedRoomToUse._id;
        bookingContext.roomName = selectedRoomToUse.name;
        bookingContext.roomPrice = selectedRoomToUse.pricePerNight;
          bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
        
        // ✅ Đảm bảo context.selectedRoom được set
        if (!context.selectedRoom) {
          context.selectedRoom = selectedRoomToUse;
        }
        
        console.log(`✅ User confirmed room selection: ${selectedRoomToUse.name}`, {
          roomId: bookingContext.roomId,
          roomName: bookingContext.roomName,
          roomPrice: bookingContext.roomPrice
        });
        
        // Đánh dấu để AI biết phải hiển thị chi tiết phòng, không tìm phòng mới
        context.showRoomDetails = true;
        context.shouldNotSearchRooms = true;
        
        // ✅ QUAN TRỌNG: Đảm bảo selectedRoom được lưu vào session ngay lập tức
        if (session) {
          if (!session.context) session.context = {};
          session.context.selectedRoom = context.selectedRoom;
          session.context.bookingContext = bookingContext;
          await session.save();
          console.log(`✅ Saved selectedRoom to session (confirm_room_selection): ${context.selectedRoom.name}`, {
            roomId: context.selectedRoom._id,
            bookingContextRoomId: bookingContext.roomId
          });
        }
        
        // ✅ QUAN TRỌNG: Thêm phòng đã chọn vào roomsData NGAY LẬP TỨC để hiển thị card
        try {
          const selectedRoomId = selectedRoomToUse._id.toString ? selectedRoomToUse._id.toString() : String(selectedRoomToUse._id);
          
          // Tìm phòng đầy đủ từ database hoặc lastRoomSearchResults để lấy image và amenities
          let fullSelectedRoom = selectedRoomToUse;
          
          // Nếu selectedRoomToUse chưa có đầy đủ thông tin, tìm từ database
          if (!fullSelectedRoom.image && !fullSelectedRoom.thumbnailUrl) {
            try {
              const dbRoom = await Room.findById(selectedRoomId);
              if (dbRoom) {
                fullSelectedRoom = dbRoom;
              }
            } catch (dbError) {
              console.error('❌ Error finding room from database (confirm_room_selection):', dbError);
            }
          }
          
          // Tìm từ lastRoomSearchResults nếu có
          if ((!fullSelectedRoom.image && !fullSelectedRoom.thumbnailUrl) && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
            const foundRoom = context.lastRoomSearchResults.find(r => {
              if (!r || !r._id) return false;
              const roomIdStr = r._id.toString ? r._id.toString() : String(r._id);
              return roomIdStr === selectedRoomId;
            });
            if (foundRoom) {
              fullSelectedRoom = foundRoom;
            }
          }
          
          // Tạo room card với đầy đủ thông tin
          const selectedRoomCard = {
            id: selectedRoomId,
            name: (fullSelectedRoom && fullSelectedRoom.name) || bookingContext.roomName || 'Phòng đã chọn',
            roomType: (fullSelectedRoom && fullSelectedRoom.roomType) || 'Standard',
            pricePerNight: (fullSelectedRoom && fullSelectedRoom.pricePerNight) || bookingContext.roomPrice || 0,
            maxOccupancy: (fullSelectedRoom && fullSelectedRoom.maxOccupancy) || 2,
            view: (fullSelectedRoom && fullSelectedRoom.view) || 'N/A',
            image: (fullSelectedRoom && fullSelectedRoom.image) || (fullSelectedRoom && fullSelectedRoom.thumbnailUrl) || '', // Đảm bảo không null
            amenities: (fullSelectedRoom && Array.isArray(fullSelectedRoom.amenities) && fullSelectedRoom.amenities) || []
          };
          
          // ✅ QUAN TRỌNG: Thay thế roomsData bằng chỉ phòng đã chọn (hoặc thêm vào đầu nếu chưa có)
          if (!roomsData || !Array.isArray(roomsData)) {
            roomsData = [selectedRoomCard];
          } else {
            // Kiểm tra xem phòng đã chọn đã có trong roomsData chưa
            const roomExists = roomsData.some(r => {
              const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
              return roomIdStr === selectedRoomId;
            });
            
            if (!roomExists) {
              // Thêm phòng đã chọn vào đầu danh sách
              roomsData.unshift(selectedRoomCard);
            } else {
              // Nếu đã có, di chuyển nó lên đầu
              const existingIndex = roomsData.findIndex(r => {
                const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
                return roomIdStr === selectedRoomId;
              });
              if (existingIndex > 0) {
                const existingRoom = roomsData.splice(existingIndex, 1)[0];
                roomsData.unshift(existingRoom);
              }
            }
          }
          
          hasRooms = true;
          
          console.log('✅ Added selected room to roomsData immediately (confirm_room_selection):', {
            roomId: selectedRoomId,
            roomName: selectedRoomCard.name,
            hasImage: !!selectedRoomCard.image,
            amenitiesCount: selectedRoomCard.amenities.length,
            roomsDataLength: roomsData.length
          });
        } catch (addRoomError) {
          console.error('❌ Error adding selected room to roomsData (confirm_room_selection):', addRoomError);
        }
        
        // ✅ QUAN TRỌNG: Kiểm tra thông tin cá nhân
        // Nếu chưa có đủ thông tin cá nhân, đánh dấu để AI hỏi
        if (!hasAllPersonalInfo) {
          bookingContext.needPersonalInfo = true;
          console.log('⚠️ User wants to book but missing personal info, need to ask');
        } else {
          // Đã có đủ thông tin, có thể tạo booking hoặc gửi link đặt phòng
          bookingContext.needPersonalInfo = false;
          console.log('✅ User has all personal info, can proceed with booking');
        }
      } else if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        // Chưa có selectedRoom nhưng có list phòng, hỏi user muốn chọn phòng số mấy
        context.needRoomSelection = true;
        console.log('⚠️ User wants to confirm room but no room selected yet, need to ask which room');
      } else {
        // Chưa có cả selectedRoom và list phòng, cần tìm phòng
        context.needRoomSearch = true;
        console.log('⚠️ User wants to confirm room but no room info, need to search rooms');
      }
    }
    
    // ✅ QUAN TRỌNG: Nếu đã có selectedRoom trong context hoặc session, LUÔN gán vào bookingContext
    if (context.selectedRoom || session?.context?.selectedRoom) {
      const selectedRoomToUse = context.selectedRoom || session.context.selectedRoom;
      bookingContext.roomId = selectedRoomToUse._id;
      bookingContext.roomName = selectedRoomToUse.name;
      bookingContext.roomPrice = selectedRoomToUse.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
      console.log(`✅ Restored selectedRoom to bookingContext: ${selectedRoomToUse.name}`);
    }

    // Nếu user chọn phòng từ danh sách (phòng 1, phòng 2, etc.)
    if (bookingIntent.action === 'select_room' && bookingIntent.roomNumber) {
      // Lấy danh sách phòng từ context hoặc tìm lại
      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        const selectedRoomIndex = bookingIntent.roomNumber - 1;
        
        // ✅ QUAN TRỌNG: Log toàn bộ lastRoomSearchResults để debug thứ tự
        console.log(`🔍 User selected room #${bookingIntent.roomNumber} (index ${selectedRoomIndex}):`, {
          totalRooms: context.lastRoomSearchResults.length,
          allRooms: context.lastRoomSearchResults.map((r, idx) => ({
            number: idx + 1,
            index: idx,
            roomId: r._id,
            name: r.name,
            price: r.pricePerNight
          }))
        });
        
        if (selectedRoomIndex >= 0 && selectedRoomIndex < context.lastRoomSearchResults.length) {
          const selectedRoom = context.lastRoomSearchResults[selectedRoomIndex];
          
          // ✅ Log để debug - xác nhận phòng được lấy đúng
          console.log(`✅ Selected room from lastRoomSearchResults:`, {
            requestedNumber: bookingIntent.roomNumber,
            actualIndex: selectedRoomIndex,
            roomId: selectedRoom._id,
            name: selectedRoom.name,
            price: selectedRoom.pricePerNight,
            roomType: selectedRoom.roomType,
            matchesRequest: true
          });
          
          bookingContext.roomId = selectedRoom._id.toString();
          bookingContext.roomName = selectedRoom.name;
          bookingContext.roomPrice = selectedRoom.pricePerNight;
          bookingContext.roomQuantity = bookingIntent.roomQuantity || 1;
          
          // ✅ Lưu thông tin phòng đã chọn vào context để AI biết
          context.selectedRoom = {
            _id: selectedRoom._id.toString(),
            name: selectedRoom.name,
            pricePerNight: selectedRoom.pricePerNight,
            roomType: selectedRoom.roomType,
            maxOccupancy: selectedRoom.maxOccupancy,
            view: selectedRoom.view || 'N/A'
          };
          
          // ✅ QUAN TRỌNG: Lưu selectedRoom vào session NGAY LẬP TỨC
          if (session) {
            if (!session.context) session.context = {};
            session.context.selectedRoom = context.selectedRoom;
            session.context.bookingContext = bookingContext;
            await session.save();
            console.log(`✅ Saved selectedRoom to session (select_room): ${context.selectedRoom.name}`, {
              roomId: context.selectedRoom._id,
              bookingContextRoomId: bookingContext.roomId
            });
            
            // ✅ QUAN TRỌNG: Verify saved data bằng cách reload session
            const verifySession = await ChatSession.findOne({ sessionId: currentSessionId });
            console.log(`✅ Verified saved selectedRoom in session:`, {
              hasSelectedRoom: !!verifySession?.context?.selectedRoom,
              selectedRoomName: verifySession?.context?.selectedRoom?.name,
              selectedRoomId: verifySession?.context?.selectedRoom?._id,
              hasBookingContext: !!verifySession?.context?.bookingContext,
              bookingContextRoomId: verifySession?.context?.bookingContext?.roomId
            });
          } else {
            console.warn('⚠️ No session when saving selectedRoom!');
          }
          
          // ✅ QUAN TRỌNG: Thêm phòng đã chọn vào roomsData NGAY LẬP TỨC để hiển thị card
          try {
            const selectedRoomId = selectedRoom._id.toString ? selectedRoom._id.toString() : String(selectedRoom._id);
            
            // ✅ Nếu selectedRoom từ lastRoomSearchResults thiếu thông tin, tìm lại từ database
            let fullSelectedRoom = selectedRoom;
            if ((!selectedRoom.image && !selectedRoom.thumbnailUrl) || !Array.isArray(selectedRoom.amenities)) {
              try {
                const dbRoom = await Room.findById(selectedRoomId);
                if (dbRoom) {
                  fullSelectedRoom = dbRoom;
                  console.log('✅ Found full room data from database (select_room):', {
                    roomId: selectedRoomId,
                    hasImage: !!dbRoom.image,
                    amenitiesCount: Array.isArray(dbRoom.amenities) ? dbRoom.amenities.length : 0
                  });
                }
              } catch (dbError) {
                console.error('❌ Error finding room from database (select_room):', dbError);
              }
            }
            
            // Tạo room card với đầy đủ thông tin
            const selectedRoomCard = {
              id: selectedRoomId,
              name: (fullSelectedRoom && fullSelectedRoom.name) || selectedRoom.name || bookingContext.roomName || 'Phòng đã chọn',
              roomType: (fullSelectedRoom && fullSelectedRoom.roomType) || selectedRoom.roomType || 'Standard',
              pricePerNight: (fullSelectedRoom && fullSelectedRoom.pricePerNight) || selectedRoom.pricePerNight || bookingContext.roomPrice || 0,
              maxOccupancy: (fullSelectedRoom && fullSelectedRoom.maxOccupancy) || selectedRoom.maxOccupancy || 2,
              view: (fullSelectedRoom && fullSelectedRoom.view) || selectedRoom.view || 'N/A',
              image: (fullSelectedRoom && (fullSelectedRoom.image || fullSelectedRoom.thumbnailUrl)) || selectedRoom.image || selectedRoom.thumbnailUrl || '', // Đảm bảo không null
              amenities: (fullSelectedRoom && Array.isArray(fullSelectedRoom.amenities) && fullSelectedRoom.amenities) || (Array.isArray(selectedRoom.amenities) && selectedRoom.amenities) || []
            };
            
            // ✅ QUAN TRỌNG: Thay thế roomsData bằng chỉ phòng đã chọn (hoặc thêm vào đầu nếu chưa có)
            if (!roomsData || !Array.isArray(roomsData)) {
              roomsData = [selectedRoomCard];
            } else {
              // Kiểm tra xem phòng đã chọn đã có trong roomsData chưa
              const roomExists = roomsData.some(r => {
                const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
                return roomIdStr === selectedRoomId;
              });
              
              if (!roomExists) {
                // Thêm phòng đã chọn vào đầu danh sách
                roomsData.unshift(selectedRoomCard);
              } else {
                // Nếu đã có, di chuyển nó lên đầu
                const existingIndex = roomsData.findIndex(r => {
                  const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
                  return roomIdStr === selectedRoomId;
                });
                if (existingIndex > 0) {
                  const existingRoom = roomsData.splice(existingIndex, 1)[0];
                  roomsData.unshift(existingRoom);
                }
              }
            }
            
            hasRooms = true;
            
            console.log('✅ Added selected room to roomsData immediately (select_room):', {
              requestedNumber: bookingIntent.roomNumber,
              selectedIndex: selectedRoomIndex,
              roomId: selectedRoomId,
              roomName: selectedRoomCard.name,
              hasImage: !!selectedRoomCard.image,
              amenitiesCount: selectedRoomCard.amenities.length,
              roomsDataLength: roomsData.length,
              // ✅ Verify: So sánh với phòng trong lastRoomSearchResults
              expectedRoom: context.lastRoomSearchResults[selectedRoomIndex]?.name,
              actualRoom: selectedRoomCard.name,
              matches: context.lastRoomSearchResults[selectedRoomIndex]?.name === selectedRoomCard.name
            });
          } catch (addRoomError) {
            console.error('❌ Error adding selected room to roomsData (select_room):', addRoomError);
          }
          
          // ✅ Clear các flag không cần thiết khi đã chọn được phòng từ list
          context.noRoomList = false;
          context.requestedRoomNumber = null;
          context.invalidRoomSelection = null;
        } else {
          // ✅ Phòng không hợp lệ - lưu vào context để AI biết và trả lời user
          console.warn(`⚠️ Invalid room selection: ${bookingIntent.roomNumber} (only ${context.lastRoomSearchResults.length} rooms available)`);
          context.invalidRoomSelection = {
            requestedRoom: bookingIntent.roomNumber,
            availableRooms: context.lastRoomSearchResults.length,
            rooms: context.lastRoomSearchResults.map((r, idx) => ({
              number: idx + 1,
              name: r.name,
              price: r.pricePerNight
            }))
          };
        }
      } else {
        // ✅ Không có danh sách phòng trong context
        console.warn('⚠️ No lastRoomSearchResults in context when user selected room');
        context.noRoomList = true;
        // ✅ Lưu roomNumber vào context để AI biết khách muốn chọn phòng số mấy
        context.requestedRoomNumber = bookingIntent.roomNumber;
      }
    }
    
    // ✅ Lưu bookingContext vào session (bao gồm tất cả thông tin booking)
    // ✅ QUAN TRỌNG: LUÔN lưu lastRoomSearchResults vào session nếu có (KHÔNG CẦN ĐIỀU KIỆN)
    if (session) {
      if (!session.context) session.context = {};
      
      // ✅ QUAN TRỌNG: LUÔN giữ lại lastRoomSearchResults (ưu tiên từ context, fallback từ session)
      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        // Có dữ liệu mới trong context, lưu vào session
        session.context.lastRoomSearchResults = context.lastRoomSearchResults;
        console.log('💾 Saving lastRoomSearchResults to session (before bookingContext save):', {
          count: context.lastRoomSearchResults.length,
          rooms: context.lastRoomSearchResults.map(r => ({ id: r._id, name: r.name }))
        });
      } else if (session.context.lastRoomSearchResults && !context.lastRoomSearchResults) {
        // Context không có nhưng session có, restore lại vào context để không mất dữ liệu
        context.lastRoomSearchResults = session.context.lastRoomSearchResults;
        console.log('✅ Restored lastRoomSearchResults from session (during save):', {
          count: context.lastRoomSearchResults.length
        });
      }
      // Nếu cả context và session đều có, giữ lại từ context (dữ liệu mới hơn)
    }
    
    // ✅ Lưu bookingContext vào session (chỉ khi có thông tin booking)
    if (session && (bookingContext.roomId || bookingContext.checkInDate || bookingContext.checkOutDate || 
        context.selectedRoom || context.requestedRoomNumber || bookingContext.confirmBooking || 
        bookingContext.fullName || bookingContext.email || bookingContext.phone || 
        bookingContext.bookingCreated || bookingContext.bookingError || bookingContext.needPersonalInfo ||
        context.showRoomDetails || context.shouldNotSearchRooms)) {
      if (!session.context) session.context = {};
      session.context.bookingContext = bookingContext;
      // ✅ Lưu selectedRoom vào session để AI biết phòng đã chọn
      if (context.selectedRoom) {
        session.context.selectedRoom = context.selectedRoom;
      }
      // ✅ Lưu requestedRoomNumber vào session để AI biết khách muốn chọn phòng số mấy
      if (context.requestedRoomNumber) {
        session.context.requestedRoomNumber = context.requestedRoomNumber;
      }
      // ✅ Lưu noRoomList vào session
      if (context.noRoomList) {
        session.context.noRoomList = context.noRoomList;
      }
      // ✅ Lưu các flag để AI biết phải hiển thị chi tiết phòng, không tìm phòng mới
      if (context.showRoomDetails) {
        session.context.showRoomDetails = context.showRoomDetails;
      }
      if (context.shouldNotSearchRooms) {
        session.context.shouldNotSearchRooms = context.shouldNotSearchRooms;
      }
      
      // ✅ QUAN TRỌNG: Đảm bảo lastRoomSearchResults được lưu vào session (nếu có trong context)
      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        session.context.lastRoomSearchResults = context.lastRoomSearchResults;
      }
      
      // ✅ QUAN TRỌNG: Mark session as modified để đảm bảo context được lưu
      session.markModified('context');
      await session.save();
      context.bookingContext = bookingContext;
      
      // ✅ Debug: Verify lastRoomSearchResults đã được lưu
      console.log('💾 Saved session (bookingContext block):', {
        hasLastRoomSearchResults: !!session.context.lastRoomSearchResults,
        lastRoomSearchResultsCount: session.context.lastRoomSearchResults?.length || 0
      });
    }

    // ✅ Tính tổng giá nếu có đủ thông tin (roomId + dates)
    if (bookingContext.roomId && bookingContext.checkInDate && bookingContext.checkOutDate) {
      const checkIn = new Date(bookingContext.checkInDate);
      const checkOut = new Date(bookingContext.checkOutDate);
      const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
      const roomPrice = bookingContext.roomPrice || context.selectedRoom?.pricePerNight || 0;
      const roomQuantity = bookingContext.roomQuantity || 1;
      
      // ✅ Tính tổng giá với phụ thu trẻ em (nếu có)
      const adults = bookingContext.adults || bookingContext.guests || 1;
      const children = bookingContext.children || [];
      
      const priceCalculation = calculateTotalPriceWithChildSurcharge(
        roomPrice,
        nights,
        roomQuantity,
        adults,
        children
      );
      
      bookingContext.totalPrice = priceCalculation.totalPrice;
      bookingContext.baseTotal = priceCalculation.baseTotal;
      bookingContext.childSurcharge = priceCalculation.childSurcharge;
      bookingContext.nights = nights;
      
      if (priceCalculation.childSurcharge > 0) {
        console.log(`💰 Calculated total price: ${bookingContext.totalPrice.toLocaleString('vi-VN')} VNĐ (${nights} nights x ${roomQuantity} rooms)`);
        console.log(`   - Base: ${priceCalculation.baseTotal.toLocaleString('vi-VN')} VNĐ`);
        console.log(`   - Child surcharge: ${priceCalculation.childSurcharge.toLocaleString('vi-VN')} VNĐ`);
      } else {
      console.log(`💰 Calculated total price: ${bookingContext.totalPrice.toLocaleString('vi-VN')} VNĐ (${nights} nights x ${roomQuantity} rooms)`);
      }
    }
    
    // ✅ Xác định các thông tin còn thiếu
    const missingFields = [];
    if (!bookingContext.checkInDate || !bookingContext.checkOutDate) {
      missingFields.push('dates');
    }
    if (!bookingContext.guests) {
      missingFields.push('guests');
    }
    if (!bookingContext.fullName) {
      missingFields.push('fullName');
    }
    if (!bookingContext.email) {
      missingFields.push('email');
    }
    if (!bookingContext.phone) {
      missingFields.push('phone');
    }
    bookingContext.missingFields = missingFields;

    // ✅ Nếu đã có đủ thông tin (phòng, ngày, số khách, giá, thông tin cá nhân) thì tự động xác nhận để tạo booking
    const readyForAutoBooking = bookingContext.roomId &&
      bookingContext.checkInDate &&
      bookingContext.checkOutDate &&
      bookingContext.guests &&
      bookingContext.totalPrice &&
      bookingContext.fullName &&
      bookingContext.email &&
      bookingContext.phone;
    if (readyForAutoBooking && !bookingContext.bookingCreated) {
      bookingContext.confirmBooking = true;
    }
    
    // ✅ Nếu user xác nhận đặt phòng và có đủ thông tin, tạo booking trực tiếp
    if (bookingContext.confirmBooking && bookingContext.roomId && 
        bookingContext.checkInDate && bookingContext.checkOutDate && 
        bookingContext.totalPrice) {
      
      // Kiểm tra xem có đủ thông tin cá nhân không (nếu user chưa đăng nhập)
      const hasPersonalInfo = bookingContext.fullName && bookingContext.email && bookingContext.phone;
      const hasUserId = userId; // User đã đăng nhập
      
      if (hasUserId) {
        // ✅ User đã đăng nhập - tạo booking trực tiếp
        try {
          const checkIn = new Date(bookingContext.checkInDate);
          const checkOut = new Date(bookingContext.checkOutDate);
          
          // Kiểm tra phòng có trống không
          const overlappingBooking = await Booking.findOne({
            room: bookingContext.roomId,
            status: { $in: ['pending', 'confirmed'] },
            $or: [
              {
                checkInDate: { $lt: checkOut },
                checkOutDate: { $gt: checkIn },
              },
            ],
          });
          
          if (overlappingBooking) {
            bookingContext.bookingError = 'Phòng đã được đặt trong khoảng thời gian này. Bạn có muốn tôi tìm phòng khác không?';
            console.warn('⚠️ Room already booked');
          } else {
            // Tạo booking
            const newBooking = await Booking.create({
              user: userId,
              room: bookingContext.roomId,
              checkInDate: checkIn,
              checkOutDate: checkOut,
              totalPrice: bookingContext.totalPrice,
              roomQuantity: bookingContext.roomQuantity || 1,
              note: bookingContext.note || '',
              promotion: bookingContext.promotionId || null,
              discountAmount: bookingContext.discountAmount || 0,
              status: 'pending'
            });
            
            // Tăng usageCount của promotion nếu có
            if (bookingContext.promotionId) {
              const Promotion = (await import('../Models/PromotionModel.js')).default;
              await Promotion.findByIdAndUpdate(bookingContext.promotionId, {
                $inc: { usageCount: 1 }
              });
            }
            
            bookingContext.bookingId = newBooking._id.toString();
            bookingContext.bookingCreated = true;
            bookingContext.needPersonalInfo = false;
            bookingContext.needLogin = false;
            
            // Tạo link thanh toán
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            paymentLink = `${baseUrl}/payment?bookingId=${newBooking._id}`;
            console.log('✅ Booking created successfully:', newBooking._id);
            console.log('✅ Payment link:', paymentLink);
          }
        } catch (error) {
          console.error('❌ Error creating booking:', error);
          bookingContext.bookingError = error.message || 'Lỗi khi tạo booking';
        }
      } else if (hasPersonalInfo) {
        // ✅ User chưa đăng nhập nhưng có đủ thông tin cá nhân - tạo user tạm và booking trực tiếp
        try {
          const User = (await import('../Models/UserModel.js')).default;
          const bcrypt = (await import('bcryptjs')).default;
          
          // Kiểm tra xem email đã tồn tại chưa
          let tempUser = await User.findOne({ email: bookingContext.email });
          
          if (!tempUser) {
            // Tạo user tạm với password ngẫu nhiên
            const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            
            tempUser = await User.create({
              fullName: bookingContext.fullName,
              email: bookingContext.email,
              phone: bookingContext.phone,
              password: hashedPassword,
              role: 'user'
            });
            
            console.log('✅ Created temporary user:', tempUser._id);
            bookingContext.tempUserCreated = true;
            bookingContext.tempUserPassword = randomPassword; // Lưu để có thể gửi cho user sau
          } else {
            console.log('✅ User already exists:', tempUser._id);
            bookingContext.tempUserCreated = false;
          }
          
          // Tạo booking với user tạm
          const checkIn = new Date(bookingContext.checkInDate);
          const checkOut = new Date(bookingContext.checkOutDate);
          
          // Kiểm tra phòng có trống không
          const overlappingBooking = await Booking.findOne({
            room: bookingContext.roomId,
            status: { $in: ['pending', 'confirmed'] },
            $or: [
              {
                checkInDate: { $lt: checkOut },
                checkOutDate: { $gt: checkIn },
              },
            ],
          });
          
          if (overlappingBooking) {
            bookingContext.bookingError = 'Phòng đã được đặt trong khoảng thời gian này. Bạn có muốn tôi tìm phòng khác không?';
            console.warn('⚠️ Room already booked');
          } else {
            // Tạo booking
            const newBooking = await Booking.create({
              user: tempUser._id,
              room: bookingContext.roomId,
              checkInDate: checkIn,
              checkOutDate: checkOut,
              totalPrice: bookingContext.totalPrice,
              roomQuantity: bookingContext.roomQuantity || 1,
              note: bookingContext.note || '',
              promotion: bookingContext.promotionId || null,
              discountAmount: bookingContext.discountAmount || 0,
              status: 'pending'
            });
            
            // Tăng usageCount của promotion nếu có
            if (bookingContext.promotionId) {
              const Promotion = (await import('../Models/PromotionModel.js')).default;
              await Promotion.findByIdAndUpdate(bookingContext.promotionId, {
                $inc: { usageCount: 1 }
              });
            }
            
            bookingContext.bookingId = newBooking._id.toString();
            bookingContext.bookingCreated = true;
            bookingContext.tempUserId = tempUser._id.toString();
            bookingContext.needPersonalInfo = false;
            bookingContext.needLogin = false;
            
            // Tạo link thanh toán
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            paymentLink = `${baseUrl}/payment?bookingId=${newBooking._id}`;
            console.log('✅ Booking created successfully for guest user:', newBooking._id);
            console.log('✅ Payment link:', paymentLink);
          }
        } catch (error) {
          console.error('❌ Error creating booking for guest:', error);
          bookingContext.bookingError = error.message || 'Lỗi khi tạo booking';
        }
      } else {
        // Chưa có đủ thông tin cá nhân, lưu vào context để AI hỏi
        bookingContext.needPersonalInfo = true;
        console.log('⚠️ Need personal info to create booking');
      }
    }
    
    // ✅ QUAN TRỌNG: Restore selectedRoom vào bookingContext TRƯỚC khi tạo link
    // Đảm bảo bookingContext.roomId luôn có giá trị nếu có selectedRoom
    if (context.selectedRoom && !bookingContext.roomId) {
      bookingContext.roomId = context.selectedRoom._id;
      bookingContext.roomName = context.selectedRoom.name;
      bookingContext.roomPrice = context.selectedRoom.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
      console.log(`✅ Restored selectedRoom to bookingContext (before link creation): ${context.selectedRoom.name}`);
    }
    
    // ✅ Debug: Kiểm tra trạng thái trước khi tạo link
    console.log('🔍 Before creating links:', {
      hasBookingContextRoomId: !!bookingContext.roomId,
      hasContextSelectedRoom: !!context.selectedRoom,
      selectedRoomId: context.selectedRoom?._id,
      selectedRoomName: context.selectedRoom?.name,
      bookingLink: bookingLink,
      bookingContextRoomId: bookingContext.roomId,
      bookingIntentAction: bookingIntent.action,
      hasLastRoomSearchResults: !!context.lastRoomSearchResults
    });
    
    // ✅ Tạo booking link nếu chưa có (fallback - khi chưa tạo booking trực tiếp)
    // QUAN TRỌNG: CHỈ tạo link khi khách ĐÃ CHỌN PHÒNG (có selectedRoom hoặc bookingContext.roomId)
    // KHÔNG tạo link khi chỉ có list phòng gợi ý (rooms array) mà chưa chọn phòng
    const roomIdForBookingLink = bookingContext.roomId || context.selectedRoom?._id;
    const hasSelectedRoom = !!(context.selectedRoom || bookingContext.roomId);
    
    // ✅ QUAN TRỌNG: Không tạo link nếu chỉ có lastRoomSearchResults mà chưa có selectedRoom
    // (tức là chỉ có list gợi ý, chưa chọn phòng cụ thể)
    const shouldCreateLink = hasSelectedRoom && !(context.lastRoomSearchResults && !context.selectedRoom && !bookingContext.roomId);
    
    console.log('🔍 Link creation check:', {
      roomIdForBookingLink: roomIdForBookingLink,
      hasSelectedRoom: hasSelectedRoom,
      shouldCreateLink: shouldCreateLink,
      hasLastRoomSearchResults: !!context.lastRoomSearchResults,
      hasSelectedRoomButNoRoomId: !!(context.selectedRoom && !bookingContext.roomId)
    });
    
    // ✅ CHỈ tạo link khi đã có phòng được chọn (không phải chỉ có list gợi ý)
    if (!bookingLink && roomIdForBookingLink && shouldCreateLink) {
      const bookingData = {
        roomId: roomIdForBookingLink,
        roomQuantity: bookingContext.roomQuantity || 1,
        checkInDate: bookingIntent.checkInDate || bookingContext.checkInDate,
        checkOutDate: bookingIntent.checkOutDate || bookingContext.checkOutDate,
        guests: bookingContext.guests || bookingIntent.maxOccupancy || context.selectedRoom?.maxOccupancy,
        fullName: bookingContext.fullName,
        email: bookingContext.email,
        phone: bookingContext.phone,
        note: bookingContext.note
      };
      
      // ✅ Tạo booking link ngay khi có roomId (không cần đợi có dates)
      // Nếu có dates thì thêm vào, nếu không thì vẫn tạo link với roomId
      bookingLink = createBookingLink(bookingData);
      console.log('✅ Created booking link (early):', bookingLink);
      
      // ✅ Tạo link xem chi tiết phòng (room detail page)
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const earlyRoomDetailLink = `${baseUrl}/rooms/${roomIdForBookingLink}`;
      bookingContext.roomDetailLink = earlyRoomDetailLink;
      console.log('✅ Created room detail link (early):', earlyRoomDetailLink);
      
      // ✅ Đảm bảo bookingContext.roomId được set nếu chưa có
      if (!bookingContext.roomId) {
        bookingContext.roomId = roomIdForBookingLink;
      }
    }
    
    // Lưu tin nhắn của user
    const userMessage = await ChatMessage.create({
      sessionId: currentSessionId,
      userId: userId,
      message: message.trim(),
      sender: "user"
    });
    
    // Kiểm tra nếu session đang ở human mode (chat với nhân viên)
    // Nếu là human mode, chỉ lưu user message, không gọi AI
    if (session && session.chatType === 'human') {
      // Cập nhật session với user message
      if (session) {
        session.messages.push(userMessage._id);
        session.status = 'active'; // Đánh dấu session đang active
        await session.save();
      }
      
      // Trả về response đơn giản - tin nhắn đã được gửi
      res.status(200).json({
        success: true,
        data: {
          message: "Tin nhắn của bạn đã được gửi. Nhân viên sẽ trả lời bạn trong thời gian sớm nhất.",
          sessionId: currentSessionId,
          rooms: null,
          hasRooms: false
        }
      });
      return; // Dừng ở đây, không gọi AI
    }
    
    // Nếu là bot mode, tiếp tục xử lý với AI
    // Lấy phản hồi từ AI (với conversation history)
    const aiResponse = await getAIResponse(message.trim(), context, conversationHistory);
    
    // Extract text và rooms từ response
    const responseText = typeof aiResponse === 'string' ? aiResponse : aiResponse.text;
    const rooms = typeof aiResponse === 'object' && aiResponse.rooms ? aiResponse.rooms : null;
    
    // ✅ QUAN TRỌNG: Khai báo roomSearchResults từ rooms (vì roomSearchResults được trả về trong aiResponse.rooms)
    // roomSearchResults được sử dụng trong logic hiển thị room cards
    let roomSearchResults = null;
    if (rooms && Array.isArray(rooms) && rooms.length > 0) {
      roomSearchResults = rooms;
    }
    // ✅ hasRooms đã được khai báo ở trên, chỉ cập nhật giá trị
    hasRooms = hasRooms || (typeof aiResponse === 'object' && aiResponse.hasRooms ? aiResponse.hasRooms : false);
    
    // ✅ Lưu lastRoomSearchResults vào context nếu có (LƯU ĐẦY ĐỦ THÔNG TIN để hiển thị card)
    // ✅ QUAN TRỌNG: LUÔN lưu vào session để user có thể chọn phòng ở request tiếp theo
    // ✅ QUAN TRỌNG: GIỮ NGUYÊN THỨ TỰ như list đã hiển thị cho user
    if (rooms && rooms.length > 0 && session) {
      if (!session.context) session.context = {};
      
      // ✅ QUAN TRỌNG: Log thứ tự rooms trước khi lưu để debug
      console.log(`📋 Saving lastRoomSearchResults with order:`, {
        count: rooms.length,
        rooms: rooms.map((r, idx) => ({
          number: idx + 1,
          index: idx,
          roomId: r._id,
          name: r.name,
          price: r.pricePerNight
        }))
      });
      
      // ✅ QUAN TRỌNG: Giữ nguyên thứ tự như rooms array (không sort, không reverse)
      session.context.lastRoomSearchResults = rooms.map((r, idx) => ({
        _id: r._id,
        name: r.name,
        roomType: r.roomType,
        pricePerNight: r.pricePerNight,
        maxOccupancy: r.maxOccupancy,
        view: r.view,
        image: r.image || r.thumbnailUrl || null, // ✅ Lưu image để hiển thị card
        thumbnailUrl: r.thumbnailUrl || r.image || null, // ✅ Lưu thumbnailUrl
        amenities: Array.isArray(r.amenities) ? r.amenities : [], // ✅ Lưu amenities để hiển thị card
        _originalIndex: idx // ✅ Lưu index gốc để debug
      }));
      // ✅ QUAN TRỌNG: Mark session as modified để đảm bảo context được lưu
      session.markModified('context');
      await session.save();
      context.lastRoomSearchResults = session.context.lastRoomSearchResults;
      console.log(`✅ Saved lastRoomSearchResults to session (after AI response):`, {
        count: context.lastRoomSearchResults.length,
        rooms: context.lastRoomSearchResults.map((r, idx) => ({
          number: idx + 1,
          index: idx,
          id: r._id,
          name: r.name
        })),
        sessionId: currentSessionId
      });
      
      // ✅ QUAN TRỌNG: Verify saved data bằng cách reload session
      const verifySession = await ChatSession.findOne({ sessionId: currentSessionId });
      console.log(`✅ Verified lastRoomSearchResults saved in session:`, {
        hasLastRoomSearchResults: !!verifySession?.context?.lastRoomSearchResults,
        count: verifySession?.context?.lastRoomSearchResults?.length || 0,
        contextKeys: verifySession?.context ? Object.keys(verifySession.context) : []
      });
    } else if (rooms && rooms.length > 0 && !session) {
      console.warn('⚠️ Cannot save lastRoomSearchResults: no session available');
    } else if (!rooms || rooms.length === 0) {
      console.log('ℹ️ No rooms from AI response to save as lastRoomSearchResults');
    }
    
    // ✅ Hàm loại bỏ markdown links và các format đặc biệt khỏi text (vì frontend không render markdown và đã có room cards với buttons)
    const removeMarkdownLinks = (text) => {
      if (!text) return text;
      
      // ✅ QUAN TRỌNG: Loại bỏ các format đặc biệt như "[roomDetailLink: {...}]" hoặc "[bookingLink: {...}]"
      // Pattern: "[roomDetailLink: {...}]" hoặc "[bookingLink: {...}]" hoặc bất kỳ format tương tự
      let cleaned = text
        .replace(/\[roomDetailLink:\s*\{[^}]+\}\]/g, '') // Loại bỏ "[roomDetailLink: {...}]"
        .replace(/\[bookingLink:\s*\{[^}]+\}\]/g, '') // Loại bỏ "[bookingLink: {...}]"
        .replace(/\[paymentLink:\s*\{[^}]+\}\]/g, '') // Loại bỏ "[paymentLink: {...}]"
        .replace(/\[.*?Link:\s*\{[^}]+\}\]/g, ''); // Loại bỏ bất kỳ format "[...Link: {...}]"
      
      // ✅ Loại bỏ các code blocks (ví dụ: ```json ... ```)
      cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
      
      // Loại bỏ markdown links: [text](url) hoặc 🔍 [text](url) hoặc 📝 [text](url)
      cleaned = cleaned
        .replace(/🔍\s*\[([^\]]+)\]\([^)]+\)/g, '') // Loại bỏ "🔍 [Xem chi tiết phòng](url)"
        .replace(/📝\s*\[([^\]]+)\]\([^)]+\)/g, '') // Loại bỏ "📝 [Đặt phòng ngay](url)"
        .replace(/💳\s*\[([^\]]+)\]\([^)]+\)/g, '') // Loại bỏ "💳 [Thanh toán ngay](url)"
        .replace(/👉\s*\[([^\]]+)\]\([^)]+\)/g, '') // Loại bỏ "👉 [View Booking](url)"
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '') // Loại bỏ các markdown links khác [text](url)
        .replace(/✅\s*Tôi đã chuẩn bị các link sau cho bạn:\s*/g, '') // Loại bỏ text giới thiệu links
        .replace(/✅\s*I've prepared the following links for you:\s*/g, '') // Loại bỏ text giới thiệu links (EN)
        .replace(/✅\s*I've prepared the booking link for you:\s*/g, '') // Loại bỏ text giới thiệu booking link (EN)
        .replace(/✅\s*Tôi đã chuẩn bị link đặt phòng cho bạn:\s*/g, '') // Loại bỏ text giới thiệu booking link
        .replace(/\n\n\n+/g, '\n\n') // Loại bỏ nhiều dòng trống liên tiếp
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Loại bỏ nhiều dòng trống với spaces
        .trim();
      
      // Loại bỏ các dòng chỉ chứa emoji hoặc whitespace
      cleaned = cleaned.split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Giữ lại dòng có nội dung thực sự (không chỉ emoji hoặc whitespace)
          return trimmed.length > 0 && !/^[🔍📝💳👉✅\s]+$/.test(trimmed);
        })
        .join('\n');
      
      return cleaned.trim();
    };
    
    // ✅ Nếu có booking link hoặc payment link, thêm vào response text
    let finalResponseText = responseText;
    if (bookingContext.bookingCreated && bookingContext.bookingId) {
      // Booking đã được tạo thành công - gửi link xem/hoàn tất
      const fallbackBookingLink = bookingContext.roomId
        ? createBookingLink({
            roomId: bookingContext.roomId,
            roomQuantity: bookingContext.roomQuantity || 1,
            checkInDate: bookingContext.checkInDate,
            checkOutDate: bookingContext.checkOutDate,
            guests: bookingContext.guests,
            fullName: bookingContext.fullName,
            email: bookingContext.email,
            phone: bookingContext.phone,
            note: bookingContext.note
          })
        : null;
      const bookingFormLink = bookingLink || fallbackBookingLink;
      const paymentLinkToUse = paymentLink || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment?bookingId=${bookingContext.bookingId}`;
      const linkText = context.language === 'en' 
        ? `\n\n✅ Booking created successfully! Booking ID: ${bookingContext.bookingId}\n\n👉 Review your pre-filled booking form here: [View Booking](${bookingFormLink})\n💳 Click here to complete payment: [Pay Now](${paymentLinkToUse})`
        : `\n\n✅ Đã tạo đơn đặt phòng thành công! Mã đặt phòng: ${bookingContext.bookingId}\n\n👉 Xem lại thông tin đơn đặt phòng (đã điền sẵn) tại đây: [Xem đơn đặt phòng](${bookingFormLink})\n💳 Nhấn vào link này để thanh toán: [Thanh toán ngay](${paymentLinkToUse})`;
      finalResponseText = responseText + linkText;
    } else if (bookingLink || bookingContext.roomDetailLink) {
      // ✅ Có booking link hoặc room detail link - hiển thị link để user xem chi tiết/đặt phòng
      const links = [];
      
      // Thêm link xem chi tiết phòng nếu có
      if (bookingContext.roomDetailLink) {
        const detailLinkText = context.language === 'en'
          ? `🔍 [View Room Details](${bookingContext.roomDetailLink})`
          : `🔍 [Xem chi tiết phòng](${bookingContext.roomDetailLink})`;
        links.push(detailLinkText);
      }
      
      // Thêm booking link nếu có
      if (bookingLink) {
        const bookingLinkText = context.language === 'en'
          ? `📝 [Book Now](${bookingLink})`
          : `📝 [Đặt phòng ngay](${bookingLink})`;
        links.push(bookingLinkText);
      }
      
      const linkText = context.language === 'en'
        ? `\n\n✅ I've prepared the following links for you:\n${links.join('\n')}`
        : `\n\n✅ Tôi đã chuẩn bị các link sau cho bạn:\n${links.join('\n')}`;
      finalResponseText = responseText + linkText;
    } else if (bookingContext.roomId || context.selectedRoom) {
      // ✅ Có roomId hoặc selectedRoom - LUÔN tạo booking link ngay để khách có thể đặt phòng
      // ✅ QUAN TRỌNG: Restore selectedRoom từ session TRƯỚC khi tạo links
      if (!context.selectedRoom && session?.context?.selectedRoom) {
        context.selectedRoom = session.context.selectedRoom;
        console.log(`✅ Restored selectedRoom from session (before creating links): ${context.selectedRoom.name}`);
      }
      
      // ✅ Restore bookingContext.roomId từ selectedRoom nếu chưa có
      if (context.selectedRoom && !bookingContext.roomId) {
        bookingContext.roomId = context.selectedRoom._id;
        bookingContext.roomName = context.selectedRoom.name;
        bookingContext.roomPrice = context.selectedRoom.pricePerNight;
        bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
        console.log(`✅ Restored selectedRoom to bookingContext (before creating links): ${context.selectedRoom.name}`);
      }
      
      const roomIdToUse = bookingContext.roomId || context.selectedRoom?._id;
      
      // ✅ Nếu vẫn chưa có roomId, không tạo links
      if (!roomIdToUse) {
        console.warn('⚠️ Cannot create links: no roomId available', {
          hasBookingContextRoomId: !!bookingContext.roomId,
          hasSelectedRoom: !!context.selectedRoom,
          sessionHasSelectedRoom: !!session?.context?.selectedRoom
        });
      } else {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const quickRoomDetailLink = `${baseUrl}/rooms/${roomIdToUse}`;
        
        // ✅ Lưu roomDetailLink vào bookingContext để có thể sử dụng lại
        if (!bookingContext.roomDetailLink) {
          bookingContext.roomDetailLink = quickRoomDetailLink;
        }
        
        // Tạo booking link với tất cả thông tin đã có
      const quickBookingLink = createBookingLink({
          roomId: roomIdToUse,
        roomQuantity: bookingContext.roomQuantity || 1,
        checkInDate: bookingContext.checkInDate,
        checkOutDate: bookingContext.checkOutDate,
          guests: bookingContext.guests || bookingContext.maxOccupancy || context.selectedRoom?.maxOccupancy,
        fullName: bookingContext.fullName,
        email: bookingContext.email,
          phone: bookingContext.phone,
          note: bookingContext.note
      });
      
        // ✅ QUAN TRỌNG: Luôn thêm booking link vào response khi có phòng đã chọn
      const linkText = context.language === 'en'
          ? `\n\n✅ I've prepared the booking link for you:\n📝 [Book Now - Complete Your Reservation](${quickBookingLink})\n\nYou can fill in any missing information (dates, personal details) on the booking form.`
          : `\n\n✅ Tôi đã chuẩn bị link đặt phòng cho bạn:\n📝 [Đặt phòng ngay - Hoàn tất đặt phòng](${quickBookingLink})\n\nBạn có thể điền các thông tin còn thiếu (ngày, thông tin cá nhân) trên form đặt phòng.`;
      finalResponseText = responseText + linkText;
        
        // ✅ Lưu booking link và roomDetailLink vào biến để trả về response
        if (!bookingLink) {
          bookingLink = quickBookingLink;
        }
        // ✅ QUAN TRỌNG: Khai báo finalRoomDetailLink nếu chưa có
        if (typeof finalRoomDetailLink === 'undefined') {
          finalRoomDetailLink = null;
        }
        if (!finalRoomDetailLink) {
          finalRoomDetailLink = quickRoomDetailLink;
        }
        // ✅ Cũng lưu vào bookingContext để có thể sử dụng lại
        if (!bookingContext.roomDetailLink) {
          bookingContext.roomDetailLink = quickRoomDetailLink;
        }
        console.log('✅ Created links for selected room:', {
          bookingLink: bookingLink,
          roomDetailLink: finalRoomDetailLink,
          roomId: roomIdToUse,
          hasSelectedRoom: !!context.selectedRoom,
          hasBookingContextRoomId: !!bookingContext.roomId
        });
      }
    }
    
    // Lưu tin nhắn của bot (chỉ lưu text, không lưu booking link)
    const botMessage = await ChatMessage.create({
      sessionId: currentSessionId,
      userId: userId,
      message: finalResponseText, // Lưu response có kèm booking link
      sender: "bot"
    });
    
    // Cập nhật session
    if (session) {
      session.messages.push(userMessage._id, botMessage._id);
      // ✅ QUAN TRỌNG: Lưu selectedRoom và bookingContext vào session để có thể restore
      if (!session.context) session.context = {};
      if (context.selectedRoom) {
        session.context.selectedRoom = context.selectedRoom;
        console.log(`💾 Saving selectedRoom to session: ${context.selectedRoom.name}`, {
          roomId: context.selectedRoom._id,
          hasBookingContext: !!bookingContext.roomId
        });
      }
      if (bookingContext.roomId) {
        session.context.bookingContext = bookingContext;
        console.log(`💾 Saving bookingContext to session:`, {
          roomId: bookingContext.roomId,
          roomName: bookingContext.roomName
        });
      }
      
      // ✅ QUAN TRỌNG: LUÔN giữ lại lastRoomSearchResults trong session (không để mất)
      // Ưu tiên: context > session (dữ liệu mới hơn)
      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        session.context.lastRoomSearchResults = context.lastRoomSearchResults;
        console.log(`💾 Saving lastRoomSearchResults to session (from context):`, {
          count: context.lastRoomSearchResults.length,
          rooms: context.lastRoomSearchResults.map(r => ({ id: r._id, name: r.name }))
        });
      } else if (session.context.lastRoomSearchResults && !context.lastRoomSearchResults) {
        // Nếu context không có nhưng session có, giữ lại từ session và restore vào context
        context.lastRoomSearchResults = session.context.lastRoomSearchResults;
        console.log(`💾 Preserved lastRoomSearchResults from session (restored to context):`, {
          count: context.lastRoomSearchResults.length
        });
      }
      
      // ✅ QUAN TRỌNG: Đảm bảo lastRoomSearchResults luôn có trong session trước khi save
      if (!session.context.lastRoomSearchResults && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        session.context.lastRoomSearchResults = context.lastRoomSearchResults;
        console.log(`💾 Force saving lastRoomSearchResults to session (before save):`, {
          count: context.lastRoomSearchResults.length
        });
      }
      
      // ✅ QUAN TRỌNG: Mark session as modified để đảm bảo context được lưu
      session.markModified('context');
      await session.save();
      console.log('✅ Saved session with selectedRoom, bookingContext, and lastRoomSearchResults');
      
      // ✅ QUAN TRỌNG: Reload session từ database để đảm bảo có dữ liệu mới nhất
      session = await ChatSession.findOne({ sessionId: currentSessionId });
      console.log('🔄 Reloaded session from database:', {
        hasSelectedRoom: !!session?.context?.selectedRoom,
        selectedRoomName: session?.context?.selectedRoom?.name,
        hasBookingContext: !!session?.context?.bookingContext,
        bookingContextRoomId: session?.context?.bookingContext?.roomId,
        hasLastRoomSearchResults: !!session?.context?.lastRoomSearchResults,
        lastRoomSearchResultsCount: session?.context?.lastRoomSearchResults?.length || 0
      });
    }
    
    // Format rooms data để gửi về frontend (chỉ gửi thông tin cần thiết)
    // ✅ NOTE: roomsData đã được khai báo ở trên, chỉ format lại nếu có rooms từ AI response và chưa có roomsData
    // ✅ QUAN TRỌNG: CHỈ hiển thị room cards khi:
    // 1. ĐÃ có đủ thông tin (dates + guests) VÀ có rooms từ AI response hoặc roomSearchResults
    // 2. User đã chọn phòng (select_room, confirm_room_selection)
    // 3. Có selectedRoom được set
    // KHÔNG hiển thị room cards khi bot chỉ đang hỏi thông tin (chưa có dates/guests)
    const bookingContextForCheck = context.bookingContext || {};
    const hasDatesForCheck = bookingContextForCheck.checkInDate && bookingContextForCheck.checkOutDate;
    const hasGuestsForCheck = bookingContextForCheck.guests || bookingContextForCheck.maxOccupancy;
    const hasEnoughInfoForCards = hasDatesForCheck && hasGuestsForCheck;
    
    const shouldProcessRoomsFromAI = 
      (hasEnoughInfoForCards && ((rooms && rooms.length > 0) || (roomSearchResults && roomSearchResults.length > 0))) || // ✅ CHỈ hiển thị khi có đủ thông tin
      bookingIntent?.action === 'select_room' ||
      bookingIntent?.action === 'confirm_room_selection' ||
      bookingIntent?.action === 'search_rooms' ||
      bookingIntent?.action === 'confirm_booking' ||
      (bookingContext && bookingContext.roomName) || // Có phòng đã được chọn/xác nhận
      (context.selectedRoom && context.selectedRoom._id); // Có selectedRoom được set trong request hiện tại
    
    // ✅ QUAN TRỌNG: Nếu đã có đủ thông tin và có roomSearchResults từ auto-search, chuyển thành roomsData
    // Ưu tiên: rooms từ AI response > roomSearchResults từ auto-search
    if (shouldProcessRoomsFromAI && hasEnoughInfoForCards && roomSearchResults && roomSearchResults.length > 0 && !roomsData && (!rooms || rooms.length === 0)) {
      console.log(`✅ Converting roomSearchResults to roomsData (auto-searched rooms):`, {
        count: roomSearchResults.length,
        rooms: roomSearchResults.map(r => ({ id: r._id, name: r.name, roomType: r.roomType }))
      });

      let filteredRooms = roomSearchResults;
      const selectedRoomId = bookingContext?.roomId || context.selectedRoom?._id;
      const selectedRoomName = bookingContext?.roomName || context.selectedRoom?.name;

      if (selectedRoomId || selectedRoomName) {
        filteredRooms = roomSearchResults.filter(room => {
          const roomIdStr = room._id?.toString ? room._id.toString() : String(room._id);
          const matchesId = selectedRoomId && roomIdStr === (selectedRoomId.toString ? selectedRoomId.toString() : String(selectedRoomId));
          const matchesName = selectedRoomName && room.name && room.name.toLowerCase().includes(selectedRoomName.toLowerCase());
          return matchesId || matchesName;
        });

        // Nếu không tìm thấy phòng khớp, fallback về phòng đầu tiên để tránh hiển thị sai
        if (filteredRooms.length === 0) {
          console.warn('⚠️ No matching room found in roomSearchResults for selected room, showing first room as fallback', {
            selectedRoomId,
            selectedRoomName
          });
          filteredRooms = [roomSearchResults[0]];
        }
      }
      
      roomsData = filteredRooms.map(room => ({
        id: room._id.toString(),
        name: room.name,
        roomType: room.roomType,
        pricePerNight: room.pricePerNight,
        maxOccupancy: room.maxOccupancy,
        view: room.view || 'N/A',
        image: room.image || room.thumbnailUrl || '',
        amenities: Array.isArray(room.amenities) ? room.amenities : []
      }));
      hasRooms = true;
      console.log(`✅ Created roomsData from roomSearchResults: ${roomsData.length} rooms`, {
        selectedRoomId,
        selectedRoomName,
        roomIds: roomsData.map(r => r.id)
      });
    }
    
    // ✅ QUAN TRỌNG: Nếu đã có bookingContext.roomName (phòng đã được chọn/xác nhận), chỉ hiển thị phòng đó
    // Nếu AI trả về rooms (bot đang trả lời về phòng), hiển thị tất cả rooms để user dễ chọn
    if (shouldProcessRoomsFromAI && rooms && rooms.length > 0 && !roomsData) {
      // ✅ Nếu có bookingContext.roomName, chỉ lấy phòng khớp với tên đó
      if (bookingContext && bookingContext.roomName) {
        const matchingRoom = rooms.find(r => {
          const roomName = r.name || '';
          const bookingRoomName = bookingContext.roomName || '';
          return roomName.toLowerCase().includes(bookingRoomName.toLowerCase()) ||
                 bookingRoomName.toLowerCase().includes(roomName.toLowerCase());
        });
        
        if (matchingRoom) {
          console.log('✅ Found matching room from AI response for bookingContext:', {
            bookingRoomName: bookingContext.roomName,
            foundRoomName: matchingRoom.name,
            roomId: matchingRoom._id
          });
          roomsData = [{
            id: matchingRoom._id.toString(),
            name: matchingRoom.name,
            roomType: matchingRoom.roomType,
            pricePerNight: matchingRoom.pricePerNight,
            maxOccupancy: matchingRoom.maxOccupancy,
            view: matchingRoom.view,
            image: matchingRoom.image,
            amenities: matchingRoom.amenities || []
          }];
          hasRooms = true;
        } else {
          // Nếu không tìm thấy phòng khớp, lấy tất cả (fallback)
          console.warn('⚠️ No matching room found for bookingContext.roomName, using all rooms:', {
            bookingRoomName: bookingContext.roomName,
            availableRooms: rooms.map(r => r.name)
          });
          roomsData = rooms.map(room => ({
      id: room._id.toString(),
      name: room.name,
      roomType: room.roomType,
      pricePerNight: room.pricePerNight,
      maxOccupancy: room.maxOccupancy,
      view: room.view,
      image: room.image,
      amenities: room.amenities || []
          }));
          hasRooms = true;
        }
      } else {
        // Không có bookingContext.roomName, lấy tất cả phòng
        roomsData = rooms.map(room => ({
          id: room._id.toString(),
          name: room.name,
          roomType: room.roomType,
          pricePerNight: room.pricePerNight,
          maxOccupancy: room.maxOccupancy,
          view: room.view,
          image: room.image,
          amenities: room.amenities || []
        }));
        hasRooms = true;
      }
    }
    
    // ✅ NOTE: Logic thêm phòng đã chọn vào roomsData đã được di chuyển xuống SAU phần fallback tìm room từ database
    // để đảm bảo bookingContext.roomId đã có giá trị trước khi thêm vào roomsData
    
    // ✅ QUAN TRỌNG: Restore selectedRoom vào bookingContext một lần nữa (sau khi AI response và reload session)
    // Đảm bảo bookingContext.roomId luôn có giá trị nếu có selectedRoom
    // Nếu chưa có selectedRoom trong context, thử restore từ session một lần nữa (sau khi reload)
    if (!context.selectedRoom && session?.context?.selectedRoom) {
      context.selectedRoom = session.context.selectedRoom;
      console.log(`✅ Restored selectedRoom from session (after AI response & reload): ${context.selectedRoom.name}`, {
        roomId: context.selectedRoom._id,
        price: context.selectedRoom.pricePerNight
      });
    }
    
    // ✅ QUAN TRỌNG: LUÔN gán selectedRoom vào bookingContext nếu có
    if (context.selectedRoom || session?.context?.selectedRoom) {
      const selectedRoomToUse = context.selectedRoom || session.context.selectedRoom;
      // ✅ LUÔN gán, không chỉ khi chưa có (để đảm bảo luôn có giá trị mới nhất)
      bookingContext.roomId = selectedRoomToUse._id;
      bookingContext.roomName = selectedRoomToUse.name;
      bookingContext.roomPrice = selectedRoomToUse.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
      // ✅ Đảm bảo context.selectedRoom cũng được set
      if (!context.selectedRoom) {
        context.selectedRoom = selectedRoomToUse;
      }
      console.log(`✅ Restored selectedRoom to bookingContext (after AI response & reload): ${selectedRoomToUse.name}`, {
        roomId: bookingContext.roomId,
        selectedRoomId: selectedRoomToUse._id,
        bookingContextRoomId: bookingContext.roomId,
        hasContextSelectedRoom: !!context.selectedRoom
      });
    }
    
    // ✅ QUAN TRỌNG: Restore bookingContext từ session (merge để không mất dữ liệu)
    if (session?.context?.bookingContext) {
      // Merge bookingContext từ session vào bookingContext hiện tại
      bookingContext = {
        ...session.context.bookingContext,
        ...bookingContext, // Ưu tiên dữ liệu mới hơn
        // Nhưng giữ lại roomId và roomName từ session nếu có
        roomId: bookingContext.roomId || session.context.bookingContext.roomId,
        roomName: bookingContext.roomName || session.context.bookingContext.roomName,
        roomPrice: bookingContext.roomPrice || session.context.bookingContext.roomPrice
      };
      console.log(`✅ Restored bookingContext from session (after AI response & reload):`, {
        roomId: bookingContext.roomId,
        roomName: bookingContext.roomName,
        email: bookingContext.email,
        phone: bookingContext.phone
      });
    }
    
    // Create links right before response
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (!context.selectedRoom && session?.context?.selectedRoom) {
      context.selectedRoom = session.context.selectedRoom;
      console.log('✅ Restored selectedRoom from session (before links):', {
        roomId: context.selectedRoom._id,
        name: context.selectedRoom.name
      });
    }
    if (context.selectedRoom && !bookingContext.roomId) {
      bookingContext.roomId = context.selectedRoom._id;
      bookingContext.roomName = context.selectedRoom.name;
      bookingContext.roomPrice = context.selectedRoom.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
      console.log('✅ Mapped selectedRoom to bookingContext:', {
        roomId: bookingContext.roomId,
        roomName: bookingContext.roomName
      });
    }
    
    // ✅ FALLBACK: Nếu bookingContext có roomName nhưng không có roomId, tìm lại room từ database
    if (!bookingContext.roomId && bookingContext.roomName) {
      try {
        const foundRoom = await Room.findOne({ 
          name: { $regex: bookingContext.roomName, $options: 'i' },
          isAvailable: true,
          status: 'active'
        });
        if (foundRoom) {
          bookingContext.roomId = foundRoom._id;
          bookingContext.roomPrice = bookingContext.roomPrice || foundRoom.pricePerNight;
          context.selectedRoom = foundRoom;
          console.log('✅ Found room from database by name:', {
        roomId: bookingContext.roomId,
            roomName: bookingContext.roomName
          });
        }
      } catch (e) {
        console.error('❌ Error finding room by name:', e);
      }
    }
    
    // ✅ FALLBACK: Nếu session.bookingContext có roomName nhưng không có roomId
    if (!bookingContext.roomId && session?.context?.bookingContext?.roomName) {
      try {
        const foundRoom = await Room.findOne({ 
          name: { $regex: session.context.bookingContext.roomName, $options: 'i' },
          isAvailable: true,
          status: 'active'
        });
        if (foundRoom) {
          bookingContext.roomId = foundRoom._id;
          bookingContext.roomName = foundRoom.name;
          bookingContext.roomPrice = bookingContext.roomPrice || foundRoom.pricePerNight;
          context.selectedRoom = foundRoom;
          console.log('✅ Found room from database by session.bookingContext.roomName:', {
            roomId: bookingContext.roomId,
            roomName: bookingContext.roomName
          });
        }
      } catch (e) {
        console.error('❌ Error finding room by session.bookingContext.roomName:', e);
      }
    }
    
    // ✅ QUAN TRỌNG: SAU KHI đã tìm room từ database (nếu cần), thêm phòng đã chọn vào roomsData
    // Logic này phải chạy SAU tất cả các fallback tìm room để đảm bảo bookingContext.roomId đã có giá trị
    try {
      const selectedRoomForCard = context.selectedRoom || session?.context?.selectedRoom;
      const hasSelectedRoom = selectedRoomForCard || bookingContext?.roomId;
      
      // ✅ QUAN TRỌNG: Luôn thêm phòng đã chọn vào roomsData khi có bookingContext.roomId
      // (không cần kiểm tra action nữa vì đã có roomId nghĩa là user đã chọn phòng)
      if (hasSelectedRoom && bookingContext && bookingContext.roomId) {
        const selectedRoomId = bookingContext.roomId.toString ? bookingContext.roomId.toString() : String(bookingContext.roomId);
        
        // Kiểm tra xem phòng đã chọn đã có trong roomsData chưa
        const alreadyInList = roomsData && roomsData.some(r => {
          const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
          return roomIdStr === selectedRoomId;
        });
        
        if (!alreadyInList) {
          // Tìm phòng đầy đủ thông tin từ lastRoomSearchResults hoặc database
          let fullSelectedRoom = null;
          
          try {
            // Ưu tiên tìm từ lastRoomSearchResults (có đầy đủ thông tin)
            if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
              const selectedRoomIdStr = selectedRoomId.toString();
              const selectedRoomForCardIdStr = selectedRoomForCard && selectedRoomForCard._id ? 
                (selectedRoomForCard._id.toString ? selectedRoomForCard._id.toString() : String(selectedRoomForCard._id)) : null;
              
              fullSelectedRoom = context.lastRoomSearchResults.find(r => {
                if (!r || !r._id) return false;
                const roomIdStr = r._id.toString ? r._id.toString() : String(r._id);
                return roomIdStr === selectedRoomIdStr || (selectedRoomForCardIdStr && roomIdStr === selectedRoomForCardIdStr);
              });
            }
            
            // Nếu không tìm thấy, thử tìm từ database (có thể đã tìm ở trên nhưng đảm bảo có đầy đủ thông tin)
            if (!fullSelectedRoom && selectedRoomId) {
              try {
                fullSelectedRoom = await Room.findById(selectedRoomId);
              } catch (dbError) {
                console.error('❌ Error finding selected room from database:', dbError);
              }
            }
            
            // Nếu vẫn chưa có, sử dụng context.selectedRoom hoặc session.selectedRoom
            if (!fullSelectedRoom && selectedRoomForCard) {
              fullSelectedRoom = selectedRoomForCard;
            }
          } catch (findError) {
            console.error('❌ Error finding selected room:', findError);
          }
          
          // Tạo card với thông tin đầy đủ (có fallback để tránh lỗi, đảm bảo đúng format ChatRoom)
          const selectedRoomCard = {
            id: selectedRoomId,
            name: (fullSelectedRoom && fullSelectedRoom.name) || 
                  (selectedRoomForCard && selectedRoomForCard.name) || 
                  (bookingContext && bookingContext.roomName) || 
                  'Phòng đã chọn',
            roomType: (fullSelectedRoom && fullSelectedRoom.roomType) || 
                      (selectedRoomForCard && selectedRoomForCard.roomType) || 
                      'Standard',
            pricePerNight: (fullSelectedRoom && fullSelectedRoom.pricePerNight) || 
                           (selectedRoomForCard && selectedRoomForCard.pricePerNight) || 
                           (bookingContext && bookingContext.roomPrice) || 
                           0,
            maxOccupancy: (fullSelectedRoom && fullSelectedRoom.maxOccupancy) || 
                          (selectedRoomForCard && selectedRoomForCard.maxOccupancy) || 
                          2,
            view: (fullSelectedRoom && fullSelectedRoom.view) || 
                  (selectedRoomForCard && selectedRoomForCard.view) || 
                  'N/A',
            image: (fullSelectedRoom && fullSelectedRoom.image) || 
                   (fullSelectedRoom && fullSelectedRoom.thumbnailUrl) ||
                   (selectedRoomForCard && selectedRoomForCard.image) || 
                   (selectedRoomForCard && selectedRoomForCard.thumbnailUrl) ||
                   '', // Đảm bảo không null (ChatRoom.image là string, không phải string | null)
            amenities: (fullSelectedRoom && Array.isArray(fullSelectedRoom.amenities) && fullSelectedRoom.amenities) || 
                       (selectedRoomForCard && Array.isArray(selectedRoomForCard.amenities) && selectedRoomForCard.amenities) || 
                       []
          };
          
          // Nếu roomsData là null, tạo array mới
          if (!roomsData) {
            roomsData = [selectedRoomCard];
          } else {
            // Thêm vào đầu list để hiển thị trước
            roomsData.unshift(selectedRoomCard);
          }
          
          console.log('✅ Added selected room to roomsData for card display (after fallback):', {
            roomId: selectedRoomId,
            roomName: selectedRoomCard.name,
            hasImage: !!selectedRoomCard.image,
            amenitiesCount: selectedRoomCard.amenities.length,
            source: fullSelectedRoom ? 'found' : 'fallback'
          });
        } else {
          console.log('ℹ️ Selected room already in roomsData');
        }
      }
    } catch (cardError) {
      console.error('❌ Error adding selected room to roomsData (after fallback):', cardError);
      // Không throw error, chỉ log để không crash toàn bộ request
    }
    
    // ✅ Đảm bảo hasRooms được set đúng nếu có phòng đã chọn (sau khi đã thêm vào roomsData)
    if (roomsData && roomsData.length > 0) {
      hasRooms = true;
    }
    
    const roomIdForLinks = bookingContext.roomId || context.selectedRoom?._id || null;
    console.log('🔍 Final roomIdForLinks check:', {
      roomIdForLinks,
      bookingContextRoomId: bookingContext.roomId,
      selectedRoomId: context.selectedRoom?._id,
      bookingContextRoomName: bookingContext.roomName,
      bookingIntentAction: bookingIntent?.action
    });
    let finalBookingLink = null;
    let finalRoomDetailLink = null;
    
    // ✅ LUÔN tạo roomDetailLink nếu có roomId (để user xem chi tiết phòng)
    // Đặc biệt quan trọng khi user vừa chọn phòng từ list
    if (roomIdForLinks) {
      const roomIdStr = roomIdForLinks.toString ? roomIdForLinks.toString() : String(roomIdForLinks);
      finalRoomDetailLink = `${baseUrl}/rooms/${roomIdStr}`;
      console.log('✅ Created finalRoomDetailLink:', finalRoomDetailLink, {
        action: bookingIntent?.action,
        hasSelectedRoom: !!context.selectedRoom,
        bookingContextRoomId: bookingContext.roomId
      });
    } else if (bookingIntent?.action === 'select_room' || bookingIntent?.action === 'confirm_room_selection') {
      // ✅ Fallback: Nếu chưa có roomIdForLinks nhưng user vừa chọn phòng, thử lấy từ bookingContext
      if (bookingContext?.roomId) {
        const roomIdStr = bookingContext.roomId.toString ? bookingContext.roomId.toString() : String(bookingContext.roomId);
        finalRoomDetailLink = `${baseUrl}/rooms/${roomIdStr}`;
        console.log('✅ Created finalRoomDetailLink (fallback from bookingContext):', finalRoomDetailLink);
      }
    }
    
    // ✅ CHỈ tạo bookingLink khi user đã chốt đặt (confirm_booking) hoặc có đủ thông tin để đặt phòng
    // KHÔNG tạo bookingLink khi user chỉ chọn phòng (select_room hoặc confirm_room_selection)
    const shouldCreateBookingLink = 
      bookingIntent?.action === 'confirm_booking' || 
      (bookingContext.checkInDate && bookingContext.checkOutDate && bookingContext.fullName && bookingContext.email && bookingContext.phone);
    
    if (roomIdForLinks && shouldCreateBookingLink) {
      const roomIdStr = roomIdForLinks.toString ? roomIdForLinks.toString() : String(roomIdForLinks);
      try {
        finalBookingLink = createBookingLink({
          roomId: roomIdStr,
        roomQuantity: bookingContext.roomQuantity || 1,
        checkInDate: bookingContext.checkInDate,
        checkOutDate: bookingContext.checkOutDate,
          guests: bookingContext.guests || bookingContext.maxOccupancy || context.selectedRoom?.maxOccupancy,
        fullName: bookingContext.fullName,
        email: bookingContext.email,
        phone: bookingContext.phone,
        note: bookingContext.note
      });
        console.log('✅ Created finalBookingLink:', finalBookingLink);
      } catch (e) {
        console.error('❌ Error creating finalBookingLink:', e);
        finalBookingLink = null;
      }
    } else if (roomIdForLinks && !shouldCreateBookingLink) {
      console.log('ℹ️ Skipping bookingLink creation - user only selected room, not confirmed booking yet');
    }
    
    // Tạo paymentLink nếu booking đã được tạo
    let paymentLinkFinal = null;
    if (bookingContext.bookingCreated && bookingContext.bookingId) {
      paymentLinkFinal = paymentLink || `${baseUrl}/payment?bookingId=${bookingContext.bookingId}`;
      console.log('✅ Created paymentLinkFinal:', paymentLinkFinal);
    }
    
    // ✅ QUAN TRỌNG: Kiểm tra lần cuối trước khi trả response - đảm bảo phòng đã chọn có trong roomsData
    // Logic này chạy CUỐI CÙNG để đảm bảo không bỏ sót phòng nào
    // Fallback: Nếu có roomName nhưng chưa có roomId, tìm room từ database
    if (bookingContext && bookingContext.roomName && !bookingContext.roomId) {
      try {
        const foundRoom = await Room.findOne({ 
          name: { $regex: bookingContext.roomName, $options: 'i' },
          isAvailable: true,
          status: 'active'
        });
        if (foundRoom) {
          bookingContext.roomId = foundRoom._id;
          bookingContext.roomPrice = bookingContext.roomPrice || foundRoom.pricePerNight;
          context.selectedRoom = foundRoom;
          console.log('✅ Found room from database by name (last check):', {
            roomId: bookingContext.roomId,
            roomName: bookingContext.roomName
          });
        }
      } catch (e) {
        console.error('❌ Error finding room by name (last check):', e);
      }
    }
    
    // ✅ QUAN TRỌNG: Nếu có bookingContext.roomName (phòng được đề cập trong text response),
    // đảm bảo roomsData chỉ chứa phòng đó, không phải phòng khác
    if (bookingContext && bookingContext.roomName && roomsData && roomsData.length > 0) {
      // Kiểm tra xem roomsData có chứa phòng khớp với bookingContext.roomName không
      const matchingRoomInData = roomsData.find(r => {
        const roomName = r.name || '';
        const bookingRoomName = bookingContext.roomName || '';
        return roomName.toLowerCase().includes(bookingRoomName.toLowerCase()) ||
               bookingRoomName.toLowerCase().includes(roomName.toLowerCase());
      });
      
      if (!matchingRoomInData) {
        // Nếu roomsData không chứa phòng khớp, xóa tất cả và sẽ thêm phòng đúng ở dưới
        console.warn('⚠️ roomsData does not match bookingContext.roomName, clearing roomsData:', {
          bookingRoomName: bookingContext.roomName,
          roomsDataNames: roomsData.map(r => r.name)
        });
        roomsData = null;
        hasRooms = false;
      } else if (roomsData.length > 1) {
        // Nếu có nhiều phòng nhưng chỉ một phòng khớp, chỉ giữ lại phòng đó
        console.log('✅ Filtering roomsData to only include matching room:', {
          bookingRoomName: bookingContext.roomName,
          matchingRoomName: matchingRoomInData.name,
          totalRoomsBefore: roomsData.length
        });
        roomsData = [matchingRoomInData];
        hasRooms = true;
      }
    }
    
    // ✅ QUAN TRỌNG: Thêm room card khi:
    // 1. ĐÃ có đủ thông tin (dates + guests) VÀ có rooms từ AI response hoặc roomSearchResults
    // 2. Có action liên quan đến phòng (select_room, confirm_room_selection, search_rooms, confirm_booking)
    // 3. Có selectedRoom được set trong request hiện tại
    // KHÔNG thêm room card khi bot chỉ đang hỏi thông tin (chưa có dates/guests)
    const shouldAddRoomCard = 
      (hasEnoughInfoForCards && ((rooms && rooms.length > 0) || (roomSearchResults && roomSearchResults.length > 0))) || // ✅ CHỈ hiển thị khi có đủ thông tin
      bookingIntent?.action === 'select_room' ||
      bookingIntent?.action === 'confirm_room_selection' ||
      bookingIntent?.action === 'search_rooms' ||
      bookingIntent?.action === 'confirm_booking' ||
      (context.selectedRoom && context.selectedRoom._id); // Có selectedRoom được set trong request hiện tại
    
    // Bây giờ kiểm tra và thêm vào roomsData (CHỈ khi shouldAddRoomCard = true)
    if (shouldAddRoomCard && bookingContext && bookingContext.roomId && (!roomsData || roomsData.length === 0 || !roomsData.some(r => {
      const roomIdStr = r.id ? (r.id.toString ? r.id.toString() : String(r.id)) : null;
      const bookingRoomIdStr = bookingContext.roomId.toString ? bookingContext.roomId.toString() : String(bookingContext.roomId);
      return roomIdStr === bookingRoomIdStr;
    }))) {
      try {
        const selectedRoomId = bookingContext.roomId.toString ? bookingContext.roomId.toString() : String(bookingContext.roomId);
        console.log('🔍 Last check: Adding selected room to roomsData before response:', {
          roomId: selectedRoomId,
          roomName: bookingContext.roomName,
          hasRoomsData: !!roomsData,
          roomsDataLength: roomsData ? roomsData.length : 0
        });
        
        // Tìm phòng từ database hoặc context
        let fullSelectedRoom = context.selectedRoom || session?.context?.selectedRoom;
        
        // Nếu chưa có, tìm từ database
        if (!fullSelectedRoom && selectedRoomId) {
          try {
            fullSelectedRoom = await Room.findById(selectedRoomId);
          } catch (dbError) {
            console.error('❌ Error finding room from database (last check):', dbError);
          }
        }
        
        // Tìm từ lastRoomSearchResults nếu có
        if (!fullSelectedRoom && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
          fullSelectedRoom = context.lastRoomSearchResults.find(r => {
            if (!r || !r._id) return false;
            const roomIdStr = r._id.toString ? r._id.toString() : String(r._id);
            return roomIdStr === selectedRoomId;
          });
        }
        
        // Tạo card với thông tin đầy đủ (đảm bảo đúng format ChatRoom)
        const selectedRoomCard = {
          id: selectedRoomId,
          name: (fullSelectedRoom && fullSelectedRoom.name) || bookingContext.roomName || 'Phòng đã chọn',
          roomType: (fullSelectedRoom && fullSelectedRoom.roomType) || 'Standard',
          pricePerNight: (fullSelectedRoom && fullSelectedRoom.pricePerNight) || bookingContext.roomPrice || 0,
          maxOccupancy: (fullSelectedRoom && fullSelectedRoom.maxOccupancy) || 2,
          view: (fullSelectedRoom && fullSelectedRoom.view) || 'N/A',
          image: (fullSelectedRoom && fullSelectedRoom.image) || (fullSelectedRoom && fullSelectedRoom.thumbnailUrl) || '', // Đảm bảo không null
          amenities: (fullSelectedRoom && Array.isArray(fullSelectedRoom.amenities) && fullSelectedRoom.amenities) || []
        };
        
        // Thêm vào roomsData
        if (!roomsData) {
          roomsData = [selectedRoomCard];
        } else {
          roomsData.unshift(selectedRoomCard);
        }
        
        hasRooms = true;
        
        console.log('✅ Added selected room to roomsData (last check before response):', {
          roomId: selectedRoomId,
          roomName: selectedRoomCard.name,
          hasImage: !!selectedRoomCard.image,
          amenitiesCount: selectedRoomCard.amenities.length
        });
      } catch (lastCheckError) {
        console.error('❌ Error in last check before response:', lastCheckError);
      }
    }
    
    // ✅ Debug log cuối cùng trước khi trả response
    console.log('🔍 FINAL CHECK before response:', {
      hasRoomsData: !!roomsData,
      roomsDataLength: roomsData ? roomsData.length : 0,
      hasRooms: hasRooms,
      bookingContextRoomId: bookingContext.roomId,
      bookingContextRoomName: bookingContext.roomName,
      hasSelectedRoom: !!context.selectedRoom,
      selectedRoomId: context.selectedRoom?._id,
      selectedRoomName: context.selectedRoom?.name,
      roomsDataPreview: roomsData ? roomsData.map(r => ({ id: r.id, name: r.name })) : null
    });
    
    // ✅ Đảm bảo rooms luôn là array (không phải null) để frontend xử lý dễ dàng
    let finalRoomsData = Array.isArray(roomsData) && roomsData.length > 0 ? roomsData : null;

    // ✅ FINAL GUARD: Nếu đã có selectedRoom/bookingContext, chỉ hiển thị đúng phòng đó
    if (finalRoomsData && finalRoomsData.length > 1) {
      const selectedRoomIdStr = bookingContext?.roomId
        ? (bookingContext.roomId.toString ? bookingContext.roomId.toString() : String(bookingContext.roomId))
        : (context.selectedRoom?._id ? (context.selectedRoom._id.toString ? context.selectedRoom._id.toString() : String(context.selectedRoom._id)) : null);
      const selectedRoomName = bookingContext?.roomName || context.selectedRoom?.name;

      const matchingRooms = finalRoomsData.filter(room => {
        const roomIdStr = room.id ? (room.id.toString ? room.id.toString() : String(room.id)) : null;
        const matchesId = selectedRoomIdStr && roomIdStr === selectedRoomIdStr;
        const matchesName = selectedRoomName && room.name && room.name.toLowerCase().includes(selectedRoomName.toLowerCase());
        return matchesId || matchesName;
      });

      if (matchingRooms.length > 0) {
        console.log('✅ Final filtering roomsData to selected room only:', {
          selectedRoomIdStr,
          selectedRoomName,
          totalBefore: finalRoomsData.length,
          totalAfter: matchingRooms.length,
          keptRooms: matchingRooms.map(r => r.name)
        });
        finalRoomsData = matchingRooms;
      }
    }
    
    // ✅ Loại bỏ markdown links và các format đặc biệt khỏi response text khi đã có room cards (vì mỗi card đã có button riêng)
    // ✅ QUAN TRỌNG: Luôn clean response text để loại bỏ các format không cần thiết như "[roomDetailLink: {...}]"
    let cleanedResponseText = removeMarkdownLinks(finalResponseText);
    if (finalRoomsData && finalRoomsData.length > 0) {
      console.log('✅ Removed markdown links and special formats from response text (room cards already have buttons)');
    } else {
      console.log('✅ Cleaned response text (removed markdown links and special formats)');
    }
    
    res.status(200).json({
      success: true,
      data: {
        message: cleanedResponseText,
        sessionId: currentSessionId,
        rooms: finalRoomsData, // null hoặc array, không phải undefined
        hasRooms: hasRooms || (Array.isArray(roomsData) && roomsData.length > 0), // Đảm bảo hasRooms đúng
        bookingLink: finalBookingLink,
        roomDetailLink: finalRoomDetailLink,
        bookingId: bookingContext.bookingId || null,
        paymentLink: paymentLinkFinal,
        bookingContext: bookingContext
      }
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xử lý tin nhắn",
      error: error.message
    });
  }
});

// @route   POST /api/chat/transfer-to-human
// @desc    Chuyển từ bot sang nhân viên
// @access  Public
export const transferToHuman = asyncHandler(async (req, res) => {
  try {
    // Chặn admin sử dụng transfer-to-human (chỉ dành cho user)
    if (req.user && req.user.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin không thể sử dụng tính năng này. Vui lòng sử dụng Admin Chat trong dashboard."
      });
    }
    
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID không được để trống"
      });
    }

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    // Cập nhật userId nếu session chưa có userId nhưng user đã đăng nhập
    const userId = (req.user && req.user._id) ? req.user._id : null;
    
    if (!session.userId && userId) {
      session.userId = userId;
      console.log('✅ transferToHuman - Linked session to user:', req.user?.email || userId);
    } else if (session.userId && userId && session.userId.toString() !== userId.toString()) {
      // Nếu userId khác nhau, update lại (trường hợp user đổi account)
      session.userId = userId;
      console.log('✅ transferToHuman - Updated session userId for:', req.user?.email || userId);
    }

    // Chuyển sang human chat
    session.chatType = "human";
    session.status = "waiting";
    session.transferredAt = new Date();
    await session.save(); // Save sau khi update tất cả fields

    // Gửi tin nhắn thông báo cho user
    const notificationMessage = await ChatMessage.create({
      sessionId,
      userId: session.userId,
      message: "Đã chuyển sang chế độ chat với nhân viên. Nhân viên sẽ trả lời bạn trong thời gian sớm nhất. Xin cảm ơn!",
      sender: "bot"
    });

    res.status(200).json({
      success: true,
      message: "Đã chuyển sang chat với nhân viên",
      data: {
        session,
        notificationMessage
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi chuyển sang nhân viên",
      error: error.message
    });
  }
});

// @route   POST /api/chat/link-session
// @desc    Link session hiện tại với user đã đăng nhập
// @access  Public (sử dụng optionalVerifyToken)
export const linkSessionToUser = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = (req.user && req.user._id) ? req.user._id : null;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Bạn cần đăng nhập để link session"
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID không được để trống"
      });
    }

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    // Update userId nếu chưa có hoặc khác
    if (!session.userId || session.userId.toString() !== userId.toString()) {
      session.userId = userId;
      await session.save();
      console.log('✅ linkSessionToUser - Linked session to user:', req.user?.email || userId);
    }

    res.status(200).json({
      success: true,
      message: "Đã link session với tài khoản của bạn",
      data: { sessionId, userId }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi link session",
      error: error.message
    });
  }
});

// @route   POST /api/chat/language
// @desc    Cập nhật language cho session
// @access  Public (optionalVerifyToken)
export const updateSessionLanguage = asyncHandler(async (req, res) => {
  try {
    const { sessionId, language } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Session ID không được để trống"
      });
    }

    if (!language || (language !== 'vi' && language !== 'en')) {
      return res.status(400).json({
        success: false,
        message: "Language phải là 'vi' hoặc 'en'"
      });
    }

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    // Update language trong context
    if (!session.context) {
      session.context = {};
    }
    session.context.language = language;
    await session.save();

    res.status(200).json({
      success: true,
      message: "Đã cập nhật language cho session",
      data: { sessionId, language }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật language",
      error: error.message
    });
  }
});

// @route   GET /api/chat/history/:sessionId
// @desc    Lấy lịch sử chat
// @access  Private (hoặc Public nếu muốn)
export const getChatHistory = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Cập nhật userId cho session nếu user đã đăng nhập
    const userId = (req.user && req.user._id) ? req.user._id : null;
    if (userId) {
      const session = await ChatSession.findOne({ sessionId });
      if (session && !session.userId) {
        session.userId = userId;
        await session.save();
        console.log('✅ getChatHistory - Linked session to user:', req.user?.email || userId);
      }
    }
    
    const messages = await ChatMessage.find({ sessionId })
      .sort({ timestamp: 1 })
      .select("message sender timestamp")
      .lean();
    
    // Format messages để phù hợp với frontend
    const formattedMessages = messages.map(msg => ({
      id: msg._id.toString(),
      text: msg.message,
      sender: msg.sender,
      timestamp: msg.timestamp
    }));
    
    res.status(200).json(formattedMessages);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy lịch sử chat",
      error: error.message
    });
  }
});

// Export getAIResponse để Telegram bot và các module khác có thể sử dụng
export { getAIResponse, generateSessionId };