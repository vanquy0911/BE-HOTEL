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
      filter.maxOccupancy = { $gte: criteria.maxOccupancy };
    }

    // Filter theo view
    if (criteria.view) {
      filter.view = { $regex: criteria.view, $options: "i" };
    }

    // Filter theo loại phòng
    if (criteria.roomType) {
      filter.roomType = criteria.roomType;
    }

    // Lấy tất cả phòng phù hợp
    let rooms = await Room.find(filter)
      .populate("location", "address province city")
      .limit(20) // Tăng limit để check availability
      .lean();

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
      
      rooms = availableRooms.slice(0, 5); // Giới hạn 5 phòng available
    } else {
      rooms = rooms.slice(0, 5); // Giới hạn 5 phòng nếu không có dates
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
    // ✅ Thêm để parse xác nhận đặt phòng
    confirmBooking: false
  };
  
  // ✅ Kiểm tra xem có xác nhận đặt phòng không
  if (lowerMessage.includes("có") || lowerMessage.includes("đồng ý") || lowerMessage.includes("ok") || 
      lowerMessage.includes("đặt luôn") || lowerMessage.includes("đặt phòng") || 
      lowerMessage.includes("yes") || lowerMessage.includes("okay") ||
      lowerMessage.includes("xác nhận") || lowerMessage.includes("confirm")) {
    // Chỉ coi là confirm nếu đã có selectedRoom hoặc bookingContext.roomId
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
  
  // Chỉ parse chọn phòng nếu KHÔNG có "người" sau số
  if (!hasNgười) {
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
  const occupancyMatch = lowerMessage.match(/(\d+)\s*người|cho\s*(\d+)\s*người/);
  if (occupancyMatch) {
    intent.maxOccupancy = parseInt(occupancyMatch[1] || occupancyMatch[2]);
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
    const totalPrice = selectedRoomInfo.pricePerNight * nights * roomQuantity;
    
    roomInfo += `- Check-in: ${checkIn.toLocaleDateString('vi-VN')}\n` +
      `- Check-out: ${checkOut.toLocaleDateString('vi-VN')}\n` +
      `- Số đêm: ${nights} đêm\n` +
      `- Tổng tiền: ${totalPrice.toLocaleString('vi-VN')} VNĐ\n`;
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
  
  // Kiểm tra xem có phải yêu cầu tìm phòng không (chỉ khi chưa có selectedRoom VÀ không phải là chọn phòng từ list)
  // ✅ Nếu đã có list phòng và user không yêu cầu tìm mới, không coi là yêu cầu tìm phòng
  const isRoomSearchRequest = !hasSelectedRoom && !isRequestingNewSearch && (
    (lowerMessage.includes("đặt phòng") && !hasRoomList) || // Chỉ coi là tìm phòng nếu chưa có list
    (lowerMessage.includes("tìm phòng") && !hasRoomList) ||
    lowerMessage.includes("phòng trống") ||
    lowerMessage.includes("phòng nào") ||
    lowerMessage.includes("có phòng") ||
    (lowerMessage.includes("cho") && (lowerMessage.includes("người") || lowerMessage.match(/\d+\s*người/)) && !hasRoomList) ||
    ((lowerMessage.includes("view") || lowerMessage.includes("biển") || lowerMessage.includes("núi")) && !hasRoomList) ||
    (lowerMessage.match(/\d{1,2}\/\d{1,2}/) && !lowerMessage.includes("ngày nhận") && !lowerMessage.includes("ngày trả") && !lowerMessage.includes("check-in") && !lowerMessage.includes("check-out") && !hasRoomList) || // Có ngày nhưng không phải là cung cấp ngày cho booking đã chọn
    ((lowerMessage.includes("hôm nay") || lowerMessage.includes("ngày mai") || lowerMessage.includes("ngày kia")) && !hasRoomList)
  );

  let roomSearchResults = null;
  let searchCriteria = null;

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

  // Nếu là yêu cầu tìm phòng VÀ chưa có selectedRoom, tìm phòng trước
  if (isRoomSearchRequest && !hasSelectedRoom) {
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
        
        // Thêm thông tin phòng tìm được nếu có (fallback - chỉ cung cấp data)
        if (roomSearchResults && roomSearchResults.length > 0) {
          const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG TÌM ĐƯỢC' : 'ROOM INFORMATION FOUND';
          
          prompt += `${roomInfoLabel}:\n`;
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
      
      // Trả về response kèm dữ liệu phòng nếu có
      return {
        text: text.trim(),
        rooms: roomSearchResults || null,
        hasRooms: roomSearchResults && roomSearchResults.length > 0
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
    
    // ✅ QUAN TRỌNG: Đảm bảo lastRoomSearchResults được restore từ session
    if (session?.context?.lastRoomSearchResults) {
      context.lastRoomSearchResults = session.context.lastRoomSearchResults;
      console.log(`📋 Restored lastRoomSearchResults: ${context.lastRoomSearchResults.length} rooms`);
    }
    
    // ✅ QUAN TRỌNG: Đảm bảo selectedRoom được restore từ session
    if (session?.context?.selectedRoom) {
      context.selectedRoom = session.context.selectedRoom;
      console.log(`📋 Restored selectedRoom: ${context.selectedRoom.name} (${context.selectedRoom.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm)`);
      
      // ✅ Nếu đã có selectedRoom, restore vào bookingContext luôn
      if (!context.bookingContext) context.bookingContext = {};
      if (!context.bookingContext.roomId) {
        context.bookingContext.roomId = context.selectedRoom._id;
        context.bookingContext.roomName = context.selectedRoom.name;
        context.bookingContext.roomPrice = context.selectedRoom.pricePerNight;
      }
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
    let bookingContext = context.bookingContext || {};

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
    
    // ✅ Xử lý khi user xác nhận đặt phòng
    if (bookingIntent.action === 'confirm_booking' && bookingIntent.confirmBooking) {
      bookingContext.confirmBooking = true;
      console.log('✅ User confirmed booking');
    }
    
    // ✅ QUAN TRỌNG: Nếu đã có selectedRoom trong context nhưng chưa có trong bookingContext, restore vào bookingContext
    if (context.selectedRoom && !bookingContext.roomId) {
      bookingContext.roomId = context.selectedRoom._id;
      bookingContext.roomName = context.selectedRoom.name;
      bookingContext.roomPrice = context.selectedRoom.pricePerNight;
      bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
      console.log(`✅ Restored selectedRoom to bookingContext: ${context.selectedRoom.name}`);
    }

    // Nếu user chọn phòng từ danh sách (phòng 1, phòng 2, etc.)
    if (bookingIntent.action === 'select_room' && bookingIntent.roomNumber) {
      // Lấy danh sách phòng từ context hoặc tìm lại
      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        const selectedRoomIndex = bookingIntent.roomNumber - 1;
        if (selectedRoomIndex >= 0 && selectedRoomIndex < context.lastRoomSearchResults.length) {
          const selectedRoom = context.lastRoomSearchResults[selectedRoomIndex];
          
          // ✅ Log để debug
          console.log(`🔍 User selected room #${bookingIntent.roomNumber}:`, {
            index: selectedRoomIndex,
            roomId: selectedRoom._id,
            name: selectedRoom.name,
            price: selectedRoom.pricePerNight,
            roomType: selectedRoom.roomType
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
    if (session && (bookingContext.roomId || bookingContext.checkInDate || bookingContext.checkOutDate || 
        context.selectedRoom || context.requestedRoomNumber || bookingContext.confirmBooking || 
        bookingContext.fullName || bookingContext.email || bookingContext.phone || 
        bookingContext.bookingCreated || bookingContext.bookingError || bookingContext.needPersonalInfo)) {
      if (!session.context) session.context = {};
      session.context.bookingContext = bookingContext;
      if (context.lastRoomSearchResults) {
        session.context.lastRoomSearchResults = context.lastRoomSearchResults;
      }
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
      await session.save();
      context.bookingContext = bookingContext;
    }

    // ✅ Tính tổng giá nếu có đủ thông tin (roomId + dates)
    if (bookingContext.roomId && bookingContext.checkInDate && bookingContext.checkOutDate) {
      const checkIn = new Date(bookingContext.checkInDate);
      const checkOut = new Date(bookingContext.checkOutDate);
      const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
      const roomPrice = bookingContext.roomPrice || context.selectedRoom?.pricePerNight || 0;
      const roomQuantity = bookingContext.roomQuantity || 1;
      bookingContext.totalPrice = roomPrice * nights * roomQuantity;
      bookingContext.nights = nights;
      console.log(`💰 Calculated total price: ${bookingContext.totalPrice.toLocaleString('vi-VN')} VNĐ (${nights} nights x ${roomQuantity} rooms)`);
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
    
    // ✅ Tạo booking link nếu chưa có (fallback - khi chưa tạo booking trực tiếp)
    if (!bookingLink && bookingContext.roomId) {
      const bookingData = {
        roomId: bookingContext.roomId,
        roomQuantity: bookingContext.roomQuantity || 1,
        checkInDate: bookingIntent.checkInDate || bookingContext.checkInDate,
        checkOutDate: bookingIntent.checkOutDate || bookingContext.checkOutDate,
        guests: bookingContext.guests || bookingIntent.maxOccupancy,
        fullName: bookingContext.fullName,
        email: bookingContext.email,
        phone: bookingContext.phone,
        note: bookingContext.note
      };
      
      // Nếu có ngày check-in/out, tạo link ngay
      if (bookingData.checkInDate && bookingData.checkOutDate) {
        bookingLink = createBookingLink(bookingData);
        console.log('✅ Created booking link:', bookingLink);
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
    const hasRooms = typeof aiResponse === 'object' && aiResponse.hasRooms ? aiResponse.hasRooms : false;
    
    // ✅ Lưu lastRoomSearchResults vào context nếu có
    if (rooms && rooms.length > 0 && session) {
      if (!session.context) session.context = {};
      session.context.lastRoomSearchResults = rooms.map(r => ({
        _id: r._id,
        name: r.name,
        roomType: r.roomType,
        pricePerNight: r.pricePerNight,
        maxOccupancy: r.maxOccupancy,
        view: r.view
      }));
      await session.save();
      context.lastRoomSearchResults = session.context.lastRoomSearchResults;
    }
    
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
    } else if (bookingLink) {
      // Chưa tạo booking, chỉ có booking link
      const linkText = context.language === 'en' 
        ? `\n\n✅ I've prepared a booking form for you! Click here to complete your booking: [Book Now](${bookingLink})`
        : `\n\n✅ Tôi đã chuẩn bị form đặt phòng cho bạn! Nhấn vào link này để hoàn tất đặt phòng: [Đặt phòng ngay](${bookingLink})`;
      finalResponseText = responseText + linkText;
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
      await session.save();
    }
    
    // Format rooms data để gửi về frontend (chỉ gửi thông tin cần thiết)
    const roomsData = rooms ? rooms.map(room => ({
      id: room._id.toString(),
      name: room.name,
      roomType: room.roomType,
      pricePerNight: room.pricePerNight,
      maxOccupancy: room.maxOccupancy,
      view: room.view,
      image: room.image,
      amenities: room.amenities || []
    })) : null;
    
    res.status(200).json({
      success: true,
      data: {
        message: finalResponseText, // Response có kèm booking link nếu có
        sessionId: currentSessionId,
        rooms: roomsData,
        hasRooms: hasRooms,
        bookingLink: bookingLink || (bookingContext.roomId ? createBookingLink({
          roomId: bookingContext.roomId,
          roomQuantity: bookingContext.roomQuantity || 1,
          checkInDate: bookingContext.checkInDate,
          checkOutDate: bookingContext.checkOutDate,
          guests: bookingContext.guests,
          fullName: bookingContext.fullName,
          email: bookingContext.email,
          phone: bookingContext.phone,
          note: bookingContext.note
        }) : null), // ✅ Thêm booking link vào response
        bookingId: bookingContext.bookingId || null, // ✅ Thêm booking ID nếu đã tạo booking
        paymentLink: (bookingContext.bookingCreated && bookingContext.bookingId) 
          ? (paymentLink || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment?bookingId=${bookingContext.bookingId}`) 
          : null, // ✅ Thêm payment link nếu booking đã được tạo
        bookingContext: bookingContext.roomId ? bookingContext : null // ✅ Thêm booking context
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