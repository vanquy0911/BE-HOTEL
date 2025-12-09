import asyncHandler from "express-async-handler";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";
import Room from "../Models/RoomModel.js";
import Booking from "../Models/BookingModel.js";
import NearbyPlace from "../Models/NearbyPlaceModel.js";
import crypto from "crypto";
import dotenv from "dotenv";
import { detectLanguage, getLanguage } from "../utils/languageDetector.js";
import googleCalendarService from "../services/googleCalendarService.js";

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
          model: "gemini-2.5-flash-lite",
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

// Function để loại bỏ markdown links nhưng GIỮ LẠI link [text](explore)
const removeMarkdownLinks = (text) => {
  console.log('🚀 removeMarkdownLinks CALLED with text length:', text ? text.length : 0);
  
  if (!text) {
    console.log('⚠️ removeMarkdownLinks - Empty text, returning as is');
    return text;
  }
  
  console.log('🔍 removeMarkdownLinks - Input text length:', text.length);
  console.log('🔍 removeMarkdownLinks - Input text preview:', text.substring(0, 300));
  
  // ✅ QUAN TRỌNG: GIỮ LẠI link [text](explore) - đây là link để mở explore modal
  // Tìm tất cả explore links trước
  const exploreLinkPattern = /\[([^\]]+)\]\(explore\)/g;
  const exploreLinks = [];
  const textCopy = text;
  
  // Reset regex
  exploreLinkPattern.lastIndex = 0;
  let match;
  while ((match = exploreLinkPattern.exec(textCopy)) !== null) {
    exploreLinks.push(match[0]);
    console.log(`✅ Found explore link:`, match[0]);
  }
  
  console.log(`🔍 Found ${exploreLinks.length} explore links`);
  
  // Nếu không có explore links, chỉ xóa các markdown links khác và return
  if (exploreLinks.length === 0) {
    console.log('🔍 No explore links found, removing all markdown links');
    let processedText = text;
    processedText = processedText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    processedText = processedText.replace(/\[roomDetailLink:[^\]]+\]/g, '');
    processedText = processedText.replace(/\[bookingLink:[^\]]+\]/g, '');
    processedText = processedText.replace(/\[paymentLink:[^\]]+\]/g, '');
    return processedText;
  }
  
  // ✅ Tạo placeholder với format đặc biệt để không bị regex match
  const placeholders = exploreLinks.map((link, i) => {
    // Dùng format đặc biệt với nhiều ký tự đặc biệt để không bị match bởi regex markdown
    return `__EXPLORE_PLACEHOLDER_${i}_${Math.random().toString(36).substr(2, 9)}__`;
  });
  
  // ✅ Thay thế explore links bằng placeholder (từ cuối lên để không ảnh hưởng index)
  let processedText = text;
  for (let i = exploreLinks.length - 1; i >= 0; i--) {
    const beforeReplace = processedText;
    processedText = processedText.replace(exploreLinks[i], placeholders[i]);
    const afterReplace = processedText;
    console.log(`🔍 Replaced explore link ${i}:`, {
      found: beforeReplace.includes(exploreLinks[i]),
      replaced: !afterReplace.includes(exploreLinks[i]),
      hasPlaceholder: afterReplace.includes(placeholders[i]),
      linkPreview: exploreLinks[i].substring(0, 50)
    });
  }
  
  // ✅ Kiểm tra placeholder có trong text không
  const hasPlaceholders = placeholders.every(p => processedText.includes(p));
  console.log('🔍 Has all placeholders after replace:', hasPlaceholders);
  if (!hasPlaceholders) {
    console.error('❌ ERROR: Placeholders not found after replace!');
    // Fallback: return text gốc
    return text;
  }
  
  // ✅ Loại bỏ các markdown links khác (KHÔNG động vào placeholder)
  // Pattern: [text](url) - chỉ match các link KHÔNG phải placeholder
  const beforeRemoveLinks = processedText;
  processedText = processedText.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, linkText, url) => {
    // Nếu match là một phần của placeholder, giữ nguyên
    // (Nhưng thực tế placeholder không có format markdown nên không bị match)
    return linkText; // Xóa link, chỉ giữ text
  });
  
  // Loại bỏ các format đặc biệt
  processedText = processedText.replace(/\[roomDetailLink:[^\]]+\]/g, '');
  processedText = processedText.replace(/\[bookingLink:[^\]]+\]/g, '');
  processedText = processedText.replace(/\[paymentLink:[^\]]+\]/g, '');
  
  // ✅ Kiểm tra placeholder vẫn còn sau khi xóa links khác
  const stillHasPlaceholders = placeholders.every(p => processedText.includes(p));
  console.log('🔍 Still has all placeholders after removing other links:', stillHasPlaceholders);
  if (!stillHasPlaceholders) {
    console.error('❌ ERROR: Placeholders were removed!');
    // Restore từ đầu
    processedText = text;
    for (let i = exploreLinks.length - 1; i >= 0; i--) {
      processedText = processedText.replace(exploreLinks[i], placeholders[i]);
    }
    processedText = processedText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    processedText = processedText.replace(/\[roomDetailLink:[^\]]+\]/g, '');
    processedText = processedText.replace(/\[bookingLink:[^\]]+\]/g, '');
    processedText = processedText.replace(/\[paymentLink:[^\]]+\]/g, '');
  }
  
  // ✅ Khôi phục explore links từ placeholder
  for (let i = 0; i < placeholders.length; i++) {
    const beforeRestore = processedText.includes(placeholders[i]);
    processedText = processedText.replace(placeholders[i], exploreLinks[i]);
    const afterRestore = processedText.includes(exploreLinks[i]);
    console.log(`🔍 Restored explore link ${i}:`, {
      hadPlaceholder: beforeRestore,
      hasLink: afterRestore,
      linkPreview: exploreLinks[i].substring(0, 50)
    });
  }
  
  // ✅ Final check
  const hasExploreLink = /\[([^\]]+)\]\(explore\)/.test(processedText);
  console.log('🔍 removeMarkdownLinks - Output text preview:', processedText.substring(0, 300));
  console.log('🔍 Final check - Has explore link:', hasExploreLink);
  if (hasExploreLink) {
    const matches = processedText.match(/\[([^\]]+)\]\(explore\)/g);
    console.log('✅ Explore links in output:', matches);
  } else {
    console.error('❌ ERROR: Explore link was removed! Original had:', exploreLinks.length, 'links');
    // Fallback: return text gốc nếu link bị mất
    return text;
  }
  
  return processedText;
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

    // ✅ BƯỚC 1: Kiểm tra booking overlap từ Database (chính)
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

    if (overlappingBooking) {
      return false; // Có booking overlap trong Database
    }

    // ✅ BƯỚC 2: Kiểm tra conflict từ Google Calendar (backup, optional)
    try {
      // Lấy thông tin phòng để có roomNumber
      const room = await Room.findById(roomId).lean();
      if (room && room.roomNumber) {
        const hasCalendarConflict = await googleCalendarService.checkBookingConflict(
          checkIn,
          checkOut,
          room.roomNumber
        );
        
        if (hasCalendarConflict) {
          console.warn(`⚠️ Calendar conflict detected for room ${room.roomNumber}`);
          return false; // Có conflict trong Calendar
        }
      }
    } catch (calendarError) {
      // Nếu Calendar check fail, không block booking (vì Database là source of truth)
      console.warn('⚠️ Calendar check failed (non-blocking):', calendarError.message);
    }

    return true; // Không có conflict, phòng available
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

// Function để parse explore intent (lịch sử, chủ, tính năng, địa điểm) từ user message
const parseExploreIntent = (userMessage) => {
  const lowerMessage = userMessage.toLowerCase();
  const intent = {
    type: null, // 'history', 'owner', 'features', 'nearby', 'explore_general'
    category: null, // Cho nearby: 'attraction', 'restaurant', 'shopping', etc.
    specificFeature: null // Cho features: 'chatbot', 'booking', 'calendar', etc.
  };

  // Keywords cho lịch sử
  const historyKeywords = [
    'lịch sử', 'thành lập', 'có từ bao giờ', 'câu chuyện', 'hành trình phát triển',
    'bao nhiêu năm', 'tiêu chuẩn 5 sao', 'giải thưởng', 'ra đời', 'khởi nghiệp',
    'history', 'founded', 'established', 'story'
  ];
  
  // Keywords cho chủ khách sạn
  const ownerKeywords = [
    'chủ khách sạn', 'chủ sở hữu', 'người sáng lập', 'giám đốc', 'chủ tịch',
    'owner', 'founder', 'director', 'president', 'người điều hành'
  ];
  
  // Keywords cho tính năng mới
  const featuresKeywords = [
    'tính năng mới', 'công nghệ mới', 'chatbot ai', 'đặt phòng online',
    'quản lý booking', 'google calendar', 'thanh toán online', 'địa điểm gần',
    'tiện ích mới', 'tính năng nổi bật', 'công nghệ khách sạn', 'dịch vụ mới',
    '6 tính năng', 'tính năng công nghệ', 'công nghệ hiện đại', 'hiện đại nhất',
    'tính năng công nghệ hiện đại', 'công nghệ hiện đại nhất', '6 tính năng công nghệ',
    'new features', 'new technology', 'ai chatbot', 'online booking',
    '6 features', 'technology features', 'modern technology', 'latest technology'
  ];
  
  // Keywords cho địa điểm gần
  const nearbyKeywords = [
    'địa điểm gần', 'đi đâu gần', 'nhà hàng gần', 'điểm tham quan',
    'mua sắm gần', 'quán ăn gần', 'đi chơi đâu', 'du lịch gần',
    'địa điểm tham quan gần', 'ăn uống gần', 'shopping gần',
    'bệnh viện gần', 'ngân hàng gần', 'nearby', 'restaurant near',
    'attraction', 'shopping near'
  ];
  
  // Keywords cho khám phá tổng hợp
  const exploreKeywords = [
    'khám phá', 'tìm hiểu khách sạn', 'thông tin khách sạn', 'giới thiệu khách sạn',
    'về khách sạn', 'khách sạn có gì', 'explore', 'about hotel', 'hotel info'
  ];

  // Kiểm tra intent theo thứ tự ưu tiên
  if (historyKeywords.some(keyword => lowerMessage.includes(keyword))) {
    intent.type = 'history';
  } else if (ownerKeywords.some(keyword => lowerMessage.includes(keyword))) {
    intent.type = 'owner';
  } else if (nearbyKeywords.some(keyword => lowerMessage.includes(keyword))) {
    intent.type = 'nearby';
    // Parse category nếu có
    if (lowerMessage.includes('nhà hàng') || lowerMessage.includes('restaurant') || lowerMessage.includes('ăn')) {
      intent.category = 'restaurant';
    } else if (lowerMessage.includes('điểm tham quan') || lowerMessage.includes('attraction') || lowerMessage.includes('thăm quan')) {
      intent.category = 'attraction';
    } else if (lowerMessage.includes('mua sắm') || lowerMessage.includes('shopping') || lowerMessage.includes('cửa hàng')) {
      intent.category = 'shopping';
    } else if (lowerMessage.includes('bệnh viện') || lowerMessage.includes('hospital')) {
      intent.category = 'hospital';
    } else if (lowerMessage.includes('ngân hàng') || lowerMessage.includes('bank') || lowerMessage.includes('atm')) {
      intent.category = lowerMessage.includes('atm') ? 'atm' : 'bank';
    } else if (lowerMessage.includes('bưu điện') || lowerMessage.includes('post office')) {
      intent.category = 'post_office';
    }
  } else if (featuresKeywords.some(keyword => lowerMessage.includes(keyword))) {
    intent.type = 'features';
    // Parse tính năng cụ thể nếu có
    if (lowerMessage.includes('chatbot') || lowerMessage.includes('ai')) {
      intent.specificFeature = 'chatbot';
    } else if (lowerMessage.includes('đặt phòng') || lowerMessage.includes('booking')) {
      intent.specificFeature = 'booking';
    } else if (lowerMessage.includes('calendar') || lowerMessage.includes('lịch')) {
      intent.specificFeature = 'calendar';
    } else if (lowerMessage.includes('quản lý') || lowerMessage.includes('manage')) {
      intent.specificFeature = 'manage';
    } else if (lowerMessage.includes('thanh toán') || lowerMessage.includes('payment')) {
      intent.specificFeature = 'payment';
    } else if (lowerMessage.includes('địa điểm') || lowerMessage.includes('nearby')) {
      intent.specificFeature = 'nearby';
    }
  } else if (exploreKeywords.some(keyword => lowerMessage.includes(keyword))) {
    intent.type = 'explore_general';
  }

  return intent;
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
  
  // ✅ Kiểm tra xem user có muốn chọn lại phòng khác không
  // "không muốn phòng này nữa", "chọn lại phòng khác", "không thích phòng này", "đổi phòng"
  const isChangingRoom = (lowerMessage.includes("không muốn") && (lowerMessage.includes("phòng này") || lowerMessage.includes("phòng đó"))) ||
    (lowerMessage.includes("chọn lại") && (lowerMessage.includes("phòng") || lowerMessage.includes("room"))) ||
    (lowerMessage.includes("không thích") && (lowerMessage.includes("phòng này") || lowerMessage.includes("phòng đó"))) ||
    (lowerMessage.includes("đổi phòng") || lowerMessage.includes("change room")) ||
    (lowerMessage.includes("muốn chọn") && lowerMessage.includes("phòng khác")) ||
    (lowerMessage.includes("don't want") && (lowerMessage.includes("this room") || lowerMessage.includes("that room"))) ||
    (lowerMessage.includes("choose another") && (lowerMessage.includes("room") || lowerMessage.includes("phòng")));
  
  if (isChangingRoom && (context.selectedRoom || context.bookingContext?.roomId)) {
    intent.action = 'change_room'; // Action mới để xử lý đổi phòng
    console.log('✅ Detected change room request');
  }
  
  // ✅ Kiểm tra xem có xác nhận đặt phòng hoặc chốt phòng không
  // "chốt phòng đó", "chốt phòng này", "đặt phòng đó", "đặt phòng này" = muốn xác nhận phòng đã chọn
  const isConfirmingSelectedRoom = lowerMessage.includes("chốt phòng") || 
    lowerMessage.includes("đặt phòng đó") || 
    lowerMessage.includes("đặt phòng này") ||
    (lowerMessage.includes("phòng đó") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt"))) ||
    (lowerMessage.includes("phòng này") && (lowerMessage.includes("chốt") || lowerMessage.includes("đặt")));
  
  if (isConfirmingSelectedRoom && !isChangingRoom) {
    // Nếu đã có selectedRoom, đây là yêu cầu xác nhận và hiển thị chi tiết phòng đã chọn
    if (context.selectedRoom || context.bookingContext?.roomId) {
      intent.action = 'confirm_room_selection'; // Action mới để phân biệt với confirm_booking
      intent.confirmBooking = false; // Chưa phải confirm booking, chỉ confirm room selection
    }
  } else if (!isChangingRoom && (lowerMessage.includes("có") || lowerMessage.includes("đồng ý") || lowerMessage.includes("ok") || 
      lowerMessage.includes("đặt luôn") || 
      lowerMessage.includes("yes") || lowerMessage.includes("okay") ||
      lowerMessage.includes("xác nhận") || lowerMessage.includes("confirm"))) {
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
    // ✅ ƯU TIÊN: Parse "phòng số X" trước khi parse "X phòng"
    // Pattern rõ ràng về chọn phòng từ list (ưu tiên cao nhất)
    const roomSelectPatterns = [
      /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(?:số|thứ|number)\s*(\d+)/i, // "chọn phòng số 2", "đặt phòng thứ 3"
      /phòng\s*(?:số|thứ|number)\s*(\d+)/i, // "phòng số 2", "phòng thứ 3" - ✅ QUAN TRỌNG: Pattern này phải ưu tiên
      /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(\d+)(?!\s*người)/i, // "chọn phòng 2" (không có "người" sau)
      /phòng\s*(\d+)(?!\s*người)/i, // "phòng 2" (không có "người" sau) - chỉ khi có context.lastRoomSearchResults
      /số\s*(\d+)/i, // "số 2"
      /^(\d+)$/ // Chỉ có số (chỉ khi có context.lastRoomSearchResults)
    ];
    
    let roomSelected = false;
    for (const pattern of roomSelectPatterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        const roomNum = parseInt(match[1]);
        // ✅ Nếu có list phòng, ưu tiên coi đây là chọn phòng từ list
        if (hasRoomList && roomNum >= 1 && roomNum <= context.lastRoomSearchResults.length) {
          intent.action = 'select_room';
          intent.roomNumber = roomNum;
          roomSelected = true;
          console.log(`✅ Parsed room selection: "phòng số ${roomNum}" (from list of ${context.lastRoomSearchResults.length} rooms)`);
          break;
        }
        // Chỉ coi là chọn phòng nếu:
        // 1. Số hợp lý (1-20) VÀ
        // 2. Có từ khóa "chọn/đặt/phòng thứ/phòng số"
        const hasSelectKeyword = /(?:chọn|đặt|muốn|book|select|số|thứ)/i.test(lowerMessage);
        if (roomNum >= 1 && roomNum <= 20 && hasSelectKeyword) {
          intent.action = 'select_room';
          intent.roomNumber = roomNum;
          roomSelected = true;
          break;
        }
      }
    }
    
    // ✅ QUAN TRỌNG: Nếu đã parse được "phòng số X", KHÔNG parse "X phòng" nữa
    // Tránh hiểu nhầm "phòng số 2" thành "2 phòng"
    if (roomSelected) {
      console.log(`✅ Room selection detected, skipping quantity parse to avoid confusion`);
    } else {
      // Chỉ parse "X phòng" nếu KHÔNG phải là chọn phòng từ list
      // Kiểm tra xem có số phòng không (2 phòng, 3 phòng, etc.)
      // ✅ QUAN TRỌNG: Chỉ parse nếu KHÔNG có pattern "phòng số X" hoặc "số X"
      const hasRoomNumberPattern = /phòng\s*(?:số|thứ|number)\s*\d+|số\s*\d+/i.test(lowerMessage);
      if (!hasRoomNumberPattern) {
        const quantityMatch = lowerMessage.match(/(\d+)\s*(?:phòng|room)/);
        if (quantityMatch) {
          intent.roomQuantity = parseInt(quantityMatch[1]);
          console.log(`✅ Parsed room quantity: ${intent.roomQuantity} rooms`);
        }
      }
    }
  } else {
    // Nếu có "người" sau số, chỉ parse quantity nếu không có pattern "phòng số X"
    const hasRoomNumberPattern = /phòng\s*(?:số|thứ|number)\s*\d+|số\s*\d+/i.test(lowerMessage);
    if (!hasRoomNumberPattern) {
      const quantityMatch = lowerMessage.match(/(\d+)\s*(?:phòng|room)/);
      if (quantityMatch) {
        intent.roomQuantity = parseInt(quantityMatch[1]);
      }
    }
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

// ✅ Function để tạo booking link với query params - ĐẦY ĐỦ THÔNG TIN
const createBookingLink = (bookingData) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const params = new URLSearchParams();
  
  // ✅ QUAN TRỌNG: Luôn thêm roomId
  if (bookingData.roomId) {
    params.append('roomId', bookingData.roomId);
  }
  
  // ✅ Thêm các thông tin booking nếu có
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
  if (bookingData.roomQuantity) {
    params.append('roomQuantity', bookingData.roomQuantity);
  }
  if (bookingData.guests) {
    params.append('guests', bookingData.guests);
  }
  
  // ✅ QUAN TRỌNG: Thêm thông tin khách hàng nếu có (để pre-fill form)
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

  // ✅ Return booking link với đầy đủ thông tin
  const link = `${baseUrl}/booking?${params.toString()}`;
  console.log('✅ Created booking link:', link);
  return link;
};

// ✅ Helper: Tạo link xem chi tiết phòng cho room cards
const createRoomDetailLink = (roomId) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (!roomId) return `${baseUrl}/rooms`;
  return `${baseUrl}/rooms/${roomId}`;
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

// ✅ THÊM: Rule-based responses cho câu hỏi đơn giản (không cần gọi API)
const getRuleBasedResponse = (userMessage, language = 'vi') => {
  const lowerMessage = userMessage.toLowerCase().trim();
  
  // Mapping câu hỏi đơn giản → response
  const simpleResponses = {
    vi: {
      'xin chào': 'Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp gì cho bạn?',
      'hello': 'Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp gì cho bạn?',
      'hi': 'Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp gì cho bạn?',
      'chào': 'Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp gì cho bạn?',
      'cảm ơn': 'Không có gì! Rất vui được hỗ trợ bạn. Nếu có thắc mắc gì khác, đừng ngại hỏi nhé!',
      'thanks': 'Không có gì! Rất vui được hỗ trợ bạn. Nếu có thắc mắc gì khác, đừng ngại hỏi nhé!',
      'tạm biệt': 'Tạm biệt! Chúc bạn một ngày tốt lành. Hẹn gặp lại!',
      'bye': 'Tạm biệt! Chúc bạn một ngày tốt lành. Hẹn gặp lại!',
      'hotline': 'Hotline của chúng tôi là: 0901 234 567. Bạn có thể gọi bất cứ lúc nào!',
      'số điện thoại': 'Hotline của chúng tôi là: 0901 234 567. Bạn có thể gọi bất cứ lúc nào!',
      'giờ check-in': 'Giờ check-in là từ 14:00. Bạn có thể đến sớm hơn để tham quan khách sạn!',
      'giờ check-out': 'Giờ check-out là trước 12:00. Nếu cần check-out muộn, vui lòng liên hệ lễ tân!',
      'địa chỉ': 'Địa chỉ khách sạn: 123 Đường ABC, Quận XYZ, TP. Hồ Chí Minh. Bạn có thể tìm trên Google Maps!',
      // ✅ THÊM: Booking-related responses
      'đặt phòng thì sao': 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      'cách đặt phòng': 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      'muốn đặt phòng': 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      'làm sao để đặt phòng': 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      'giá phòng': 'Giá phòng của chúng tôi dao động từ 1.500.000 VNĐ đến 5.000.000 VNĐ/đêm tùy theo loại phòng. Để biết giá chính xác, vui lòng cho tôi biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ tìm phòng phù hợp với ngân sách của bạn! 💰',
      'giá phòng là bao nhiêu': 'Giá phòng của chúng tôi dao động từ 1.500.000 VNĐ đến 5.000.000 VNĐ/đêm tùy theo loại phòng. Để biết giá chính xác, vui lòng cho tôi biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ tìm phòng phù hợp với ngân sách của bạn! 💰',
      'có wifi không': 'Có! Khách sạn chúng tôi có WiFi miễn phí tốc độ cao trong toàn bộ khu vực. Mật khẩu sẽ được cung cấp khi bạn check-in. 📶',
      'có bãi đỗ xe không': 'Có! Khách sạn có bãi đỗ xe miễn phí cho khách lưu trú. Bạn có thể để xe tại đây trong suốt thời gian lưu trú. 🚗',
      'có bữa sáng không': 'Có! Khách sạn phục vụ bữa sáng buffet từ 6:00 - 10:00 sáng hàng ngày. Bữa sáng được bao gồm trong giá phòng hoặc có thể đặt thêm. 🍳',
      'dịch vụ của khách sạn': 'Khách sạn chúng tôi cung cấp các dịch vụ:\n- WiFi miễn phí\n- Bữa sáng buffet\n- Bãi đỗ xe\n- Phòng gym\n- Hồ bơi\n- Spa & Massage\n- Dịch vụ giặt ủi\n- Room service 24/7\n\nBạn muốn biết thêm chi tiết về dịch vụ nào? 🏨',
      // ✅ GIAI ĐOẠN 1: Thêm 20+ câu hỏi thường gặp
      'phòng có bao nhiêu loại': 'Khách sạn chúng tôi có 4 loại phòng:\n- Phòng Đơn (1-2 người)\n- Phòng Đôi (2 người)\n- Phòng VIP (2-4 người)\n- Phòng Suite (4-6 người)\n\nBạn muốn đặt loại phòng nào?',
      'có mấy loại phòng': 'Khách sạn chúng tôi có 4 loại phòng:\n- Phòng Đơn (1-2 người)\n- Phòng Đôi (2 người)\n- Phòng VIP (2-4 người)\n- Phòng Suite (4-6 người)\n\nBạn muốn đặt loại phòng nào?',
      'chính sách hủy phòng': 'Chính sách hủy phòng:\n- Hủy trước 24h: Miễn phí\n- Hủy trong 24h: Phí 50%\n- Không hủy: Phí 100%\n\nVui lòng liên hệ hotline để hủy phòng: 0901 234 567',
      'hủy phòng': 'Chính sách hủy phòng:\n- Hủy trước 24h: Miễn phí\n- Hủy trong 24h: Phí 50%\n- Không hủy: Phí 100%\n\nVui lòng liên hệ hotline để hủy phòng: 0901 234 567',
      'có phòng gym không': 'Có! Khách sạn có phòng gym hiện đại mở cửa 24/7. Miễn phí cho khách lưu trú. 💪',
      'có hồ bơi không': 'Có! Khách sạn có hồ bơi ngoài trời rộng rãi. Mở cửa từ 6:00 - 22:00 hàng ngày. 🏊',
      'có spa không': 'Có! Khách sạn có spa và massage. Vui lòng đặt lịch trước qua hotline: 0901 234 567. 💆',
      'cách thanh toán': 'Chúng tôi chấp nhận:\n- Tiền mặt\n- Thẻ tín dụng/ghi nợ\n- Chuyển khoản ngân hàng\n- VNPay\n\nThanh toán tại lễ tân khi check-in.',
      'phương thức thanh toán': 'Chúng tôi chấp nhận:\n- Tiền mặt\n- Thẻ tín dụng/ghi nợ\n- Chuyển khoản ngân hàng\n- VNPay\n\nThanh toán tại lễ tân khi check-in.',
      'thời gian nhận phòng': 'Giờ check-in: Từ 14:00\nGiờ check-out: Trước 12:00\n\nNếu đến sớm, bạn có thể gửi hành lý tại lễ tân.',
      'có thể check-in sớm không': 'Có thể! Check-in sớm tùy thuộc vào tình trạng phòng. Vui lòng liên hệ trước qua hotline: 0901 234 567.',
      'có thể check-out muộn không': 'Có thể! Check-out muộn tùy thuộc vào tình trạng phòng. Phí: 50% giá phòng/giờ. Vui lòng liên hệ lễ tân.',
      'có shuttle bus không': 'Có! Khách sạn có dịch vụ đưa đón sân bay (có phí). Vui lòng đặt trước qua hotline: 0901 234 567. 🚌',
      'đưa đón sân bay': 'Có! Khách sạn có dịch vụ đưa đón sân bay (có phí). Vui lòng đặt trước qua hotline: 0901 234 567. 🚌',
      'có phòng họp không': 'Có! Khách sạn có phòng họp với sức chứa từ 20-200 người. Vui lòng đặt trước qua hotline: 0901 234 567. 📋',
      'phòng họp': 'Có! Khách sạn có phòng họp với sức chứa từ 20-200 người. Vui lòng đặt trước qua hotline: 0901 234 567. 📋',
      'có nhà hàng không': 'Có! Khách sạn có nhà hàng phục vụ các món Á và Âu. Mở cửa từ 6:00 - 22:00 hàng ngày. 🍽️',
      'nhà hàng': 'Có! Khách sạn có nhà hàng phục vụ các món Á và Âu. Mở cửa từ 6:00 - 22:00 hàng ngày. 🍽️',
      'có bar không': 'Có! Khách sạn có bar trên tầng thượng với view đẹp. Mở cửa từ 18:00 - 24:00. 🍸',
      'bar': 'Có! Khách sạn có bar trên tầng thượng với view đẹp. Mở cửa từ 18:00 - 24:00. 🍸',
      'có phục vụ room service không': 'Có! Khách sạn có room service 24/7. Gọi số 0901 234 567 để đặt món. 🍽️',
      'room service': 'Có! Khách sạn có room service 24/7. Gọi số 0901 234 567 để đặt món. 🍽️',
    },
    en: {
      'hello': 'Hello! I am the virtual assistant of Rayal Park Hotel. How can I help you?',
      'hi': 'Hello! I am the virtual assistant of Rayal Park Hotel. How can I help you?',
      'thanks': "You're welcome! Happy to help. If you have any other questions, feel free to ask!",
      'thank you': "You're welcome! Happy to help. If you have any other questions, feel free to ask!",
      'bye': 'Goodbye! Have a great day. See you again!',
      'hotline': 'Our hotline is: 0901 234 567. You can call anytime!',
      'phone number': 'Our hotline is: 0901 234 567. You can call anytime!',
      'check-in time': 'Check-in time is from 2:00 PM. You can arrive earlier to explore the hotel!',
      'check-out time': 'Check-out time is before 12:00 PM. If you need late check-out, please contact reception!',
      'address': 'Hotel address: 123 ABC Street, XYZ District, Ho Chi Minh City. You can find it on Google Maps!',
      // ✅ THÊM: Booking-related responses (English)
      'how to book': 'To book a room, please provide:\n- Check-in date\n- Check-out date\n- Number of guests\n- Email and phone number\n\nI will find a suitable room for you! 😊',
      'want to book': 'To book a room, please provide:\n- Check-in date\n- Check-out date\n- Number of guests\n- Email and phone number\n\nI will find a suitable room for you! 😊',
      'room price': 'Our room prices range from 1,500,000 VND to 5,000,000 VND per night depending on room type. For exact pricing, please provide:\n- Check-in date\n- Check-out date\n- Number of guests\n\nI will find a room that fits your budget! 💰',
      'wifi': 'Yes! Our hotel has free high-speed WiFi throughout the entire area. The password will be provided upon check-in. 📶',
      'parking': 'Yes! The hotel has free parking for guests. You can park your car here throughout your stay. 🚗',
      'breakfast': 'Yes! The hotel serves buffet breakfast from 6:00 AM - 10:00 AM daily. Breakfast is included in room rate or can be added. 🍳',
      'hotel services': 'Our hotel provides:\n- Free WiFi\n- Buffet breakfast\n- Parking\n- Gym\n- Swimming pool\n- Spa & Massage\n- Laundry service\n- 24/7 Room service\n\nWhich service would you like to know more about? 🏨',
      // ✅ GIAI ĐOẠN 1: Thêm 20+ câu hỏi thường gặp (English)
      'room types': 'Our hotel has 4 room types:\n- Single Room (1-2 people)\n- Double Room (2 people)\n- VIP Room (2-4 people)\n- Suite (4-6 people)\n\nWhich room type would you like to book?',
      'cancellation policy': 'Cancellation Policy:\n- Cancel 24h before: Free\n- Cancel within 24h: 50% fee\n- No show: 100% fee\n\nPlease contact hotline to cancel: 0901 234 567',
      'gym': 'Yes! The hotel has a modern gym open 24/7. Free for hotel guests. 💪',
      'swimming pool': 'Yes! The hotel has an outdoor swimming pool. Open from 6:00 AM - 10:00 PM daily. 🏊',
      'spa': 'Yes! The hotel has spa and massage services. Please book in advance via hotline: 0901 234 567. 💆',
      'payment methods': 'We accept:\n- Cash\n- Credit/Debit cards\n- Bank transfer\n- VNPay\n\nPayment at reception upon check-in.',
      'early check-in': 'Possible! Early check-in depends on room availability. Please contact in advance via hotline: 0901 234 567.',
      'late check-out': 'Possible! Late check-out depends on room availability. Fee: 50% of room rate per hour. Please contact reception.',
      'airport shuttle': 'Yes! The hotel provides airport shuttle service (fee applies). Please book in advance via hotline: 0901 234 567. 🚌',
      'meeting room': 'Yes! The hotel has meeting rooms with capacity from 20-200 people. Please book in advance via hotline: 0901 234 567. 📋',
      'restaurant': 'Yes! The hotel has a restaurant serving Asian and European cuisine. Open from 6:00 AM - 10:00 PM daily. 🍽️',
      'bar': 'Yes! The hotel has a rooftop bar with beautiful views. Open from 6:00 PM - 12:00 AM. 🍸',
      'room service': 'Yes! The hotel has 24/7 room service. Call 0901 234 567 to order. 🍽️',
    }
  };
  
  const responses = simpleResponses[language] || simpleResponses.vi;
  
  // Tìm exact match hoặc starts with
  for (const [key, response] of Object.entries(responses)) {
    if (lowerMessage === key || lowerMessage.startsWith(key + ' ')) {
      return response;
    }
  }
  
  // Tìm partial match (chứa keyword)
  for (const [key, response] of Object.entries(responses)) {
    if (lowerMessage.includes(key)) {
      return response;
    }
  }
  
  return null; // Không tìm thấy, cần dùng AI
};

// ✅ THÊM: Response Cache System - Lưu và tái sử dụng AI responses
const responseCache = new Map();
const MAX_CACHE_SIZE = 500; // ✅ GIAI ĐOẠN 1: Tăng từ 200 → 500

/**
 * Lấy cached response nếu có
 * @param {string} userMessage - User message
 * @returns {object|null} - Cached response hoặc null
 */
const getCachedResponse = (userMessage) => {
  const cacheKey = userMessage.toLowerCase().trim();
  const cached = responseCache.get(cacheKey);
  
  if (cached) {
    console.log('✅ Using cached response (no API call)');
    return cached;
  }
  
  return null;
};

/**
 * Lưu response vào cache
 * @param {string} userMessage - User message
 * @param {object} response - AI response
 */
const setCachedResponse = (userMessage, response) => {
  const cacheKey = userMessage.toLowerCase().trim();
  
  // Chỉ cache nếu response hợp lệ
  if (response && response.text) {
    responseCache.set(cacheKey, response);
    
    // Giới hạn cache size (FIFO - First In First Out)
    if (responseCache.size > MAX_CACHE_SIZE) {
      const firstKey = responseCache.keys().next().value;
      responseCache.delete(firstKey);
      console.log(`🗑️  Removed oldest cache entry (cache size: ${responseCache.size})`);
    }
    
    console.log(`💾 Cached response (cache size: ${responseCache.size})`);
  }
};

/**
 * Clear cache (cho testing hoặc khi cần)
 */
const clearResponseCache = () => {
  responseCache.clear();
  console.log('🗑️  Response cache cleared');
};

/**
 * Get cache stats
 */
const getCacheStats = () => {
  return {
    size: responseCache.size,
    maxSize: MAX_CACHE_SIZE
  };
};

// ✅ GIAI ĐOẠN 1: Rate Limiting per User/Session
// Giới hạn số AI calls mỗi user/ngày để đảm bảo nhiều user có thể sử dụng
const userRateLimit = new Map();

/**
 * Kiểm tra rate limit cho user/session (chỉ check, không tăng counter)
 * @param {string} sessionId - Session ID hoặc user ID
 * @returns {object} - { allowed: boolean, message?: string }
 */
const checkUserRateLimit = (sessionId) => {
  if (!sessionId) {
    // Nếu không có sessionId, cho phép (guest user)
    return { allowed: true };
  }
  
  const today = new Date().toDateString();
  const key = `${sessionId}_${today}`;
  
  const userLimit = userRateLimit.get(key) || {
    count: 0,
    lastReset: today
  };
  
  // Reset nếu sang ngày mới
  if (userLimit.lastReset !== today) {
    userLimit.count = 0;
    userLimit.lastReset = today;
  }
  
  // ✅ QUAN TRỌNG: Giới hạn 10 AI calls/user/ngày
  // Rule-based và cached responses KHÔNG bị giới hạn
  const MAX_AI_CALLS_PER_USER = 10;
  
  if (userLimit.count >= MAX_AI_CALLS_PER_USER) {
    return {
      allowed: false,
      message: 'Bạn đã sử dụng hết lượt hỏi AI hôm nay (10 lượt). Bạn vẫn có thể hỏi các câu hỏi thường gặp hoặc liên hệ hotline: 0901 234 567 để được hỗ trợ thêm.'
    };
  }
  
  return { allowed: true };
};

/**
 * Tăng counter cho user/session (sau khi gọi AI thành công)
 * @param {string} sessionId - Session ID hoặc user ID
 */
const incrementUserRateLimit = (sessionId) => {
  if (!sessionId) {
    return; // Guest user không cần track
  }
  
  const today = new Date().toDateString();
  const key = `${sessionId}_${today}`;
  
  const userLimit = userRateLimit.get(key) || {
    count: 0,
    lastReset: today
  };
  
  // Reset nếu sang ngày mới
  if (userLimit.lastReset !== today) {
    userLimit.count = 0;
    userLimit.lastReset = today;
  }
  
  userLimit.count++;
  userRateLimit.set(key, userLimit);
  
  console.log(`📊 User ${sessionId} AI call count: ${userLimit.count}/10`);
};

/**
 * Get rate limit stats cho user
 * @param {string} sessionId - Session ID hoặc user ID
 * @returns {object|null} - { count, maxCalls, remaining } hoặc null
 */
const getUserRateLimitStats = (sessionId) => {
  if (!sessionId) return null;
  
  const today = new Date().toDateString();
  const key = `${sessionId}_${today}`;
  const userLimit = userRateLimit.get(key);
  
  if (!userLimit) {
    return { count: 0, maxCalls: 10, remaining: 10 };
  }
  
  return {
    count: userLimit.count,
    maxCalls: 10,
    remaining: Math.max(0, 10 - userLimit.count)
  };
};

// ✅ THÊM: Pattern-based Booking Handler - Xử lý booking flow bằng logic
/**
 * Xử lý các pattern booking cụ thể bằng logic (không cần AI)
 * @param {string} userMessage - User message
 * @param {object} context - Conversation context
 * @returns {object|null} - Response object hoặc null nếu không match
 */
const getPatternBasedResponse = async (userMessage, context = {}) => {
  const lower = userMessage.toLowerCase().trim();
  
  // Pattern 1: "tôi muốn đặt phòng" hoặc "đặt phòng thì sao" → Hướng dẫn
  if (lower.includes('muốn đặt phòng') || 
      lower.includes('đặt phòng thì sao') || 
      lower.includes('cách đặt phòng') ||
      lower.includes('làm sao để đặt phòng')) {
    return {
      text: 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      rooms: null,
      hasRooms: false
    };
  }
  
  // Pattern 2: Đã có đủ thông tin booking trong context → Tự động tìm phòng từ DB
  const bookingContext = context.bookingContext || {};
  const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
  const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
  const wantsSeaView = lower.includes('view biển') || lower.includes('biển') || lower.includes('sea view') || lower.includes('ocean view') || lower.includes('hướng biển');
  // Lưu dấu hiệu khách muốn view biển để dùng khi họ cung cấp ngày sau đó
  if (wantsSeaView) {
    context.requestedView = 'biển';
    if (context.session) {
      context.session.requestedView = 'biển';
    }
  } else if (!wantsSeaView && !context.requestedView && context.session?.requestedView) {
    context.requestedView = context.session.requestedView;
  }

  // Pattern: Khách đã cung cấp ngày và muốn phòng view biển (từ message hiện tại hoặc lưu từ trước) → tìm tất cả phòng view biển còn trống
  if ((wantsSeaView || context.requestedView === 'biển') && hasDates) {
    const criteria = {
      checkInDate: bookingContext.checkInDate,
      checkOutDate: bookingContext.checkOutDate,
      view: 'biển', // regex i trong searchRooms
    };

    try {
      const seaViewRooms = await searchRooms(criteria);
      if (seaViewRooms.length > 0) {
        // Lưu list để bước chọn phòng
        context.lastRoomSearchResults = seaViewRooms;
        const listText = seaViewRooms
          .map((r, idx) => `${idx + 1}. ${r.name} - ${r.pricePerNight?.toLocaleString('vi-VN') || 'N/A'} VNĐ/đêm (Sức chứa: ${r.maxOccupancy || 'N/A'})`)
          .join('\n');
        const response = {
          text: `Mình đã tìm được ${seaViewRooms.length} phòng view biển trống từ ${new Date(criteria.checkInDate).toLocaleDateString('vi-VN')} đến ${new Date(criteria.checkOutDate).toLocaleDateString('vi-VN')}:\n${listText}\n\nBạn muốn chọn phòng số mấy?`,
          rooms: seaViewRooms.map(r => ({
            id: r._id.toString(),
            name: r.name,
            roomType: r.roomType,
            pricePerNight: r.pricePerNight,
            maxOccupancy: r.maxOccupancy,
            view: r.view,
            image: r.image || r.thumbnailUrl || '',
            amenities: Array.isArray(r.amenities) ? r.amenities : []
          })),
          hasRooms: true
        };
        // Reset requestedView after đã trả list
        context.requestedView = null;
        if (context.session) {
          context.session.requestedView = null;
        }
        return response;
      }
      // Không còn phòng view biển
      const response = {
        text: 'Hiện tại không còn phòng view biển trong khoảng thời gian này. Bạn muốn mình tìm phòng view khác hoặc loại phòng khác không?',
        rooms: null,
        hasRooms: false
      };
      context.requestedView = null;
      if (context.session) {
        context.session.requestedView = null;
      }
      return response;
    } catch (err) {
      console.error('❌ Error searching sea view rooms:', err);
      return {
        text: 'Mình sẽ kiểm tra lại phòng view biển, vui lòng thử lại sau hoặc cho mình biết nếu muốn xem các phòng khác.',
        rooms: null,
        hasRooms: false
      };
    }
  }
  
  // Nếu đã có đủ thông tin và user đang cung cấp thêm thông tin hoặc xác nhận
  if (hasDates && hasGuests) {
    // Nếu có yêu cầu view biển (đang hoặc lưu trước đó), ưu tiên trả list view biển trước
    if ((wantsSeaView || context.requestedView === 'biển') && !context.lastRoomSearchResults) {
      // giao cho nhánh sea view phía trên, không rơi vào nhánh hỏi thông tin
      return null;
    }
    // Kiểm tra xem có phải là câu hỏi về booking không
    const isBookingRelated = lower.includes('đặt phòng') || 
                             lower.includes('book') ||
                             lower.includes('phòng') ||
                             lower.match(/\d{1,2}\/\d{1,2}/) || // Có ngày tháng
                             lower.match(/\d+\s*người/); // Có số người
    
    if (isBookingRelated) {
      try {
        // Parse dates
        const checkInDate = bookingContext.checkInDate instanceof Date 
          ? bookingContext.checkInDate 
          : new Date(bookingContext.checkInDate);
        const checkOutDate = bookingContext.checkOutDate instanceof Date 
          ? bookingContext.checkOutDate 
          : new Date(bookingContext.checkOutDate);
        
        // Validate dates
        if (!isNaN(checkInDate.getTime()) && !isNaN(checkOutDate.getTime())) {
          // ✅ Sử dụng searchRooms function có sẵn (xử lý availability và filtering tốt hơn)
          const searchCriteria = {
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            maxOccupancy: hasGuests,
            isAvailable: true,
            status: 'active'
          };
          
          const rooms = await searchRooms(searchCriteria);
          
          if (rooms.length > 0) {
            // Format rooms data (rooms đã được format từ searchRooms)
            const formattedRooms = rooms.map(room => ({
              _id: room._id,
              name: room.name,
              roomType: room.roomType,
              pricePerNight: room.pricePerNight,
              maxOccupancy: room.maxOccupancy,
              view: room.view,
              image: room.image || room.thumbnailUrl || null,
              thumbnailUrl: room.thumbnailUrl || room.image || null,
              amenities: Array.isArray(room.amenities) ? room.amenities : []
            }));
            
            console.log(`✅ Pattern-based: Found ${rooms.length} rooms (no API call)`);
            
            return {
              text: `Tôi đã tìm thấy ${rooms.length} phòng phù hợp với yêu cầu của bạn. Vui lòng chọn phòng bạn muốn đặt.`,
              rooms: formattedRooms,
              hasRooms: true
            };
          } else {
            return {
              text: 'Xin lỗi, hiện tại không có phòng trống phù hợp với yêu cầu của bạn. Vui lòng thử lại với ngày khác hoặc số lượng khách khác.',
              rooms: null,
              hasRooms: false
            };
          }
        }
      } catch (error) {
        console.error('❌ Error in pattern-based room search:', error);
        // Return null để fallback sang AI
        return null;
      }
    }
  }
  
  return null; // Không match pattern, cần dùng AI
};

// ✅ AI Response function với Gemini API, Room Search VÀ RAG
const getAIResponse = async (userMessage, context = {}, conversationHistory = [], exploreContext = {}, exploreIntent = {}) => {
  // ✅ KIỂM TRA NỘI DUNG NHẠY CẢM TRƯỚC KHI XỬ LÝ
  const sanitized = sanitizeInput(userMessage);
  
  if (sanitized.isSensitive) {
    return {
      text: "Xin lỗi, tôi không thể trả lời câu hỏi này. Tôi là trợ lý ảo của khách sạn và chỉ có thể hỗ trợ các câu hỏi liên quan đến dịch vụ khách sạn như: đặt phòng, giá phòng, dịch vụ, chính sách hủy phòng. Nếu bạn có câu hỏi khác, vui lòng liên hệ trực tiếp qua hotline: 0901 234 567.",
      rooms: null,
      hasRooms: false
    };
  }
  
  // ✅ THÊM: Kiểm tra rule-based response trước (tiết kiệm API calls)
  const language = context.language || 'vi';
  const ruleBasedResponse = getRuleBasedResponse(userMessage, language);
  
  if (ruleBasedResponse) {
    console.log('✅ Using rule-based response (no API call)');
    return {
      text: ruleBasedResponse,
      rooms: null,
      hasRooms: false
    };
  }
  
  // ✅ THÊM: Kiểm tra response cache (tiết kiệm API calls cho câu hỏi lặp lại)
  const cachedResponse = getCachedResponse(userMessage);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // ✅ THÊM: Kiểm tra pattern-based response (xử lý booking flow bằng logic)
  const patternBasedResponse = await getPatternBasedResponse(userMessage, context);
  if (patternBasedResponse) {
    console.log('✅ Using pattern-based response (no API call)');
    // Cache pattern-based response để tái sử dụng
    setCachedResponse(userMessage, patternBasedResponse);
    return patternBasedResponse;
  }
  
  // ✅ GIAI ĐOẠN 1: Kiểm tra rate limit cho user (chỉ áp dụng cho AI calls)
  // ✅ QUAN TRỌNG: Rate limiting chỉ áp dụng cho AI calls, KHÔNG áp dụng cho rule-based và cached
  const sessionId = context.sessionId || context.userId || null;
  const rateLimitCheck = checkUserRateLimit(sessionId);
  
  if (!rateLimitCheck.allowed) {
    console.log(`⚠️  Rate limit reached for user ${sessionId}`);
    // ✅ QUAN TRỌNG: Vẫn cho phép rule-based và cached, chỉ chặn AI calls
    // Fallback: Trả về message thông báo và hướng dẫn
    return {
      text: rateLimitCheck.message || 'Bạn đã sử dụng hết lượt hỏi AI hôm nay. Vui lòng liên hệ hotline: 0901 234 567 để được hỗ trợ thêm.',
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
  
  // ✅ QUAN TRỌNG: Chỉ auto-search khi:
  // 1. Có đủ thông tin (dates + guests)
  // 2. CHƯA có selectedRoom hoặc bookingContext.roomId (user chưa chọn phòng)
  // 3. KHÔNG phải là user đang cung cấp thông tin cho phòng đã chọn
  // 4. User không yêu cầu tìm phòng mới
  const hasSelectedRoomOrRoomId = hasSelectedRoom || bookingContext.roomId || context.selectedRoom?._id;
  const isProvidingInfoForSelectedRoom = hasSelectedRoomOrRoomId && (hasDates || hasGuests || 
    lowerMessage.includes("ngày nhận") || lowerMessage.includes("ngày trả") || 
    lowerMessage.includes("check-in") || lowerMessage.includes("check-out") ||
    lowerMessage.match(/\d{1,2}\/\d{1,2}/) || lowerMessage.match(/\d+\s*người/) ||
    lowerMessage.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/) || // email
    lowerMessage.match(/(?:0|\+84)[0-9]{9,10}/)); // phone
  
  const shouldAutoSearchRooms = hasDates && hasGuests && 
    !hasSelectedRoomOrRoomId && 
    !isProvidingInfoForSelectedRoom &&
    !isRequestingNewSearch &&
    !isConfirmingSelectedRoom;
  
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
        
        // ✅ Thêm context về explore intent (lịch sử, chủ, tính năng, địa điểm)
        if (exploreIntent.type) {
          const exploreLabel = language === 'vi' ? 'CONTEXT: CÂU HỎI VỀ THÔNG TIN KHÁCH SẠN' : 'CONTEXT: HOTEL INFORMATION QUESTION';
          let exploreContextText = '';
          
          if (exploreIntent.type === 'history') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về lịch sử hình thành khách sạn.\n` +
                `Tham khảo chatbot-scenarios.md section 6.1 để trả lời chi tiết về:\n` +
                `- Năm 2010: Khởi Nghiệp (20 phòng)\n` +
                `- Năm 2015: Mở Rộng (50 phòng, đạt 4 sao)\n` +
                `- Năm 2020: Đạt Tiêu Chuẩn 5 Sao\n` +
                `- Năm 2024: Hiện Tại & Tương Lai\n` +
                `Luôn gợi ý khách click vào [Khám Phá Ngay](explore) trên trang chủ để có thông tin đầy đủ hơn.`
              : `Customer is asking about hotel history.\n` +
                `Refer to chatbot-scenarios.md section 6.1 for detailed response about:\n` +
                `- 2010: Startup (20 rooms)\n` +
                `- 2015: Expansion (50 rooms, 4-star)\n` +
                `- 2020: Achieved 5-Star Standard\n` +
                `- 2024: Present & Future\n` +
                `Always suggest customer to click [Explore Now](explore) on homepage for more complete information.`;
          } else if (exploreIntent.type === 'owner') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về chủ khách sạn.\n` +
                `Tham khảo chatbot-scenarios.md section 6.2 để trả lời về:\n` +
                `- Chủ tịch & Nhà sáng lập: Nguyễn Văn A\n` +
                `- 20+ năm kinh nghiệm trong ngành khách sạn\n` +
                `- Thành tựu: Giải thưởng "Khách sạn tốt nhất năm 2023", Chứng nhận 5 sao, Top 10 khách sạn hàng đầu Việt Nam\n` +
                `- Triết lý kinh doanh: "Khách hàng là trung tâm của mọi hoạt động"\n` +
                `Luôn gợi ý khách click vào [Khám Phá Ngay](explore) trên trang chủ để có thông tin đầy đủ hơn.`
              : `Customer is asking about hotel owner.\n` +
                `Refer to chatbot-scenarios.md section 6.2 for response about:\n` +
                `- President & Founder: Nguyễn Văn A\n` +
                `- 20+ years experience in hospitality\n` +
                `- Achievements: "Best Hotel 2023" award, 5-star certification, Top 10 hotels in Vietnam\n` +
                `- Business philosophy: "Customer is the center of all activities"\n` +
                `Always suggest customer to click [Explore Now](explore) on homepage for more complete information.`;
          } else if (exploreIntent.type === 'features') {
            exploreContextText = language === 'vi'
              ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đang hỏi về tính năng mới/công nghệ hiện đại của khách sạn.\n` +
                `Bạn PHẢI trả lời ĐẦY ĐỦ về 6 tính năng công nghệ hiện đại nhất của Rayal Park Hotel:\n\n` +
                `1. Chatbot AI Thông Minh:\n` +
                `   - Trải nghiệm dịch vụ hỗ trợ 24/7 với chatbot AI thông minh\n` +
                `   - Đặt phòng, tìm hiểu dịch vụ, hoặc nhận tư vấn ngay lập tức qua chat trực tuyến\n` +
                `   - Hỗ trợ đa ngôn ngữ (Tiếng Việt & Tiếng Anh)\n` +
                `   - Bạn đang sử dụng tính năng này ngay bây giờ! 😊\n\n` +
                `2. Đặt Phòng Tức Thì:\n` +
                `   - Đặt phòng ngay từ chat, không cần rời khỏi trang web\n` +
                `   - Hệ thống tự động kiểm tra phòng trống và xác nhận đặt phòng trong vài giây\n` +
                `   - Xác nhận tức thời, thanh toán linh hoạt\n\n` +
                `3. Đồng Bộ Lịch Google:\n` +
                `   - Tự động thêm lịch đặt phòng vào Google Calendar của bạn\n` +
                `   - Nhận nhắc nhở và quản lý lịch trình một cách tiện lợi\n` +
                `   - Tính năng này hoạt động tự động khi bạn đặt phòng thành công\n\n` +
                `4. Quản Lý Booking Trực Tuyến:\n` +
                `   - Xem, chỉnh sửa hoặc hủy đặt phòng của bạn mọi lúc, mọi nơi\n` +
                `   - Tải hóa đơn, xem chi tiết và quản lý tất cả booking trong một nơi\n` +
                `   - Chỉnh sửa dễ dàng, hủy phòng linh hoạt\n\n` +
                `5. Thanh Toán Đa Phương Thức:\n` +
                `   - Hỗ trợ nhiều phương thức thanh toán: thẻ tín dụng, chuyển khoản ngân hàng, hoặc thanh toán tại khách sạn\n` +
                `   - An toàn và tiện lợi\n` +
                `   - Bảo mật cao, thanh toán nhanh chóng\n\n` +
                `6. Gợi Ý Địa Điểm Gần:\n` +
                `   - Khám phá các địa điểm tham quan, nhà hàng, mua sắm gần khách sạn\n` +
                `   - Tìm hiểu khoảng cách và thời gian di chuyển để lên kế hoạch hoàn hảo\n` +
                `   - Thông tin chi tiết, bản đồ trực quan\n\n` +
                `${exploreIntent.specificFeature ? `Khách hỏi cụ thể về: ${exploreIntent.specificFeature}. Hãy trả lời chi tiết về tính năng này.\n` : ''}` +
                `Bạn PHẢI liệt kê đầy đủ 6 tính năng trên với mô tả chi tiết. KHÔNG được nói "không có thông tin". Luôn gợi ý khách xem phần 'Khám Phá Ngay' trên trang chủ để trải nghiệm các tính năng.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer is asking about new features/modern technology of the hotel.\n` +
                `You MUST provide COMPLETE information about the 6 most modern technology features of Rayal Park Hotel:\n\n` +
                `1. Smart AI Chatbot:\n` +
                `   - Experience 24/7 support service with smart AI chatbot\n` +
                `   - Book rooms, learn about services, or get instant advice via online chat\n` +
                `   - Multilingual support (Vietnamese & English)\n` +
                `   - You are using this feature right now! 😊\n\n` +
                `2. Instant Booking:\n` +
                `   - Book rooms directly from chat, no need to leave the website\n` +
                `   - System automatically checks room availability and confirms booking in seconds\n` +
                `   - Instant confirmation, flexible payment\n\n` +
                `3. Google Calendar Sync:\n` +
                `   - Automatically add booking to your Google Calendar\n` +
                `   - Receive reminders and manage schedule conveniently\n` +
                `   - This feature works automatically when you successfully book\n\n` +
                `4. Online Booking Management:\n` +
                `   - View, edit or cancel your bookings anytime, anywhere\n` +
                `   - Download invoices, view details and manage all bookings in one place\n` +
                `   - Easy editing, flexible cancellation\n\n` +
                `5. Multi-Payment Methods:\n` +
                `   - Support multiple payment methods: credit card, bank transfer, or payment at hotel\n` +
                `   - Safe and convenient\n` +
                `   - High security, fast payment\n\n` +
                `6. Nearby Places Suggestions:\n` +
                `   - Explore attractions, restaurants, shopping near the hotel\n` +
                `   - Learn about distance and travel time to plan perfectly\n` +
                `   - Detailed information, visual maps\n\n` +
                `${exploreIntent.specificFeature ? `Customer specifically asked about: ${exploreIntent.specificFeature}. Please provide detailed information about this feature.\n` : ''}` +
                `You MUST list all 6 features above with detailed descriptions. MUST NOT say "no information available". Always suggest customer to check 'Explore Now' section on homepage to experience the features.`;
          } else if (exploreIntent.type === 'nearby') {
            const nearbyPlacesData = exploreContext.nearbyPlaces || [];
            const categoryLabel = exploreIntent.category 
              ? (language === 'vi' ? `Danh mục: ${exploreIntent.category}` : `Category: ${exploreIntent.category}`)
              : (language === 'vi' ? 'Tất cả danh mục' : 'All categories');
            
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về địa điểm gần khách sạn.\n` +
                `Tham khảo chatbot-scenarios.md section 6.4 để trả lời.\n` +
                `${categoryLabel}\n` +
                `Đã tải ${nearbyPlacesData.length} địa điểm từ database.\n` +
                `${nearbyPlacesData.length > 0 
                  ? `PHẢI hiển thị danh sách địa điểm với thông tin: tên, khoảng cách, thời gian di chuyển, địa chỉ, rating (nếu có).\n` +
                    `Phân loại theo category: Điểm Tham Quan, Nhà Hàng, Mua Sắm, Bệnh Viện, Ngân Hàng/ATM, Bưu Điện.\n` +
                    `Sử dụng icon phù hợp cho từng category (🏛️, 🍽️, 🛍️, 🏥, 🏦, 📮).`
                  : `Không có địa điểm nào trong database. Hướng dẫn khách liên hệ hotline 0901 234 567 để được tư vấn cụ thể.`}\n` +
                `Luôn gợi ý khách click vào [Khám Phá Ngay](explore) trên trang chủ để xem đầy đủ danh sách.`
              : `Customer is asking about nearby places.\n` +
                `Refer to chatbot-scenarios.md section 6.4 for response.\n` +
                `${categoryLabel}\n` +
                `Loaded ${nearbyPlacesData.length} places from database.\n` +
                `${nearbyPlacesData.length > 0 
                  ? `MUST display list of places with information: name, distance, travel time, address, rating (if available).\n` +
                    `Categorize by: Attractions, Restaurants, Shopping, Hospitals, Banks/ATM, Post Office.\n` +
                    `Use appropriate icons for each category (🏛️, 🍽️, 🛍️, 🏥, 🏦, 📮).`
                  : `No places in database. Guide customer to contact hotline 0901 234 567 for specific advice.`}\n` +
                `Always suggest customer to click [Explore Now](explore) on homepage for full list.`;
            
            // Thêm dữ liệu địa điểm vào prompt nếu có
            if (nearbyPlacesData.length > 0) {
              exploreContextText += `\n\nDỮ LIỆU ĐỊA ĐIỂM:\n`;
              nearbyPlacesData.forEach((place, idx) => {
                exploreContextText += `${idx + 1}. ${place.name} (${place.category})\n`;
                exploreContextText += `   Khoảng cách: ${place.distance}\n`;
                if (place.walkingTime) exploreContextText += `   Thời gian đi bộ: ${place.walkingTime}\n`;
                if (place.drivingTime) exploreContextText += `   Thời gian xe: ${place.drivingTime}\n`;
                if (place.address) exploreContextText += `   Địa chỉ: ${place.address}\n`;
                if (place.rating) exploreContextText += `   Rating: ${place.rating}/5\n`;
                if (place.description) exploreContextText += `   Mô tả: ${place.description}\n`;
                exploreContextText += `\n`;
              });
            }
          } else if (exploreIntent.type === 'explore_general') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi tổng hợp về khách sạn (khám phá).\n` +
                `Tham khảo chatbot-scenarios.md section 6.5 để trả lời.\n` +
                `Giới thiệu tổng quan và đề xuất 4 chủ đề:\n` +
                `- 📜 Lịch Sử Hình Thành\n` +
                `- 👤 Chủ Khách Sạn\n` +
                `- ✨ Tính Năng Mới\n` +
                `- 📍 Địa Điểm Gần\n` +
                `Hướng dẫn khách nhấn vào nút 'Khám Phá Ngay' trên trang chủ để xem đầy đủ thông tin.`
              : `Customer is asking general questions about the hotel (explore).\n` +
                `Refer to chatbot-scenarios.md section 6.5 for response.\n` +
                `Provide overview and suggest 4 topics:\n` +
                `- 📜 Hotel History\n` +
                `- 👤 Hotel Owner\n` +
                `- ✨ New Features\n` +
                `- 📍 Nearby Places\n` +
                `Guide customer to click 'Explore Now' button on homepage for full information.`;
          }
          
          if (exploreContextText) {
            prompt += `\n\n${exploreLabel}:\n${exploreContextText}\n\n`;
          }
        }
        
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
            const bookingContext = context.bookingContext || {};
            const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
            const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
            const hasPersonalInfo = bookingContext.fullName && bookingContext.email && bookingContext.phone;
            
            // ✅ Kiểm tra xem user có đang cung cấp thông tin cho phòng đã chọn không
            const isProvidingBookingInfo = hasDates || hasGuests || hasPersonalInfo ||
              userMessage.match(/\d{1,2}\/\d{1,2}/) || userMessage.match(/\d+\s*người/) ||
              userMessage.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/) || // email
              userMessage.match(/(?:0|\+84)[0-9]{9,10}/); // phone
            
            const roomSelectedLabel = language === 'vi' ? 'CONTEXT: KHÁCH ĐÃ CHỌN PHÒNG' : 'CONTEXT: CUSTOMER HAS SELECTED A ROOM';
            let roomSelectedContext = '';
            
            if (isProvidingBookingInfo) {
              // ✅ User đang cung cấp thông tin để tiếp tục booking với phòng đã chọn
              roomSelectedContext = language === 'vi'
                ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng ĐÃ CHỌN phòng: ${context.selectedRoom.name}.\n` +
                  `Bây giờ khách đang CUNG CẤP THÔNG TIN để tiếp tục đặt phòng (ngày, số khách, thông tin cá nhân).\n` +
                  `Bạn PHẢI:\n` +
                  `- Xác nhận đã nhận thông tin: "Cảm ơn bạn đã cung cấp thông tin..."\n` +
                  `- Hỏi thông tin còn thiếu (nếu có)\n` +
                  `- KHÔNG được tìm phòng mới hoặc hiển thị danh sách phòng khác\n` +
                  `- KHÔNG được nói "Tôi đã tìm thấy X phòng" - đây là SAI vì khách đã chọn phòng rồi\n` +
                  `- Nếu đã đủ thông tin, hướng dẫn tiếp tục đặt phòng hoặc tạo booking link\n` +
                  `Tham khảo chatbot-scenarios.md section 1.1 để xử lý đúng cách.`
                : `⚠️⚠️⚠️ IMPORTANT: Customer HAS SELECTED room: ${context.selectedRoom.name}.\n` +
                  `Now customer is PROVIDING INFORMATION to continue booking (dates, guests, personal info).\n` +
                  `You MUST:\n` +
                  `- Confirm receipt of information: "Thank you for providing..."\n` +
                  `- Ask for missing information (if any)\n` +
                  `- MUST NOT search for new rooms or display other room lists\n` +
                  `- MUST NOT say "I found X rooms" - this is WRONG because customer already selected a room\n` +
                  `- If all information is complete, guide to continue booking or create booking link\n` +
                  `Refer to chatbot-scenarios.md section 1.1 for proper handling.`;
            } else {
              // ✅ User vừa chọn phòng, chưa cung cấp thông tin
              roomSelectedContext = language === 'vi'
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
            }
            
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
        
        // ✅ Quy tắc an toàn về tình trạng phòng
        const availabilitySafety = language === 'vi'
          ? `⚠️⚠️⚠️ QUAN TRỌNG: KHÔNG được nói "hết phòng", "không còn phòng" nếu chưa có kết quả kiểm tra phòng trống rõ ràng từ hệ thống.\n` +
            `Nếu không chắc chắn về tình trạng phòng, hãy đề nghị kiểm tra: "Mình sẽ kiểm tra phòng trống cho bạn, bạn cho mình biết ngày nhận/trả phòng?"\n` +
            `Chỉ được thông báo hết phòng khi:\n` +
            `- Đã có kết quả kiểm tra phòng trống trả về KHÔNG còn phòng\n` +
            `- Hoặc context.roomNoLongerAvailable được set (đã kiểm tra và không còn)\n` +
            `Nếu chỉ biết một loại phòng có thể hết, KHÔNG được nói toàn bộ khách sạn hết phòng; hãy gợi ý kiểm tra các loại phòng khác.\n`
          : `⚠️⚠️⚠️ IMPORTANT: DO NOT say "sold out"/"no rooms available" unless there is a clear availability check result from the system.\n` +
            `If unsure about availability, ask to check: "Let me check availability for you, please share check-in/check-out dates?"\n` +
            `Only state sold-out when:\n` +
            `- An availability check returned NO rooms\n` +
            `- Or context.roomNoLongerAvailable is set (already checked and unavailable)\n` +
            `If only one room type might be unavailable, DO NOT say the whole hotel is sold out; suggest checking other room types.\n`;
        prompt += `\n\n${availabilitySafety}\n\n`;

        // ✅ Cung cấp context về phòng đã chọn (nếu có)
        if (context.selectedRoom && context.lastRoomSearchResults) {
          const selectedRoomInfo = context.selectedRoom;
          const roomIndex = context.lastRoomSearchResults.findIndex(r => {
            if (!r || !r._id || !selectedRoomInfo._id) return false;
            const rId = r._id.toString ? r._id.toString() : String(r._id);
            const selectedId = selectedRoomInfo._id.toString ? selectedRoomInfo._id.toString() : String(selectedRoomInfo._id);
            return rId === selectedId;
          }) + 1;
          
          // ✅ QUAN TRỌNG: Đảm bảo roomIndex > 0 (tìm thấy trong list)
          if (roomIndex > 0) {
            const contextInfo = language === 'vi'
              ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã chọn phòng số ${roomIndex} từ danh sách đã hiển thị trước đó.\n` +
                `Tên phòng đã chọn: ${selectedRoomInfo.name}\n` +
                `Bạn PHẢI xác nhận: "Bạn đã chọn phòng số ${roomIndex}: ${selectedRoomInfo.name}" hoặc tương tự.\n` +
                `Bạn KHÔNG được nói "Tôi đã tìm thấy ${roomIndex} phòng" - đây là SAI vì khách đã chọn 1 phòng cụ thể, không phải tìm ${roomIndex} phòng.\n` +
                `Bạn PHẢI nói về PHÒNG ĐÃ CHỌN (phòng số ${roomIndex}: ${selectedRoomInfo.name}), không phải số lượng phòng tìm được.\n` +
                `QUAN TRỌNG: Số thứ tự ${roomIndex} PHẢI khớp với vị trí trong list (index ${roomIndex - 1} trong array).\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer has selected room #${roomIndex} from the previously displayed list.\n` +
                `Selected room name: ${selectedRoomInfo.name}\n` +
                `You MUST confirm: "You have selected room #${roomIndex}: ${selectedRoomInfo.name}" or similar.\n` +
                `You MUST NOT say "I found ${roomIndex} rooms" - this is WRONG because customer selected 1 specific room, not found ${roomIndex} rooms.\n` +
                `You MUST talk about THE SELECTED ROOM (room #${roomIndex}: ${selectedRoomInfo.name}), not the number of rooms found.\n` +
                `IMPORTANT: Order number ${roomIndex} MUST match position in list (index ${roomIndex - 1} in array).\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${contextInfo}\n\n`;
          } else {
            // ✅ Fallback: Nếu không tìm thấy trong list, vẫn xác nhận phòng đã chọn
            const contextInfo = language === 'vi'
              ? `⚠️ QUAN TRỌNG: Khách hàng đã chọn phòng: ${selectedRoomInfo.name}.\n` +
                `Bạn PHẢI xác nhận phòng đã chọn và hiển thị thông tin phòng.\n` +
                `Bạn KHÔNG được nói về số lượng phòng tìm được.\n` +
                `Tham khảo chatbot-scenarios.md section 1.8 để xử lý đúng cách.`
              : `⚠️ IMPORTANT: Customer has selected room: ${selectedRoomInfo.name}.\n` +
                `You MUST confirm the selected room and display room information.\n` +
                `You MUST NOT talk about the number of rooms found.\n` +
                `Refer to chatbot-scenarios.md section 1.8 for proper handling.`;
            
            prompt += `\n\n${contextInfo}\n\n`;
          }
        }
        
        // ✅ Cung cấp context khi user muốn đổi phòng (chọn lại phòng khác)
        if (context.roomChanged && context.shouldShowFilteredRoomList && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
          const changeRoomContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã nói "không muốn phòng này nữa" hoặc "muốn chọn lại phòng khác".\n` +
              `Bạn ĐÃ XÓA phòng đã chọn khỏi danh sách và còn lại ${context.lastRoomSearchResults.length} phòng:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `BẠN PHẢI:\n` +
              `1. Xác nhận: "Tôi hiểu bạn muốn chọn phòng khác. Dưới đây là danh sách phòng còn lại:"\n` +
              `2. Hiển thị lại danh sách phòng (đã bỏ phòng không muốn) với số thứ tự đúng (1, 2, 3...)\n` +
              `3. Hỏi lại yêu cầu: "Bạn có muốn tôi tìm phòng khác với tiêu chí khác không, hay bạn muốn chọn từ danh sách trên?"\n` +
              `QUAN TRỌNG:\n` +
              `- KHÔNG được hiển thị lại card phòng đã chọn (đã bỏ)\n` +
              `- PHẢI hiển thị danh sách phòng mới (đã filter)\n` +
              `- PHẢI hỏi lại yêu cầu để tìm phòng mới nếu cần\n` +
              `- Số thứ tự PHẢI khớp với vị trí trong list (1, 2, 3...)\n`
            : `⚠️⚠️⚠️ IMPORTANT: Customer said "don't want this room anymore" or "want to choose another room".\n` +
              `You HAVE REMOVED the selected room from the list and ${context.lastRoomSearchResults.length} rooms remain:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `YOU MUST:\n` +
              `1. Confirm: "I understand you want to choose another room. Here are the remaining rooms:"\n` +
              `2. Display the room list again (with unwanted room removed) with correct order numbers (1, 2, 3...)\n` +
              `3. Ask for new criteria: "Would you like me to search for other rooms with different criteria, or would you like to choose from the list above?"\n` +
              `IMPORTANT:\n` +
              `- MUST NOT display the card of the removed room\n` +
              `- MUST display the new room list (filtered)\n` +
              `- MUST ask for new criteria to search for new rooms if needed\n` +
              `- Order numbers MUST match position in list (1, 2, 3...)\n`;
          
          prompt += `\n\n${changeRoomContext}\n\n`;
        } else if (context.shouldAskForNewRoomCriteria) {
          const askCriteriaContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã nói "không muốn phòng này nữa" hoặc "muốn chọn lại phòng khác".\n` +
              `NHƯNG: Không có danh sách phòng để hiển thị lại.\n` +
              `BẠN PHẢI:\n` +
              `1. Xác nhận: "Tôi hiểu bạn muốn chọn phòng khác."\n` +
              `2. Hỏi lại yêu cầu: "Bạn vui lòng cho tôi biết lại tiêu chí hoặc loại phòng bạn mong muốn để tôi tìm kiếm lại cho bạn nhé?"\n` +
              `QUAN TRỌNG:\n` +
              `- KHÔNG được hiển thị lại card phòng đã chọn\n` +
              `- PHẢI hỏi lại yêu cầu để tìm phòng mới\n`
            : `⚠️⚠️⚠️ IMPORTANT: Customer said "don't want this room anymore" or "want to choose another room".\n` +
              `HOWEVER: No room list available to display again.\n` +
              `YOU MUST:\n` +
              `1. Confirm: "I understand you want to choose another room."\n` +
              `2. Ask for new criteria: "Could you please let me know your criteria or the type of room you want so I can search again for you?"\n` +
              `IMPORTANT:\n` +
              `- MUST NOT display the card of the removed room\n` +
              `- MUST ask for new criteria to search for new rooms\n`;
          
          prompt += `\n\n${askCriteriaContext}\n\n`;
        }
        
        // ✅ Cung cấp context về danh sách phòng đã hiển thị (nếu có)
        if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0 && !context.selectedRoom && !context.roomChanged) {
          const roomListContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Đã có danh sách ${context.lastRoomSearchResults.length} phòng đã hiển thị cho khách hàng:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm`).join('\n')}\n` +
              `QUAN TRỌNG VỀ SỐ THỨ TỰ:\n` +
              `- Phòng đầu tiên trong list là "phòng số 1" (index 0)\n` +
              `- Phòng thứ hai là "phòng số 2" (index 1)\n` +
              `- Phòng thứ ba là "phòng số 3" (index 2)\n` +
              `- ... và cứ thế\n` +
              `- Khi hiển thị list, bạn PHẢI đánh số đúng: "1. Phòng X", "2. Phòng Y", "3. Phòng Z"...\n` +
              `- KHÔNG được đánh số sai hoặc nhầm lẫn (ví dụ: "5. Phòng X (Số thứ tự: 6)" là SAI)\n` +
              `- Số thứ tự PHẢI khớp với vị trí trong list (số thứ tự = index + 1)\n` +
              `- Khi khách nói "phòng số X", đó là phòng ở vị trí X trong list trên\n` +
              `Tham khảo chatbot-scenarios.md section 1.8 để xử lý khi khách chọn phòng từ list.`
            : `⚠️⚠️⚠️ IMPORTANT: There is a displayed list of ${context.lastRoomSearchResults.length} rooms for the customer:\n` +
              `${context.lastRoomSearchResults.map((r, idx) => `   ${idx + 1}. ${r.name} - ${r.pricePerNight.toLocaleString('vi-VN')} VND/night`).join('\n')}\n` +
              `IMPORTANT ABOUT ORDER NUMBERS:\n` +
              `- First room in list is "room number 1" (index 0)\n` +
              `- Second room is "room number 2" (index 1)\n` +
              `- Third room is "room number 3" (index 2)\n` +
              `- ... and so on\n` +
              `- When displaying list, you MUST number correctly: "1. Room X", "2. Room Y", "3. Room Z"...\n` +
              `- MUST NOT number incorrectly or confuse (e.g., "5. Room X (Order number: 6)" is WRONG)\n` +
              `- Order number MUST match position in list (order number = index + 1)\n` +
              `- When customer says "room number X", that's the room at position X in the list above\n` +
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
        
        // ✅ THÊM: Explore context vào fallback prompt (QUAN TRỌNG - khi RAG không có data)
        if (exploreIntent.type) {
          const exploreLabel = language === 'vi' ? 'CONTEXT: CÂU HỎI VỀ THÔNG TIN KHÁCH SẠN' : 'CONTEXT: HOTEL INFORMATION QUESTION';
          let exploreContextText = '';
          
          if (exploreIntent.type === 'history') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về lịch sử hình thành khách sạn.\n` +
                `Rayal Park Hotel được thành lập vào năm 2010 với tầm nhìn trở thành điểm đến nghỉ dưỡng hàng đầu tại Việt Nam.\n\n` +
                `Timeline chi tiết:\n` +
                `- Năm 2010: Khởi Nghiệp - Từ một dự án nhỏ với 20 phòng đầu tiên\n` +
                `- Năm 2015: Mở Rộng Quy Mô - Lên 50 phòng cao cấp, đạt tiêu chuẩn 4 sao và nhận được nhiều giải thưởng về chất lượng dịch vụ\n` +
                `- Năm 2020: Đạt Tiêu Chuẩn 5 Sao - Sau 10 năm phát triển, chính thức đạt tiêu chuẩn 5 sao quốc tế\n` +
                `- Năm 2024: Hiện Tại & Tương Lai - Tiếp tục đổi mới, hướng tới mục tiêu trở thành khách sạn hàng đầu khu vực Đông Nam Á\n\n` +
                `Thành tựu nổi bật:\n` +
                `- Giải thưởng "Khách sạn tốt nhất năm 2023"\n` +
                `- Chứng nhận 5 sao quốc tế\n` +
                `- Top 10 khách sạn hàng đầu Việt Nam\n\n` +
                `Bạn PHẢI trả lời chi tiết về lịch sử hình thành. Luôn gợi ý khách xem phần 'Khám Phá Ngay' trên trang chủ để có thông tin đầy đủ hơn.`
              : `Customer is asking about hotel history.\n` +
                `Rayal Park Hotel was founded in 2010 with the vision of becoming a leading resort destination in Vietnam.\n\n` +
                `Detailed timeline:\n` +
                `- 2010: Startup - Started as a small project with 20 rooms\n` +
                `- 2015: Expansion - Expanded to 50 premium rooms, achieved 4-star standard and received many awards for service quality\n` +
                `- 2020: Achieved 5-Star Standard - After 10 years of development, officially achieved international 5-star standard\n` +
                `- 2024: Present & Future - Continue to innovate, aiming to become a leading hotel in Southeast Asia\n\n` +
                `Outstanding achievements:\n` +
                `- "Best Hotel 2023" award\n` +
                `- International 5-star certification\n` +
                `- Top 10 hotels in Vietnam\n\n` +
                `You MUST provide detailed information about the hotel's history. Always suggest customer to check 'Explore Now' section on homepage for more complete information.`;
          } else if (exploreIntent.type === 'owner') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về chủ khách sạn.\n` +
                `Chủ tịch & Nhà sáng lập Rayal Park Hotel là Nguyễn Văn A, một doanh nhân thành đạt với hơn 20 năm kinh nghiệm trong ngành khách sạn và du lịch.\n\n` +
                `Tiểu sử:\n` +
                `- Với tầm nhìn xa và đam mê mang đến trải nghiệm nghỉ dưỡng đẳng cấp, ông đã sáng lập Rayal Park Hotel vào năm 2010\n` +
                `- Dưới sự lãnh đạo của ông, khách sạn đã phát triển từ một dự án nhỏ trở thành một trong những khách sạn 5 sao hàng đầu tại Việt Nam\n` +
                `- Ông luôn đặt khách hàng làm trung tâm và cam kết mang đến dịch vụ hoàn hảo nhất cho mọi du khách\n\n` +
                `Thành tựu nổi bật:\n` +
                `- Giải thưởng "Khách sạn tốt nhất năm 2023"\n` +
                `- Chứng nhận 5 sao quốc tế\n` +
                `- Top 10 khách sạn hàng đầu Việt Nam\n\n` +
                `Triết lý kinh doanh:\n` +
                `"Khách hàng là trung tâm của mọi hoạt động. Chúng tôi không chỉ cung cấp dịch vụ lưu trú, mà còn tạo ra những kỷ niệm đáng nhớ cho mỗi du khách."\n\n` +
                `Bạn PHẢI trả lời chi tiết về chủ khách sạn. Luôn gợi ý khách xem phần 'Khám Phá Ngay' trên trang chủ để có thông tin đầy đủ hơn.`
              : `Customer is asking about hotel owner.\n` +
                `President & Founder of Rayal Park Hotel is Nguyễn Văn A, a successful entrepreneur with over 20 years of experience in hospitality and tourism.\n\n` +
                `Biography:\n` +
                `- With vision and passion for delivering premium resort experiences, he founded Rayal Park Hotel in 2010\n` +
                `- Under his leadership, the hotel has grown from a small project to one of the leading 5-star hotels in Vietnam\n` +
                `- He always puts customers at the center and commits to providing the best service for every guest\n\n` +
                `Outstanding achievements:\n` +
                `- "Best Hotel 2023" award\n` +
                `- International 5-star certification\n` +
                `- Top 10 hotels in Vietnam\n\n` +
                `Business philosophy:\n` +
                `"Customer is the center of all activities. We don't just provide accommodation services, but also create memorable experiences for every guest."\n\n` +
                `You MUST provide detailed information about the hotel owner. Always suggest customer to check 'Explore Now' section on homepage for more complete information.`;
          } else if (exploreIntent.type === 'features') {
            exploreContextText = language === 'vi'
              ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đang hỏi về tính năng mới/công nghệ hiện đại của khách sạn.\n` +
                `Bạn PHẢI trả lời ĐẦY ĐỦ về 6 tính năng công nghệ hiện đại nhất của Rayal Park Hotel:\n\n` +
                `1. Chatbot AI Thông Minh:\n` +
                `   - Trải nghiệm dịch vụ hỗ trợ 24/7 với chatbot AI thông minh\n` +
                `   - Đặt phòng, tìm hiểu dịch vụ, hoặc nhận tư vấn ngay lập tức qua chat trực tuyến\n` +
                `   - Hỗ trợ đa ngôn ngữ (Tiếng Việt & Tiếng Anh)\n` +
                `   - Bạn đang sử dụng tính năng này ngay bây giờ! 😊\n\n` +
                `2. Đặt Phòng Tức Thì:\n` +
                `   - Đặt phòng ngay từ chat, không cần rời khỏi trang web\n` +
                `   - Hệ thống tự động kiểm tra phòng trống và xác nhận đặt phòng trong vài giây\n` +
                `   - Xác nhận tức thời, thanh toán linh hoạt\n\n` +
                `3. Đồng Bộ Lịch Google:\n` +
                `   - Tự động thêm lịch đặt phòng vào Google Calendar của bạn\n` +
                `   - Nhận nhắc nhở và quản lý lịch trình một cách tiện lợi\n` +
                `   - Tính năng này hoạt động tự động khi bạn đặt phòng thành công\n\n` +
                `4. Quản Lý Booking Trực Tuyến:\n` +
                `   - Xem, chỉnh sửa hoặc hủy đặt phòng của bạn mọi lúc, mọi nơi\n` +
                `   - Tải hóa đơn, xem chi tiết và quản lý tất cả booking trong một nơi\n` +
                `   - Chỉnh sửa dễ dàng, hủy phòng linh hoạt\n\n` +
                `5. Thanh Toán Đa Phương Thức:\n` +
                `   - Hỗ trợ nhiều phương thức thanh toán: thẻ tín dụng, chuyển khoản ngân hàng, hoặc thanh toán tại khách sạn\n` +
                `   - An toàn và tiện lợi\n` +
                `   - Bảo mật cao, thanh toán nhanh chóng\n\n` +
                `6. Gợi Ý Địa Điểm Gần:\n` +
                `   - Khám phá các địa điểm tham quan, nhà hàng, mua sắm gần khách sạn\n` +
                `   - Tìm hiểu khoảng cách và thời gian di chuyển để lên kế hoạch hoàn hảo\n` +
                `   - Thông tin chi tiết, bản đồ trực quan\n\n` +
                `${exploreIntent.specificFeature ? `Khách hỏi cụ thể về: ${exploreIntent.specificFeature}. Hãy trả lời chi tiết về tính năng này.\n` : ''}` +
                `Bạn PHẢI liệt kê đầy đủ 6 tính năng trên với mô tả chi tiết. KHÔNG được nói "không có thông tin" hoặc "không có thông tin chi tiết". Luôn gợi ý khách xem phần 'Khám Phá Ngay' trên trang chủ để trải nghiệm các tính năng.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer is asking about new features/modern technology of the hotel.\n` +
                `You MUST provide COMPLETE information about the 6 most modern technology features of Rayal Park Hotel:\n\n` +
                `1. Smart AI Chatbot:\n` +
                `   - Experience 24/7 support service with smart AI chatbot\n` +
                `   - Book rooms, learn about services, or get instant advice via online chat\n` +
                `   - Multilingual support (Vietnamese & English)\n` +
                `   - You are using this feature right now! 😊\n\n` +
                `2. Instant Booking:\n` +
                `   - Book rooms directly from chat, no need to leave the website\n` +
                `   - System automatically checks room availability and confirms booking in seconds\n` +
                `   - Instant confirmation, flexible payment\n\n` +
                `3. Google Calendar Sync:\n` +
                `   - Automatically add booking to your Google Calendar\n` +
                `   - Receive reminders and manage schedule conveniently\n` +
                `   - This feature works automatically when you successfully book\n\n` +
                `4. Online Booking Management:\n` +
                `   - View, edit or cancel your bookings anytime, anywhere\n` +
                `   - Download invoices, view details and manage all bookings in one place\n` +
                `   - Easy editing, flexible cancellation\n\n` +
                `5. Multi-Payment Methods:\n` +
                `   - Support multiple payment methods: credit card, bank transfer, or payment at hotel\n` +
                `   - Safe and convenient\n` +
                `   - High security, fast payment\n\n` +
                `6. Nearby Places Suggestions:\n` +
                `   - Explore attractions, restaurants, shopping near the hotel\n` +
                `   - Learn about distance and travel time to plan perfectly\n` +
                `   - Detailed information, visual maps\n\n` +
                `${exploreIntent.specificFeature ? `Customer specifically asked about: ${exploreIntent.specificFeature}. Please provide detailed information about this feature.\n` : ''}` +
                `You MUST list all 6 features above with detailed descriptions. MUST NOT say "no information available" or "no detailed information". Always suggest customer to check 'Explore Now' section on homepage to experience the features.`;
          } else if (exploreIntent.type === 'nearby') {
            const nearbyPlacesData = exploreContext.nearbyPlaces || [];
            const categoryLabel = exploreIntent.category 
              ? (language === 'vi' ? `Danh mục: ${exploreIntent.category}` : `Category: ${exploreIntent.category}`)
              : (language === 'vi' ? 'Tất cả danh mục' : 'All categories');
            
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi về địa điểm gần khách sạn.\n` +
                `${categoryLabel}\n` +
                `Đã tải ${nearbyPlacesData.length} địa điểm từ database.\n` +
                `${nearbyPlacesData.length > 0 
                  ? `PHẢI hiển thị danh sách địa điểm với thông tin: tên, khoảng cách, thời gian di chuyển, địa chỉ, rating (nếu có).\n` +
                    `Phân loại theo category: Điểm Tham Quan, Nhà Hàng, Mua Sắm, Bệnh Viện, Ngân Hàng/ATM, Bưu Điện.\n` +
                    `Sử dụng icon phù hợp cho từng category (🏛️, 🍽️, 🛍️, 🏥, 🏦, 📮).`
                  : `Không có địa điểm nào trong database. Hướng dẫn khách liên hệ hotline 0901 234 567 để được tư vấn cụ thể.`}\n` +
                `Luôn gợi ý khách click vào [Khám Phá Ngay](explore) trên trang chủ để xem đầy đủ danh sách.`
              : `Customer is asking about nearby places.\n` +
                `${categoryLabel}\n` +
                `Loaded ${nearbyPlacesData.length} places from database.\n` +
                `${nearbyPlacesData.length > 0 
                  ? `MUST display list of places with information: name, distance, travel time, address, rating (if available).\n` +
                    `Categorize by: Attractions, Restaurants, Shopping, Hospitals, Banks/ATM, Post Office.\n` +
                    `Use appropriate icons for each category (🏛️, 🍽️, 🛍️, 🏥, 🏦, 📮).`
                  : `No places in database. Guide customer to contact hotline 0901 234 567 for specific advice.`}\n` +
                `Always suggest customer to click [Explore Now](explore) on homepage for full list.`;
            
            // Thêm dữ liệu địa điểm vào prompt nếu có
            if (nearbyPlacesData.length > 0) {
              exploreContextText += `\n\nDỮ LIỆU ĐỊA ĐIỂM:\n`;
              nearbyPlacesData.forEach((place, idx) => {
                exploreContextText += `${idx + 1}. ${place.name} (${place.category})\n`;
                exploreContextText += `   Khoảng cách: ${place.distance}\n`;
                if (place.walkingTime) exploreContextText += `   Thời gian đi bộ: ${place.walkingTime}\n`;
                if (place.drivingTime) exploreContextText += `   Thời gian xe: ${place.drivingTime}\n`;
                if (place.address) exploreContextText += `   Địa chỉ: ${place.address}\n`;
                if (place.rating) exploreContextText += `   Rating: ${place.rating}/5\n`;
                if (place.description) exploreContextText += `   Mô tả: ${place.description}\n`;
                exploreContextText += `\n`;
              });
            }
          } else if (exploreIntent.type === 'explore_general') {
            exploreContextText = language === 'vi'
              ? `Khách hàng đang hỏi tổng hợp về khách sạn (khám phá).\n` +
                `Rayal Park Hotel là khách sạn 5 sao được thành lập năm 2010, với hơn 14 năm kinh nghiệm phục vụ khách hàng.\n\n` +
                `Bạn có thể tìm hiểu về:\n` +
                `- 📜 Lịch Sử Hình Thành: Hành trình phát triển từ 2010 đến nay\n` +
                `- 👤 Chủ Khách Sạn: Thông tin về người sáng lập và triết lý kinh doanh\n` +
                `- ✨ Tính Năng Mới: 6 tính năng công nghệ mới nhất\n` +
                `- 📍 Địa Điểm Gần: Các điểm tham quan, nhà hàng, mua sắm xung quanh\n\n` +
                `Bạn PHẢI giới thiệu tổng quan và đề xuất 4 chủ đề trên. Hướng dẫn khách click vào [Khám Phá Ngay](explore) trên trang chủ để xem đầy đủ thông tin.`
              : `Customer is asking general questions about the hotel (explore).\n` +
                `Rayal Park Hotel is a 5-star hotel founded in 2010, with over 14 years of experience serving customers.\n\n` +
                `You can learn about:\n` +
                `- 📜 Hotel History: Development journey from 2010 to present\n` +
                `- 👤 Hotel Owner: Information about the founder and business philosophy\n` +
                `- ✨ New Features: 6 latest technology features\n` +
                `- 📍 Nearby Places: Attractions, restaurants, shopping around\n\n` +
                `You MUST provide overview and suggest the 4 topics above. Guide customer to click [Explore Now](explore) on homepage for full information.`;
          }
          
          if (exploreContextText) {
            prompt += `\n\n${exploreLabel}:\n${exploreContextText}\n\n`;
          }
        }
        
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
          // ✅ QUAN TRỌNG: Chỉ hỏi thông tin cá nhân khi user ĐÃ CHỌN PHÒNG
          const hasSelectedRoom = context.selectedRoom || bookingContextFallback.roomId;
          const needInfoContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: CHƯA tạo booking! Cần thu thập thông tin cá nhân (tên, email, số điện thoại) để tạo booking.\n` +
              `${hasSelectedRoom ? '' : '⚠️⚠️⚠️ LƯU Ý: Khách hàng CHƯA chọn phòng. Bạn KHÔNG được hỏi thông tin cá nhân cho đến khi khách đã chọn phòng từ danh sách.\n'}` +
              `Bạn KHÔNG được nói "đã hoàn tất đặt phòng" hoặc "đã tạo đơn đặt phòng".\n` +
              `${hasSelectedRoom ? 'Bạn PHẢI hỏi thông tin còn thiếu (đặc biệt là EMAIL - bắt buộc).\n' : 'Bạn PHẢI yêu cầu khách chọn phòng trước khi hỏi thông tin cá nhân.\n'}` +
              `Tham khảo chatbot-scenarios.md section 1.1 bước 5 để thu thập thông tin.`
            : `⚠️⚠️⚠️ IMPORTANT: Booking NOT created yet! Need to collect personal information (name, email, phone) to create booking.\n` +
              `${hasSelectedRoom ? '' : '⚠️⚠️⚠️ NOTE: Customer has NOT selected a room yet. You MUST NOT ask for personal information until customer has selected a room from the list.\n'}` +
              `You MUST NOT say "booking completed" or "booking created".\n` +
              `${hasSelectedRoom ? 'You MUST ask for missing information (especially EMAIL - required).\n' : 'You MUST ask customer to select a room first before asking for personal information.\n'}` +
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
          const hasSelectedRoom = context.selectedRoom || bookingContext.roomId;
          const autoSearchContext = language === 'vi'
            ? `⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng đã cung cấp thông tin (ngày check-in/out, số người).\n` +
              `Bạn ĐÃ TỰ ĐỘNG tìm phòng trống và tìm thấy ${roomSearchResults.length} phòng phù hợp.\n` +
              `Bạn PHẢI hiển thị danh sách phòng này với room cards (frontend sẽ hiển thị tự động).\n` +
              `Bạn KHÔNG được hỏi lại về việc tìm phòng hoặc hỏi "bạn muốn chúng tôi tự động kiểm tra phòng hay không".\n` +
              `${hasSelectedRoom ? '' : '⚠️⚠️⚠️ QUAN TRỌNG: Khách hàng CHƯA chọn phòng. Bạn CHỈ được trả lời ngắn gọn về danh sách phòng và yêu cầu khách chọn phòng. Bạn KHÔNG được hỏi thông tin cá nhân (Họ tên, Email, SĐT) cho đến khi khách đã chọn phòng.\n'}` +
              `Bạn PHẢI trả lời ngắn gọn: "Tôi đã tự động kiểm tra và tìm thấy [X] phòng phù hợp với yêu cầu của quý khách. Vui lòng xem chi tiết các phòng bên dưới và chọn phòng bạn muốn đặt."\n` +
              `Sau đó frontend sẽ tự động hiển thị room cards với button "Xem chi tiết" cho từng phòng.`
            : `⚠️⚠️⚠️ IMPORTANT: Customer has provided information (check-in/out dates, number of guests).\n` +
              `You HAVE AUTO-SEARCHED for available rooms and found ${roomSearchResults.length} suitable rooms.\n` +
              `You MUST display this room list with room cards (frontend will display automatically).\n` +
              `You MUST NOT ask again about searching for rooms or ask "would you like us to automatically check rooms".\n` +
              `${hasSelectedRoom ? '' : '⚠️⚠️⚠️ IMPORTANT: Customer has NOT selected a room yet. You MUST ONLY respond briefly about the room list and ask customer to choose a room. You MUST NOT ask for personal information (name, email, phone) until customer has selected a room.\n'}` +
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
          
          // ✅ QUAN TRỌNG: Thêm instruction về số thứ tự
          const roomNumberingInstruction = language === 'vi'
            ? `\n⚠️⚠️⚠️ QUAN TRỌNG VỀ SỐ THỨ TỰ KHI HIỂN THỊ DANH SÁCH PHÒNG:\n` +
              `- Phòng đầu tiên trong list PHẢI được đánh số "1" (không phải "0" hoặc số khác)\n` +
              `- Phòng thứ hai PHẢI được đánh số "2"\n` +
              `- Phòng thứ ba PHẢI được đánh số "3"\n` +
              `- ... và cứ thế cho đến hết list\n` +
              `- Khi hiển thị, bạn PHẢI dùng format: "1. **Tên phòng** (Số thứ tự: 1)" hoặc "1. **Tên phòng**"\n` +
              `- KHÔNG được dùng format: "5. **Tên phòng** (Số thứ tự: 6)" - đây là SAI vì số thứ tự không khớp\n` +
              `- Số thứ tự PHẢI = vị trí trong list (index + 1)\n` +
              `- Khi khách nói "phòng số X", đó là phòng ở vị trí X trong list (index = X - 1)\n`
            : `\n⚠️⚠️⚠️ IMPORTANT ABOUT ORDER NUMBERS WHEN DISPLAYING ROOM LIST:\n` +
              `- First room in list MUST be numbered "1" (not "0" or other number)\n` +
              `- Second room MUST be numbered "2"\n` +
              `- Third room MUST be numbered "3"\n` +
              `- ... and so on until the end of the list\n` +
              `- When displaying, you MUST use format: "1. **Room Name** (Order number: 1)" or "1. **Room Name**"\n` +
              `- MUST NOT use format: "5. **Room Name** (Order number: 6)" - this is WRONG because order number doesn't match\n` +
              `- Order number MUST = position in list (index + 1)\n` +
              `- When customer says "room number X", that's the room at position X in the list (index = X - 1)\n`;
          
          prompt += `\n\n${roomInfoLabel}:${roomNumberingInstruction}\n`;
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
      
      // ✅ THÊM: Instruction về format link cho "Khám Phá Ngay"
      const linkInstruction = language === 'vi'
        ? "\n\n🔗 FORMAT LINK QUAN TRỌNG: Khi đề cập đến 'Khám Phá Ngay', bạn PHẢI dùng format markdown link: [Khám Phá Ngay](explore). KHÔNG dùng text thường như 'phần Khám Phá Ngay' hoặc 'trang chủ website'. PHẢI dùng [Khám Phá Ngay](explore) để khách có thể click."
        : "\n\n🔗 IMPORTANT LINK FORMAT: When mentioning 'Explore Now', you MUST use markdown link format: [Explore Now](explore). DO NOT use plain text like 'Explore Now section' or 'homepage'. MUST use [Explore Now](explore) so customers can click.";
      prompt += linkInstruction;
      
      // ✅ THÊM: Log prompt để debug (chỉ log 500 ký tự đầu)
      console.log(`📋 Prompt preview (first 500 chars): ${prompt.substring(0, 500)}...`);
      
      // Call Gemini API
      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // ✅ GIAI ĐOẠN 1: Tăng counter sau khi gọi AI thành công
      const sessionId = context.sessionId || context.userId || null;
      if (sessionId) {
        incrementUserRateLimit(sessionId);
      }
      
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
      
      // ✅ Post-process: Convert "Khám Phá Ngay" thành markdown link nếu chưa có
      let processedText = text.trim();
      
      console.log('🔍 Post-processing - Original text:', processedText.substring(0, 300));
      
      // Kiểm tra xem đã có link format chưa
      const hasExploreLink = /\[([^\]]*Khám Phá Ngay[^\]]*)\]\(explore\)|\[([^\]]*Explore Now[^\]]*)\]\(explore\)/i.test(processedText);
      console.log('🔍 Post-processing - Has explore link already:', hasExploreLink);
      
      if (!hasExploreLink) {
        console.log('🔍 Post-processing - Converting text to explore links...');
        
        // Convert "Khám Phá Ngay" thành [Khám Phá Ngay](explore)
        // Pattern: bắt nhiều biến thể như "phần Khám Phá Ngay", "'Khám Phá Ngay'", "Khám Phá Ngay trên trang chủ"
        processedText = processedText.replace(
          /(?:phần\s+|xem\s+)?['"]?(Khám Phá Ngay)['"]?(?:\s+trên\s+trang\s+chủ)?/gi,
          (match, text) => {
            // Kiểm tra xem có phải đã là link format không (check trong toàn bộ text)
            if (processedText.includes(`[${text}](explore)`)) {
              return match;
            }
            console.log(`🔗 Converting "${match}" to [${text}](explore)`);
            return `[${text}](explore)`;
          }
        );
        
        // Convert "Explore Now" thành [Explore Now](explore)
        processedText = processedText.replace(
          /(?:section\s+|check\s+)?['"]?(Explore Now)['"]?(?:\s+on\s+homepage)?/gi,
          (match, text) => {
            // Kiểm tra xem có phải đã là link format không
            if (processedText.includes(`[${text}](explore)`)) {
              return match;
            }
            console.log(`🔗 Converting "${match}" to [${text}](explore)`);
            return `[${text}](explore)`;
          }
        );
        
        // ✅ THÊM: Convert các biến thể khác như "trang chủ website" hoặc "homepage" khi context liên quan đến explore
        // Chỉ convert nếu có từ khóa liên quan đến explore trong câu
        if (processedText.includes('trang chủ') || processedText.includes('homepage')) {
          // Kiểm tra xem có context về explore không
          const exploreKeywords = ['lịch sử', 'chủ khách sạn', 'tính năng', 'địa điểm', 'khám phá', 'history', 'owner', 'features', 'nearby', 'explore'];
          const hasExploreContext = exploreKeywords.some(keyword => processedText.toLowerCase().includes(keyword));
          
          if (hasExploreContext && !hasExploreLink) {
            // Thay "trang chủ website" hoặc "homepage" bằng link nếu chưa có
            processedText = processedText.replace(
              /(?:xem\s+)?(?:trên\s+)?(?:trang\s+chủ\s+website|homepage)(?:\s+của\s+chúng\s+tôi)?/gi,
              (match) => {
                const linkText = language === 'vi' ? 'Khám Phá Ngay' : 'Explore Now';
                if (!processedText.includes(`[${linkText}](explore)`)) {
                  console.log(`🔗 Converting "${match}" to [${linkText}](explore)`);
                  return `[${linkText}](explore)`;
                }
                return match;
              }
            );
          }
        }
        
        // ✅ KIỂM TRA LẠI: Nếu vẫn chưa có link, force convert bất kỳ mention nào của "Khám Phá Ngay" hoặc "Explore Now"
        const finalCheck = /\[([^\]]*Khám Phá Ngay[^\]]*)\]\(explore\)|\[([^\]]*Explore Now[^\]]*)\]\(explore\)/i.test(processedText);
        if (!finalCheck) {
          // Force convert bất kỳ mention nào
          if (processedText.includes('Khám Phá Ngay') && !processedText.includes('[Khám Phá Ngay](explore)')) {
            processedText = processedText.replace(/(Khám Phá Ngay)/g, (match) => {
              if (!processedText.includes(`[${match}](explore)`)) {
                console.log(`🔗 Force converting "${match}" to [${match}](explore)`);
                return `[${match}](explore)`;
              }
              return match;
            });
          }
          if (processedText.includes('Explore Now') && !processedText.includes('[Explore Now](explore)')) {
            processedText = processedText.replace(/(Explore Now)/g, (match) => {
              if (!processedText.includes(`[${match}](explore)`)) {
                console.log(`🔗 Force converting "${match}" to [${match}](explore)`);
                return `[${match}](explore)`;
              }
              return match;
            });
          }
        }
      }
      
      // Log để debug
      console.log('🔍 Post-processing - Final text:', processedText.substring(0, 300));
      console.log('🔍 Post-processing - Has explore link in final:', /\[([^\]]+)\]\(explore\)/.test(processedText));
      if (processedText !== text.trim()) {
        console.log('✅ Post-processed text changed');
      }
      
      // Trả về response kèm dữ liệu phòng nếu có (với giá chi tiết)
      const aiResponse = {
        text: processedText,
        rooms: enrichedRooms || roomSearchResults || null,
        hasRooms: (enrichedRooms || roomSearchResults) && (enrichedRooms || roomSearchResults).length > 0
      };
      
      // ✅ THÊM: Cache AI response để tái sử dụng (chỉ cache nếu không có rooms hoặc rooms ít)
      // Không cache responses có nhiều rooms vì có thể thay đổi theo thời gian
      if (!aiResponse.hasRooms || (aiResponse.rooms && aiResponse.rooms.length <= 3)) {
        setCachedResponse(userMessage, aiResponse);
      }
      
      return aiResponse;
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
    
    // ✅ Parse explore intent (lịch sử, chủ, tính năng, địa điểm)
    const exploreIntent = parseExploreIntent(message.trim());
    
    // ✅ Log để debug
    console.log(`🔍 Parsed booking intent:`, {
      action: bookingIntent.action,
      roomNumber: bookingIntent.roomNumber,
      hasLastRoomSearchResults: !!context.lastRoomSearchResults,
      lastRoomSearchResultsCount: context.lastRoomSearchResults?.length || 0
    });
    
    console.log(`🔍 Parsed explore intent:`, {
      type: exploreIntent.type,
      category: exploreIntent.category,
      specificFeature: exploreIntent.specificFeature
    });
    
    // ✅ Khởi tạo exploreContext nếu chưa có
    let exploreContext = {};
    if (session?.context?.exploreContext) {
      exploreContext = { ...session.context.exploreContext };
    } else if (context.exploreContext) {
      exploreContext = { ...context.exploreContext };
    }
    
    // ✅ Xử lý explore intent: Gọi API nearby-places nếu cần
    if (exploreIntent.type === 'nearby') {
      try {
        const filter = { isActive: true };
        if (exploreIntent.category) {
          filter.category = exploreIntent.category;
        }
        
        const nearbyPlaces = await NearbyPlace.find(filter).sort({ distance: 1 }).lean();
        exploreContext.nearbyPlaces = nearbyPlaces;
        exploreContext.topic = 'nearby';
        exploreContext.lastCategory = exploreIntent.category || null;
        
        console.log(`✅ Loaded ${nearbyPlaces.length} nearby places`, {
          category: exploreIntent.category || 'all',
          places: nearbyPlaces.map(p => ({ name: p.name, category: p.category }))
        });
      } catch (error) {
        console.error('❌ Error loading nearby places:', error);
        exploreContext.nearbyPlaces = [];
        exploreContext.error = 'Không thể tải danh sách địa điểm. Vui lòng thử lại sau.';
      }
    } else if (exploreIntent.type) {
      // Lưu topic cho các intent khác (history, owner, features, explore_general)
      exploreContext.topic = exploreIntent.type;
      if (exploreIntent.specificFeature) {
        exploreContext.lastAskedFeature = exploreIntent.specificFeature;
      }
    }
    
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
    // ✅ QUAN TRỌNG: Chỉ set needPersonalInfo = true khi user ĐÃ CHỌN PHÒNG
    // Nếu chưa chọn phòng, KHÔNG hỏi thông tin cá nhân
    const hasSelectedRoomForPersonalInfo = !!(context.selectedRoom || bookingContext.roomId);
    bookingContext.needPersonalInfo = !hasAllPersonalInfo && hasSelectedRoomForPersonalInfo;
    
    // ✅ LƯU Ý: Logic auto-search đã được di chuyển vào getAIResponse function (dòng 1056-1103)
    // để tránh lỗi scope với roomSearchResults
    
    // ✅ Xử lý khi user xác nhận đặt phòng
    if (bookingIntent.action === 'confirm_booking' && bookingIntent.confirmBooking) {
      bookingContext.confirmBooking = true;
      console.log('✅ User confirmed booking');
    }
    
    // ✅ Xử lý khi user muốn chọn lại phòng khác (không muốn phòng này nữa)
    if (bookingIntent.action === 'change_room') {
      const currentSelectedRoomId = context.selectedRoom?._id?.toString() || bookingContext.roomId?.toString();
      
      if (currentSelectedRoomId && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        // ✅ Filter bỏ phòng đã chọn khỏi lastRoomSearchResults
        const filteredRooms = context.lastRoomSearchResults.filter(r => {
          if (!r || !r._id) return true;
          const roomIdStr = r._id.toString ? r._id.toString() : String(r._id);
          return roomIdStr !== currentSelectedRoomId;
        });
        
        // ✅ Cập nhật lastRoomSearchResults với list mới (đã bỏ phòng không muốn)
        context.lastRoomSearchResults = filteredRooms;
        
        // ✅ Xóa selectedRoom khỏi context
        context.selectedRoom = null;
        bookingContext.roomId = null;
        bookingContext.roomName = null;
        bookingContext.roomPrice = null;
        
        // ✅ Xóa showRoomDetails và shouldNotSearchRooms để cho phép hiển thị list mới
        context.showRoomDetails = false;
        context.shouldNotSearchRooms = false;
        
        // ✅ Đánh dấu để AI biết phải hiển thị lại list phòng và hỏi yêu cầu
        context.shouldShowFilteredRoomList = true;
        context.roomChanged = true;
        
        // ✅ Tạo roomsData từ filteredRooms để hiển thị
        if (filteredRooms.length > 0) {
          roomsData = filteredRooms.map(room => ({
            id: room._id.toString ? room._id.toString() : String(room._id),
            name: room.name || 'N/A',
            roomType: room.roomType || 'Standard',
            pricePerNight: room.pricePerNight || 0,
            maxOccupancy: room.maxOccupancy || 2,
            view: room.view || 'N/A',
            image: room.image || room.thumbnailUrl || '',
            amenities: Array.isArray(room.amenities) ? room.amenities : []
          }));
          hasRooms = true;
        }
        
        // ✅ Lưu vào session
        if (session) {
          if (!session.context) session.context = {};
          session.context.selectedRoom = null;
          session.context.lastRoomSearchResults = filteredRooms;
          session.context.bookingContext = bookingContext;
          session.context.shouldShowFilteredRoomList = true;
          session.context.roomChanged = true;
          await session.save();
        }
        
        console.log(`✅ User wants to change room. Removed room ${currentSelectedRoomId} from list.`, {
          originalCount: context.lastRoomSearchResults.length + 1,
          filteredCount: filteredRooms.length,
          hasRooms: hasRooms,
          roomsDataLength: roomsData?.length || 0
        });
      } else {
        // Nếu không có lastRoomSearchResults, xóa selectedRoom và hỏi lại yêu cầu
        context.selectedRoom = null;
        bookingContext.roomId = null;
        bookingContext.roomName = null;
        bookingContext.roomPrice = null;
        context.showRoomDetails = false;
        context.shouldNotSearchRooms = false;
        context.shouldAskForNewRoomCriteria = true;
        
        if (session) {
          if (!session.context) session.context = {};
          session.context.selectedRoom = null;
          session.context.bookingContext = bookingContext;
          session.context.shouldAskForNewRoomCriteria = true;
          await session.save();
        }
        
        console.log(`✅ User wants to change room but no room list available. Will ask for new criteria.`);
      }
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
            amenities: (fullSelectedRoom && Array.isArray(fullSelectedRoom.amenities) && fullSelectedRoom.amenities) || [],
            detailLink: createRoomDetailLink(selectedRoomId)
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
        // ✅ QUAN TRỌNG: Convert roomNumber sang index (roomNumber 1 = index 0, roomNumber 2 = index 1, ...)
        const selectedRoomIndex = bookingIntent.roomNumber - 1;
        
        // ✅ QUAN TRỌNG: Validate roomNumber
        if (bookingIntent.roomNumber < 1 || bookingIntent.roomNumber > context.lastRoomSearchResults.length) {
          console.warn(`⚠️ Invalid room number: ${bookingIntent.roomNumber} (only ${context.lastRoomSearchResults.length} rooms available)`);
          context.invalidRoomSelection = {
            requestedRoom: bookingIntent.roomNumber,
            availableRooms: context.lastRoomSearchResults.length,
            rooms: context.lastRoomSearchResults.map((r, idx) => ({
              number: idx + 1,
              name: r.name,
              price: r.pricePerNight
            }))
          };
        } else if (selectedRoomIndex >= 0 && selectedRoomIndex < context.lastRoomSearchResults.length) {
          const selectedRoom = context.lastRoomSearchResults[selectedRoomIndex];
          
          // ✅ QUAN TRỌNG: Log toàn bộ lastRoomSearchResults để debug thứ tự
          console.log(`🔍 User selected room #${bookingIntent.roomNumber} (index ${selectedRoomIndex}):`, {
            totalRooms: context.lastRoomSearchResults.length,
            requestedNumber: bookingIntent.roomNumber,
            actualIndex: selectedRoomIndex,
            allRooms: context.lastRoomSearchResults.map((r, idx) => ({
              number: idx + 1,
              index: idx,
              roomId: r._id,
              name: r.name,
              price: r.pricePerNight,
              isSelected: idx === selectedRoomIndex
            }))
          });
          
          // ✅ Log để debug - xác nhận phòng được lấy đúng
          console.log(`✅ Selected room from lastRoomSearchResults:`, {
            requestedNumber: bookingIntent.roomNumber,
            actualIndex: selectedRoomIndex,
            roomId: selectedRoom._id,
            name: selectedRoom.name,
            price: selectedRoom.pricePerNight,
            roomType: selectedRoom.roomType,
            matchesRequest: true,
            // ✅ Verify: So sánh với phòng trong list
            expectedRoomName: context.lastRoomSearchResults[selectedRoomIndex]?.name,
            actualRoomName: selectedRoom.name,
            matches: context.lastRoomSearchResults[selectedRoomIndex]?.name === selectedRoom.name
          });
          
          // ✅ VALIDATION: Kiểm tra lại availability trước khi chọn phòng
          if (bookingContext.checkInDate && bookingContext.checkOutDate) {
            const isStillAvailable = await checkRoomAvailability(
              selectedRoom._id,
              bookingContext.checkInDate,
              bookingContext.checkOutDate
            );
            
            if (!isStillAvailable) {
              // Phòng đã bị book bởi người khác, thông báo và gợi ý phòng khác
              console.warn(`⚠️ Room ${selectedRoom.name} is no longer available for selected dates`);
              context.roomNoLongerAvailable = {
                roomName: selectedRoom.name,
                roomId: selectedRoom._id.toString(),
                checkIn: bookingContext.checkInDate,
                checkOut: bookingContext.checkOutDate
              };
              
              // Xóa phòng không còn trống khỏi lastRoomSearchResults
              context.lastRoomSearchResults = context.lastRoomSearchResults.filter(
                r => r._id.toString() !== selectedRoom._id.toString()
              );
              
              // Nếu còn phòng khác, gợi ý lại
              if (context.lastRoomSearchResults.length > 0) {
                context.shouldSuggestAlternativeRooms = true;
              }
              
              // Không set selectedRoom, để AI biết và trả lời user
              return; // Dừng xử lý, để AI trả lời user
            }
          }
          
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
            
            // ✅ Tạo booking link với đầy đủ thông tin để user có thể xem lại và thanh toán
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            bookingLink = createBookingLink({
              roomId: bookingContext.roomId,
              roomQuantity: bookingContext.roomQuantity || 1,
              checkInDate: bookingContext.checkInDate,
              checkOutDate: bookingContext.checkOutDate,
              guests: bookingContext.guests || bookingContext.maxOccupancy,
              fullName: bookingContext.fullName,
              email: bookingContext.email,
              phone: bookingContext.phone,
              note: bookingContext.note
            });
            
            // Tạo link thanh toán
            paymentLink = `${baseUrl}/payment?bookingId=${newBooking._id}`;
            console.log('✅ Booking created successfully for guest user:', newBooking._id);
            console.log('✅ Booking link (with full info):', bookingLink);
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
    // Lấy phản hồi từ AI (với conversation history, exploreContext, và exploreIntent)
    const aiResponse = await getAIResponse(message.trim(), context, conversationHistory, exploreContext, exploreIntent);
    
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
      
      // ✅ Lưu exploreContext vào session
      if (exploreContext && Object.keys(exploreContext).length > 0) {
        session.context.exploreContext = exploreContext;
        console.log(`💾 Saving exploreContext to session:`, {
          topic: exploreContext.topic,
          hasNearbyPlaces: !!exploreContext.nearbyPlaces,
          nearbyPlacesCount: exploreContext.nearbyPlaces?.length || 0,
          lastCategory: exploreContext.lastCategory,
          lastAskedFeature: exploreContext.lastAskedFeature
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
        amenities: Array.isArray(room.amenities) ? room.amenities : [],
        detailLink: createRoomDetailLink(room._id)
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
          amenities: matchingRoom.amenities || [],
          detailLink: createRoomDetailLink(matchingRoom._id)
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
      amenities: room.amenities || [],
      detailLink: createRoomDetailLink(room._id)
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
          amenities: room.amenities || [],
          detailLink: createRoomDetailLink(room._id)
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
    // ✅ QUAN TRỌNG: Bỏ qua logic này nếu user muốn đổi phòng (roomChanged = true)
    if (finalRoomsData && finalRoomsData.length > 1 && !context.roomChanged) {
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
    } else if (context.roomChanged && finalRoomsData) {
      // ✅ Khi user đổi phòng, hiển thị tất cả phòng trong list (đã filter bỏ phòng không muốn)
      console.log('✅ User changed room - showing all filtered rooms:', {
        totalRooms: finalRoomsData.length,
        rooms: finalRoomsData.map(r => r.name)
      });
    }
    
    // ✅ Loại bỏ markdown links và các format đặc biệt khỏi response text khi đã có room cards (vì mỗi card đã có button riêng)
    // ✅ QUAN TRỌNG: Luôn clean response text để loại bỏ các format không cần thiết như "[roomDetailLink: {...}]"
    // ✅ QUAN TRỌNG: GIỮ LẠI link [text](explore) để frontend có thể render thành clickable link
    console.log('🔍 Before removeMarkdownLinks - finalResponseText:', finalResponseText.substring(0, 300));
    console.log('🔍 Checking for explore link in text:', /\[([^\]]+)\]\(explore\)/.test(finalResponseText));
    
    // ✅ QUAN TRỌNG: Try-catch để đảm bảo function chạy
    let cleanedResponseText;
    try {
      cleanedResponseText = removeMarkdownLinks(finalResponseText);
      console.log('✅ removeMarkdownLinks completed successfully');
    } catch (error) {
      console.error('❌ ERROR in removeMarkdownLinks:', error);
      // Fallback: return text gốc nếu có lỗi
      cleanedResponseText = finalResponseText;
    }
    
    console.log('🔍 After removeMarkdownLinks - cleanedResponseText:', cleanedResponseText.substring(0, 300));
    console.log('🔍 Final check - Has explore link in cleaned text:', /\[([^\]]+)\]\(explore\)/.test(cleanedResponseText));
    
    // ✅ Nếu link bị mất, restore lại từ text gốc
    if (!/\[([^\]]+)\]\(explore\)/.test(cleanedResponseText) && /\[([^\]]+)\]\(explore\)/.test(finalResponseText)) {
      console.error('❌ ERROR: Explore link was removed! Restoring from original...');
      // Chỉ xóa các markdown links khác, giữ lại explore links
      cleanedResponseText = finalResponseText;
      // Xóa các markdown links khác (không phải explore)
      cleanedResponseText = cleanedResponseText.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, linkText, url) => {
        if (url.trim() === 'explore') {
          return match; // Giữ lại explore links
        }
        return linkText; // Xóa các links khác
      });
      // Xóa các format đặc biệt
      cleanedResponseText = cleanedResponseText.replace(/\[roomDetailLink:[^\]]+\]/g, '');
      cleanedResponseText = cleanedResponseText.replace(/\[bookingLink:[^\]]+\]/g, '');
      cleanedResponseText = cleanedResponseText.replace(/\[paymentLink:[^\]]+\]/g, '');
      console.log('✅ Restored explore link from original text');
    }
    
    // ✅ Guard: Không được nói "hết phòng" khi vẫn còn list phòng/roomsData
    const hasAnyRoomsList = (finalRoomsData && finalRoomsData.length > 0) || (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0);
    const availabilityNegativeRegex = /(hết phòng|không còn phòng|sold out|no rooms available)/i;
    if (availabilityNegativeRegex.test(cleanedResponseText) && hasAnyRoomsList) {
      console.warn('⚠️ Availability contradiction detected: negative text while rooms list exists. Rewriting response.');
      cleanedResponseText = language === 'vi'
        ? 'Mình sẽ kiểm tra phòng trống và gửi lại cho bạn. Hiện chưa xác nhận hết phòng, bạn cho mình biết ngày nhận/trả phòng để mình kiểm tra chính xác nhé.'
        : 'Let me check the availability and get back to you. Not confirmed sold-out. Please share your check-in/check-out dates so I can check accurately.';
    }
    // ✅ Guard: Nếu không có kết quả kiểm tra rõ ràng, chuyển hướng sang hỏi ngày check-in/out thay vì khẳng định hết phòng
    if (availabilityNegativeRegex.test(cleanedResponseText) && !context.roomNoLongerAvailable && !hasRooms) {
      console.warn('⚠️ Availability negative without explicit check. Rewriting to ask for dates.');
      cleanedResponseText = language === 'vi'
        ? 'Mình cần kiểm tra tình trạng phòng. Bạn cho mình biết ngày nhận/trả phòng và số khách để mình kiểm tra chính xác nhé.'
        : 'I need to check availability. Please share your check-in/check-out dates and number of guests so I can verify accurately.';
    }
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