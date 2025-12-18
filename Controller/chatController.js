import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";
import Room from "../Models/RoomModel.js";
import Booking from "../Models/BookingModel.js";
import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import emailService from "../services/emailService.js";
import NearbyPlace from "../Models/NearbyPlaceModel.js";
import crypto from "crypto";
import dotenv from "dotenv";
import { detectLanguage, getLanguage } from "../utils/languageDetector.js";
import googleCalendarService from "../services/googleCalendarService.js";
import { getHotelConfig, getService, getPolicy, getPayment, getPromotions, getFallbackPrices } from "../utils/hotelConfig.js";

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
// Default model; override via GEMINI_MODEL in .env
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();

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
          model: GEMINI_MODEL,
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
        console.log(`✅ Gemini API initialized successfully with model: ${GEMINI_MODEL}`);
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
const SYSTEM_PROMPT = `Bạn là trợ lý ảo của Rayal Park Hotel (5 sao, Thùy Vân, Phường 1, Vũng Tàu, Hồ Chí Minh City, hotline 0901 234 567, email info@rayalpark.com).

VỊ TRÍ ĐẶC BIỆT: Khách sạn tọa lạc tại Vũng Tàu, khu vực ven biển kết hợp hài hòa giữa biển và đồi núi, gần các bãi biển nổi tiếng (Bãi Sau, Bãi Trước, Bãi Dứa), khu vực núi (Núi Nhỏ, Núi Lớn, Hải đăng Vũng Tàu) và nhiều nhà hàng hải sản địa phương.

Ngôn ngữ: trả lời đúng ngôn ngữ khách dùng (Việt/Anh), không trộn ngôn ngữ.
Phong cách: ngắn gọn, đúng trọng tâm, thân thiện; chỉ nêu điều khách hỏi; không lặp lại danh sách phòng.
Ưu tiên: nếu đã có danh sách phòng hoặc phòng tìm được → hiển thị ngay, đánh số từ 1; không hỏi thông tin cá nhân trước khi cho khách chọn phòng.
Chính sách hủy (khi được hỏi): trước 48h miễn phí; 24-48h: 30%; <24h: 50%; no-show: 100%.
Dịch vụ (khi được hỏi): WiFi, 24/7 room service, nhà hàng, spa, hồ bơi, gym, đưa đón sân bay.
Nếu thiếu dữ liệu: nói không chắc và hướng khách gọi hotline.`;

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
  
  // Ngày mốt (= ngày kia, tức là 2 ngày sau hôm nay)
  if (lowerText.includes("ngày mốt")) {
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
    // Pattern cho "ngày mai ngày mốt" hoặc "mai mốt"
    /(?:ngày mai)\s*(?:ngày mốt|mốt)/i,
    /(?:từ|from|check-in|nhận phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|ngày mốt|today|tomorrow).*?(?:đến|to|check-out|trả phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|ngày mốt|today|tomorrow)/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)\s*(?:đến|-|to)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)/i
  ];
  
  // ✅ Đặc biệt: "ngày mai ngày mốt" = check-in ngày mai, check-out ngày mốt
  if (/ngày mai\s*(?:ngày mốt|mốt)/i.test(userMessage)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    dayAfterTomorrow.setHours(0, 0, 0, 0);
    
    criteria.checkInDate = tomorrow;
    criteria.checkOutDate = dayAfterTomorrow;
    console.log('✅ Parsed "ngày mai ngày mốt":', { checkIn: tomorrow, checkOut: dayAfterTomorrow });
  }
  
  // Chỉ parse từ patterns nếu chưa có dates (tránh ghi đè "ngày mai ngày mốt")
  if (!criteria.checkInDate || !criteria.checkOutDate) {
    for (const pattern of datePatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1] && match[2]) {
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
      // ✅ FIX: Xử lý cả trường hợp maxOccupancy là số và là object MongoDB query
      if (typeof criteria.maxOccupancy === 'object' && !Array.isArray(criteria.maxOccupancy)) {
        // Nếu là object MongoDB query (ví dụ: { $gte: 2 }), dùng trực tiếp
        filter.maxOccupancy = criteria.maxOccupancy;
      } else if (typeof criteria.maxOccupancy === 'number') {
        // Nếu là số, tạo query như cũ
      // ✅ Ưu tiên phòng có maxOccupancy chính xác hoặc gần với yêu cầu
      // Giới hạn trong khoảng hợp lý: maxOccupancy >= yêu cầu và <= yêu cầu + 2
      // Ví dụ: nếu yêu cầu 4 người, chỉ lấy phòng 4-6 người, không lấy phòng 8 người trở lên
      const maxOccupancyLimit = criteria.maxOccupancy + 2;
      filter.maxOccupancy = { 
        $gte: criteria.maxOccupancy,
        $lte: maxOccupancyLimit
      };
      }
    }

    // Filter theo view
    if (criteria.view) {
      // ✅ Cải thiện regex để match nhiều format: "biển" -> match "Ocean View", "Hướng Biển", "Sea View", "view biển", etc.
      let viewPattern = criteria.view;
      if (criteria.view === 'biển') {
        // Match: "Ocean View", "Hướng Biển", "Sea View", "view biển", "biển", "ocean", "sea"
        viewPattern = '(ocean|sea|biển|hướng biển)';
      } else if (criteria.view === 'thành phố') {
        viewPattern = '(city|thành phố)';
      } else if (criteria.view === 'núi') {
        viewPattern = '(mountain|núi)';
      }
      filter.view = { $regex: viewPattern, $options: "i" };
      console.log(`🔍 Filtering by view: pattern="${viewPattern}", criteria.view="${criteria.view}"`);
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
      // ✅ FIX: Chỉ sắp xếp nếu maxOccupancy là số, không phải object query
      if (typeof criteria.maxOccupancy === 'number') {
      // Tách phòng thành 2 nhóm: phòng có maxOccupancy = yêu cầu và phòng có maxOccupancy > yêu cầu
      const exactMatchRooms = rooms.filter(r => r.maxOccupancy === criteria.maxOccupancy);
      const largerRooms = rooms.filter(r => r.maxOccupancy > criteria.maxOccupancy);
      
      // Sắp xếp phòng lớn hơn theo maxOccupancy tăng dần (phòng gần với yêu cầu nhất trước)
      largerRooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
      
      // Ưu tiên phòng chính xác, sau đó mới đến phòng lớn hơn (đã sắp xếp)
      rooms = [...exactMatchRooms, ...largerRooms];
      } else {
        // Nếu là object query, chỉ sắp xếp theo maxOccupancy tăng dần
        rooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
      }
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
    'mua sắm gần', 'quán ăn gần', 'đi chơi đâu', 'đi chơi được đâu', 'đi chơi ở đâu',
    'du lịch gần', 'địa điểm tham quan gần', 'ăn uống gần', 'shopping gần',
    'bệnh viện gần', 'ngân hàng gần', 'nearby', 'restaurant near',
    'attraction', 'shopping near', 'đi đâu chơi', 'chơi gì', 'tham quan',
    'biển', 'bãi biển', 'núi', 'hải đăng', 'vũng tàu có gì'
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
  
  // ✅ QUAN TRỌNG: Chỉ set change_room nếu KHÔNG có "phòng số X" trong message
  // Nếu có "chọn lại phòng số X", sẽ được parse ở phần dưới thành select_room
  const hasRoomNumberPattern = /phòng\s*(?:số|thứ|number)\s*\d+|số\s*\d+/i.test(lowerMessage);
  if (isChangingRoom && (context.selectedRoom || context.bookingContext?.roomId) && !hasRoomNumberPattern) {
    intent.action = 'change_room'; // Action mới để xử lý đổi phòng (không có số phòng cụ thể)
    console.log('✅ Detected change room request (without specific room number)');
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
  } else if (
    !isChangingRoom &&
    !intent.action &&
    !context.selectedRoom &&
    !context.bookingContext?.roomId &&
    Array.isArray(context.lastRoomSearchResults) &&
    context.lastRoomSearchResults.length === 1 &&
    (
      lowerMessage.trim() === "có" ||
      lowerMessage.includes("ok") ||
      lowerMessage.includes("okay") ||
      lowerMessage.includes("đồng ý") ||
      lowerMessage.includes("yes") ||
      lowerMessage.includes("lấy phòng") ||
      lowerMessage.includes("chốt")
    )
  ) {
    // Nếu chỉ còn 1 phòng trong list và user trả lời đồng ý, tự chọn phòng #1
    intent.action = 'select_room';
    intent.roomNumber = 1;
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
      /(?:chọn|đặt|muốn|book|select)\s*(\d+)(?!\s*người)/i, // "chọn 2", "đặt 2" - ✅ THÊM: Pattern cho "đổi phòng khác chọn 2"
      /số\s*(\d+)/i, // "số 2"
      /^(\d+)$/ // Chỉ có số (chỉ khi có context.lastRoomSearchResults)
    ];
    
    let roomSelected = false;
    for (const pattern of roomSelectPatterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        const roomNum = parseInt(match[1]);
        // ✅ Nếu có list phòng, ưu tiên coi đây là chọn phòng từ list
        // ✅ QUAN TRỌNG: Override change_room nếu có roomNumber cụ thể
        if (hasRoomList && roomNum >= 1 && roomNum <= context.lastRoomSearchResults.length) {
          intent.action = 'select_room'; // ✅ QUAN TRỌNG: Override change_room nếu có
          intent.roomNumber = roomNum;
          roomSelected = true;
          console.log(`✅ Parsed room selection: "phòng số ${roomNum}" (from list of ${context.lastRoomSearchResults.length} rooms) - Overriding change_room`);
          break;
        }
        // ✅ QUAN TRỌNG: Nếu có từ "chọn" rõ ràng + số hợp lệ, luôn override change_room thành select_room
        // (ngay cả khi list phòng count = 0, vì user vẫn muốn chọn phòng số X)
        const hasExplicitSelectKeyword = /(?:chọn|đặt|muốn|book|select)\s*(\d+)/i.test(lowerMessage) || 
                                         /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(\d+)/i.test(lowerMessage);
        if (hasExplicitSelectKeyword && roomNum >= 1 && roomNum <= 20) {
          intent.action = 'select_room'; // ✅ Override change_room ngay cả khi không có list phòng
          intent.roomNumber = roomNum;
          roomSelected = true;
          console.log(`✅ Parsed explicit room selection: "chọn ${roomNum}" - Overriding change_room (list count: ${context.lastRoomSearchResults?.length || 0})`);
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
    
    // ✅ THÊM: Parse "phòng cuối cùng", "phòng cuối", "phòng cuối cùng trong list"
    if (!roomSelected && hasRoomList && context.lastRoomSearchResults.length > 0) {
      const lastRoomPatterns = [
        /(?:phòng|room).*?(?:cuối cùng|cuối|last)/i, // "phòng cuối cùng", "phòng cuối", "room last"
        /(?:cuối cùng|cuối|last).*?(?:phòng|room)/i, // "cuối cùng", "cuối", "last room"
        /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(?:cuối cùng|cuối|last)/i // "chọn phòng cuối cùng"
      ];
      
      for (const pattern of lastRoomPatterns) {
        const match = lowerMessage.match(pattern);
        if (match) {
          const lastRoomNumber = context.lastRoomSearchResults.length;
          intent.action = 'select_room';
          intent.roomNumber = lastRoomNumber;
          roomSelected = true;
          console.log(`✅ Parsed last room selection: "phòng cuối cùng" = room #${lastRoomNumber} (from list of ${context.lastRoomSearchResults.length} rooms)`);
          break;
        }
      }
    }
    
    // ✅ THÊM: Parse "phòng đầu tiên", "phòng đầu", "phòng đầu tiên trong list"
    if (!roomSelected && hasRoomList && context.lastRoomSearchResults.length > 0) {
      const firstRoomPatterns = [
        /(?:phòng|room).*?(?:đầu tiên|đầu|first)/i, // "phòng đầu tiên", "phòng đầu", "room first"
        /(?:đầu tiên|đầu|first).*?(?:phòng|room)/i, // "đầu tiên", "đầu", "first room"
        /(?:chọn|đặt|muốn|book|select).*?(?:phòng|room).*?(?:đầu tiên|đầu|first)/i // "chọn phòng đầu tiên"
      ];
      
      for (const pattern of firstRoomPatterns) {
        const match = lowerMessage.match(pattern);
        if (match) {
          intent.action = 'select_room';
          intent.roomNumber = 1; // Phòng đầu tiên = số 1
          roomSelected = true;
          console.log(`✅ Parsed first room selection: "phòng đầu tiên" = room #1 (from list of ${context.lastRoomSearchResults.length} rooms)`);
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
  // ✅ Đặc biệt: "ngày mai ngày mốt" = check-in ngày mai, check-out ngày mốt
  if (/ngày mai\s*(?:ngày mốt|mốt)/i.test(userMessage)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    dayAfterTomorrow.setHours(0, 0, 0, 0);
    
    intent.checkInDate = tomorrow;
    intent.checkOutDate = dayAfterTomorrow;
    intent.nights = 1;
    console.log('✅ parseBookingIntent - Parsed "ngày mai ngày mốt":', { checkIn: tomorrow, checkOut: dayAfterTomorrow });
  }
  
  const datePatterns = [
    /(?:từ|from|check-in|nhận phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|ngày mốt|today|tomorrow).*?(?:đến|to|check-out|trả phòng).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|ngày mốt|today|tomorrow)/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)\s*(?:đến|-|to)\s*(\d{1,2}\/\d{1,2}(?:\/\d{1,2})?)/i
  ];
  
  // Chỉ parse từ patterns nếu chưa có dates
  if (!intent.checkInDate || !intent.checkOutDate) {
    for (const pattern of datePatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1] && match[2]) {
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

// ✅ Helper: Tạo booking trực tiếp từ dữ liệu chat (không gọi Gemini)
const createBookingFromChat = async ({ bookingContext, fullName, email, phone }) => {
  if (!bookingContext?.roomId || !bookingContext.checkInDate || !bookingContext.checkOutDate || !fullName || !email || !phone) {
    return { error: "Thiếu thông tin bắt buộc để tạo booking." };
  }

  const checkIn = new Date(bookingContext.checkInDate);
  const checkOut = new Date(bookingContext.checkOutDate);
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkIn >= checkOut) {
    return { error: "Ngày check-in/check-out không hợp lệ." };
  }

  const room = await Room.findById(bookingContext.roomId);
  if (!room) return { error: "Không tìm thấy phòng đã chọn." };

  // Kiểm tra phòng trống
  const overlappingBooking = await Booking.findOne({
    room: room._id,
    status: { $in: ["pending", "confirmed"] },
    $or: [
      { checkInDate: { $lt: checkOut }, checkOutDate: { $gt: checkIn } },
    ],
  });
  if (overlappingBooking) {
    return { error: "Phòng đã được đặt trong khoảng thời gian này, vui lòng chọn phòng khác hoặc đổi ngày." };
  }

  // Tìm/ tạo user theo email
  let user = await User.findOne({ email });
  if (!user) {
    const randomPass = crypto.randomBytes(12).toString("hex");
    const hashedPassword = await bcrypt.hash(randomPass, 10);
    user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: "user",
    });
  } else {
    const shouldUpdate = (user.fullName !== fullName) || (user.phone !== phone);
    if (shouldUpdate) {
      user.fullName = fullName;
      user.phone = phone;
      await user.save();
    }
  }

  const nights = Math.max(1, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
  const roomQuantity = bookingContext.roomQuantity && bookingContext.roomQuantity > 0 ? bookingContext.roomQuantity : 1;
  const totalPrice = (room.pricePerNight || 0) * nights * roomQuantity;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const newBooking = await Booking.create([{
      user: user._id,
      room: room._id,
      roomQuantity,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      totalPrice,
      status: "pending",
      note: bookingContext.note || "",
    }], { session });

    const booking = newBooking[0];
    await session.commitTransaction();

    // Gửi email xác nhận (không block flow chính)
    (async () => {
      try {
        await emailService.sendBookingConfirmation(booking, user, room, null);
        console.log("✅ Booking confirmation email sent to:", user.email);
      } catch (mailErr) {
        console.error("⚠️ Failed to send booking confirmation email:", mailErr?.message || mailErr);
      }
    })();

    return { booking, user, room, totalPrice, nights };
  } catch (err) {
    await session.abortTransaction();
    return { error: err?.message || "Lỗi khi tạo booking." };
  } finally {
    session.endSession();
  }
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
      'địa chỉ': 'Địa chỉ khách sạn: Thùy Vân, Phường 1, Vũng Tàu, Hồ Chí Minh City. Bạn có thể tìm trên Google Maps!',
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
      // ✅ Removed 'chính sách hủy phòng' and 'hủy phòng' - handled by complex pattern that fetches from hotelInfo
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
      // ✅ THÊM: Mở rộng thêm các câu hỏi thường gặp
      'email': 'Email của chúng tôi là: info@rayalpark.com. Bạn có thể gửi email bất cứ lúc nào! 📧',
      'email khách sạn': 'Email của chúng tôi là: info@rayalpark.com. Bạn có thể gửi email bất cứ lúc nào! 📧',
      'facebook': 'Facebook của chúng tôi: facebook.com/rayalparkhotel. Theo dõi để cập nhật ưu đãi mới nhất! 📱',
      'website': 'Website của chúng tôi: www.rayalpark.com. Bạn có thể đặt phòng trực tuyến tại đây! 🌐',
      // ✅ Removed 'giá phòng bao nhiêu' - handled by complex pattern that fetches real prices from DB
      'phòng rẻ nhất': 'Phòng rẻ nhất là Phòng Đơn từ 1.500.000 VNĐ/đêm. Để biết giá chính xác, vui lòng cho biết ngày và số người! 💰',
      'phòng đắt nhất': 'Phòng Suite là loại cao cấp nhất từ 5.000.000+ VNĐ/đêm. Để biết giá chính xác, vui lòng cho biết ngày và số người! 💰',
      'có bao gồm bữa sáng không': 'Bữa sáng có thể được bao gồm trong giá phòng hoặc đặt thêm. Vui lòng cho biết khi đặt phòng! 🍳',
      'có bao gồm thuế không': 'Giá phòng đã bao gồm VAT và phí dịch vụ. Không có phí ẩn! ✅',
      'có thể đặt online không': 'Có! Bạn có thể đặt phòng online qua website hoặc chat với tôi. Tôi sẽ hướng dẫn bạn! 💻',
      'cần đặt cọc không': 'Có thể cần đặt cọc tùy theo chính sách. Vui lòng liên hệ hotline: 0901 234 567 để biết chi tiết! 💳',
      'có thể hủy phòng không': 'Có! Chính sách hủy:\n- Trước 24h: Miễn phí\n- Trong 24h: Phí 50%\n- No-show: Phí 100%',
      'có phòng trống không': 'Để kiểm tra phòng trống, vui lòng cho biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ kiểm tra ngay! 🔍',
      'có phòng cho': 'Để kiểm tra phòng, vui lòng cho biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ tìm phòng phù hợp! 🔍',
      'tìm phòng cho': 'Để tìm phòng, vui lòng cho biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ tìm phòng phù hợp! 🔍',
      'có phòng view': 'Chúng tôi có các loại view:\n- View biển (Ocean View)\n- View thành phố (City View)\n- View núi (Mountain View)\n\nBạn muốn loại nào?',
      'view nào có': 'Chúng tôi có các loại view:\n- View biển (Ocean View)\n- View thành phố (City View)\n- View núi (Mountain View)\n\nBạn muốn loại nào?',
      'có phòng vip không': 'Có! Chúng tôi có Phòng VIP với đầy đủ tiện nghi cao cấp. Để biết giá và phòng trống, vui lòng cho biết ngày và số người! ⭐',
      'có phòng suite không': 'Có! Chúng tôi có Phòng Suite rộng rãi và sang trọng. Để biết giá và phòng trống, vui lòng cho biết ngày và số người! 🏰',
      'phòng nào đẹp nhất': 'Phòng Suite là loại đẹp nhất với view đẹp và đầy đủ tiện nghi cao cấp. Để biết giá và phòng trống, vui lòng cho biết ngày và số người! 🌟',
      'có thể xem phòng trước không': 'Có thể! Bạn có thể đến khách sạn để xem phòng. Vui lòng liên hệ trước qua hotline: 0901 234 567 để sắp xếp! 👀',
      'có thể tham quan khách sạn không': 'Có thể! Bạn có thể đến tham quan khách sạn. Vui lòng liên hệ trước qua hotline: 0901 234 567! 🏨',
      'có tour tham quan không': 'Có thể! Bạn có thể đến tham quan khách sạn. Vui lòng liên hệ trước qua hotline: 0901 234 567! 🏨',
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
      'address': 'Hotel address: Thùy Vân, Phường 1, Vũng Tàu, Hồ Chí Minh City. You can find it on Google Maps!',
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
      // ✅ THÊM: Mở rộng thêm các câu hỏi thường gặp (English)
      'email': 'Our email is: info@rayalpark.com. You can email us anytime! 📧',
      'hotel email': 'Our email is: info@rayalpark.com. You can email us anytime! 📧',
      'facebook': 'Our Facebook: facebook.com/rayalparkhotel. Follow us for latest offers! 📱',
      'website': 'Our website: www.rayalpark.com. You can book online here! 🌐',
      'room price': 'Room prices range from 1,500,000 - 5,000,000 VND/night depending on type. For exact price, please provide dates and number of guests! 💰',
      'cheapest room': 'The cheapest room is Single Room from 1,500,000 VND/night. For exact price, please provide dates and number of guests! 💰',
      'most expensive room': 'The Suite is the most luxurious room from 5,000,000+ VND/night. For exact price, please provide dates and number of guests! 💰',
      'breakfast included': 'Breakfast can be included in room rate or added separately. Please specify when booking! 🍳',
      'tax included': 'Room price includes VAT and service charge. No hidden fees! ✅',
      'book online': 'Yes! You can book online via our website or chat with me. I will guide you! 💻',
      'deposit required': 'Deposit may be required depending on policy. Please contact hotline: 0901 234 567 for details! 💳',
      'can cancel': 'Yes! Cancellation policy:\n- Before 24h: Free\n- Within 24h: 50% fee\n- No-show: 100% fee',
      'room available': 'To check availability, please provide:\n- Check-in date\n- Check-out date\n- Number of guests\n\nI will check right away! 🔍',
      'room types available': 'We have 4 room types:\n- Single Room (1-2 people)\n- Double Room (2 people)\n- VIP Room (2-4 people)\n- Suite (4-6 people)\n\nWhich would you like?',
      'view types': 'We have view types:\n- Ocean View\n- City View\n- Mountain View\n\nWhich would you like?',
      'vip room': 'Yes! We have VIP Rooms with premium amenities. For price and availability, please provide dates and number of guests! ⭐',
      'suite room': 'Yes! We have spacious and luxurious Suites. For price and availability, please provide dates and number of guests! 🏰',
      'best room': 'The Suite is our best room with beautiful views and premium amenities. For price and availability, please provide dates and number of guests! 🌟',
      'view room': 'Possible! You can visit the hotel to view rooms. Please contact in advance via hotline: 0901 234 567 to arrange! 👀',
      'visit hotel': 'Possible! You can visit the hotel. Please contact in advance via hotline: 0901 234 567! 🏨',
      'hotel tour': 'Possible! You can visit the hotel. Please contact in advance via hotline: 0901 234 567! 🏨',
    }
  };
  
  const responses = simpleResponses[language] || simpleResponses.vi;
  
  // Tìm exact match hoặc starts with
  for (const [key, response] of Object.entries(responses)) {
    if (lowerMessage === key || lowerMessage.startsWith(key + ' ')) {
      return response;
    }
  }
  
  // Tìm partial match (chứa keyword) - NHƯNG loại trừ các trường hợp có thông tin đầy đủ
  // ✅ QUAN TRỌNG: Không match "muốn đặt phòng" nếu user đã cung cấp dates và guests
  const hasDateInfo = /\d{1,2}\/\d{1,2}/.test(userMessage) || 
                      /(?:hôm nay|ngày mai|ngày kia|today|tomorrow)/i.test(userMessage);
  const hasGuestInfo = /\d+\s*(?:người|people|person|guests)/i.test(userMessage);
  
  for (const [key, response] of Object.entries(responses)) {
    // ✅ Bỏ qua các key liên quan đến booking nếu user đã có thông tin đầy đủ
    if ((key === 'muốn đặt phòng' || key === 'cách đặt phòng' || key === 'làm sao để đặt phòng') && 
        hasDateInfo && hasGuestInfo) {
      continue; // Bỏ qua rule-based, để pattern-based xử lý
    }
    
    if (lowerMessage.includes(key)) {
      return response;
    }
  }
  
  return null; // Không tìm thấy, cần dùng AI
};

// ✅ SỬA: Response Cache System - Database-only (không dùng RAM)
// Cache được lưu trực tiếp vào MongoDB, không cần RAM cache

/**
 * Lấy cached response nếu có
 * @param {string} userMessage - User message
 * @returns {object|null} - Cached response hoặc null
 */
const normalizeCacheKey = (text = "") => {
  // Normalize cache key to improve hit-rate: lowercase, trim, collapse spaces, drop trailing punctuation
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?…]+$/g, "");
};

// ✅ SỬA: Database-only cache (không dùng RAM)
const getCachedResponse = async (userMessage) => {
  const cacheKey = normalizeCacheKey(userMessage);
  
  try {
    const ResponseCache = (await import('../Models/ResponseCacheModel.js')).default;
    const cached = await ResponseCache.findOne(
      { queryKey: cacheKey },
      { response: 1, _id: 0 } // Chỉ lấy response, không lấy _id
    );
    
    if (cached && cached.response) {
      // Update hit count và last used (async, không block)
      ResponseCache.updateOne(
        { queryKey: cacheKey },
        { $inc: { hitCount: 1 }, lastUsed: new Date() }
      ).catch(err => console.error('Error updating cache hit count:', err));
      
      console.log('✅ Using cached response from database (no API call)');
      return cached.response;
    }
  } catch (error) {
    console.error('❌ Error loading cache from database:', error);
  }
  
  return null;
};

/**
 * ✅ SỬA: Lưu response vào database (không dùng RAM)
 * @param {string} userMessage - User message
 * @param {object} response - AI response
 */
const setCachedResponse = async (userMessage, response) => {
  const cacheKey = normalizeCacheKey(userMessage);
  
  // Chỉ cache nếu response hợp lệ
  if (response && response.text) {
    try {
      const ResponseCache = (await import('../Models/ResponseCacheModel.js')).default;
      
      await ResponseCache.findOneAndUpdate(
        { queryKey: cacheKey },
        {
          queryKey: cacheKey,
          queryText: userMessage,
          response: response,
          $inc: { hitCount: 0 }, // Không tăng nếu mới tạo
          lastUsed: new Date()
        },
        { upsert: true, new: true }
      );
      
      console.log(`💾 Saved cache to database: ${cacheKey}`);
    } catch (error) {
      console.error('❌ Error saving cache to database:', error);
    }
  }
};

/**
 * ✅ SỬA: Clear cache từ database (cho testing hoặc khi cần)
 */
const clearResponseCache = async () => {
  try {
    const ResponseCache = (await import('../Models/ResponseCacheModel.js')).default;
    await ResponseCache.deleteMany({});
    console.log('🗑️  Response cache cleared from database');
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
  }
};

/**
 * ✅ SỬA: Get cache stats từ database
 */
const getCacheStats = async () => {
  try {
    const ResponseCache = (await import('../Models/ResponseCacheModel.js')).default;
    const count = await ResponseCache.countDocuments();
    return {
      size: count,
      maxSize: 'unlimited' // Database không giới hạn như RAM
    };
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    return { size: 0, maxSize: 'unlimited' };
  }
};

/**
 * ✅ THÊM: Cleanup cache cũ (xóa cache không dùng > 30 ngày hoặc giới hạn 1000 entries)
 */
const cleanupOldCache = async () => {
  try {
    const ResponseCache = (await import('../Models/ResponseCacheModel.js')).default;
    
    // Xóa cache không dùng > 30 ngày
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const deletedOld = await ResponseCache.deleteMany({
      lastUsed: { $lt: thirtyDaysAgo }
    });
    
    // Giới hạn số lượng cache (giữ 1000 entries mới nhất)
    const count = await ResponseCache.countDocuments();
    if (count > 1000) {
      const oldest = await ResponseCache.find()
        .sort({ lastUsed: 1 })
        .limit(count - 1000)
        .select('_id');
      
      const ids = oldest.map(item => item._id);
      const deletedLimit = await ResponseCache.deleteMany({ _id: { $in: ids } });
      
      console.log(`🗑️  Cleaned up ${deletedLimit.deletedCount} oldest cache entries (kept 1000 most recent)`);
    }
    
    if (deletedOld.deletedCount > 0) {
      console.log(`🗑️  Cleaned up ${deletedOld.deletedCount} cache entries older than 30 days`);
    }
    
    return {
      deletedOld: deletedOld.deletedCount,
      deletedLimit: count > 1000 ? count - 1000 : 0
    };
  } catch (error) {
    console.error('❌ Error cleaning up old cache:', error);
    return { deletedOld: 0, deletedLimit: 0 };
  }
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
 * 
 * ⚠️ NOTE: Một số pattern đã được tạm thời disable để test AI:
 * - Pattern 2.3 (conversation pattern)
 * - Pattern 6.4 (explore pattern)
 * - Rule-based responses
 * TODO: Re-enable sau khi test AI xong
 */
const getPatternBasedResponse = async (userMessage, context = {}) => {
  const lower = userMessage.toLowerCase().trim();
  
  // ✅ QUAN TRỌNG: Nếu user nói "chốt phòng đó" và đã có selectedRoom, KHÔNG tìm phòng mới
  // Skip pattern-based response để xử lý confirm_room_selection ở phần sau
  const isConfirmingSelectedRoom = lower.includes("chốt phòng") || 
    lower.includes("đặt phòng đó") || 
    lower.includes("đặt phòng này") ||
    (lower.includes("phòng đó") && (lower.includes("chốt") || lower.includes("đặt"))) ||
    (lower.includes("phòng này") && (lower.includes("chốt") || lower.includes("đặt")));
  
  const hasSelectedRoom = !!(context.selectedRoom && (context.selectedRoom._id || context.selectedRoom.id));
  const hasBookingContextRoomId = !!(context.bookingContext && context.bookingContext.roomId);
  
  if (isConfirmingSelectedRoom && (hasSelectedRoom || hasBookingContextRoomId)) {
    console.log('✅ Skipping pattern-based response - user confirming selected room');
    return null; // Return null để fallback sang AI xử lý confirm_room_selection
  }
  
  // Lấy booking context để kiểm tra hasDates và hasGuests
  const bookingContext = context.bookingContext || {};
  const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
  const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
  const hasRoomList = context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0;
  const pendingChangeDateChoice = bookingContext.pendingChangeDateChoice || false;
  const changeDateScope = bookingContext.changeDateScope || null;

  // ✅ Load hotel config (dữ liệu thật) - không tốn Gemini
  let hotelInfo = null;
  try {
    hotelInfo = await getHotelConfig();
  } catch (err) {
    console.warn("⚠️  Cannot load hotelInfo config:", err.message);
  }
  const hotline = hotelInfo?.contact?.hotline || "0901 234 567";
  const matchKeywords = (keywords = []) => keywords.some(k => lower.includes(k));
  
  // Nhận diện ý định đổi ngày (dùng chung cho pattern-based)
  const isChangeDateIntent = [
    "đổi ngày", "đổi lịch", "thay đổi ngày", "thay đổi lịch",
    "đi ngày khác", "ngày khác", "đổi ngày nhận", "đổi ngày trả",
    "đổi checkin", "đổi checkout", "dời ngày", "dời lịch", "reschedule",
    "change date", "change dates", "change booking date",
    "change check-in", "change checkin", "change check out", "update date", "move date"
  ].some(k => lower.includes(k));
  const formatService = (svc) => {
    if (!svc?.enabled) return null;
    const hours = svc.hours ? `Mở cửa: ${svc.hours}.` : "";
    const price = svc.priceRange ? `Giá tham khảo: ${svc.priceRange}.` : "";
    const notes = svc.notes ? `Lưu ý: ${svc.notes}.` : "";
    return [hours, price, notes].filter(Boolean).join(" ");
  };
  const serviceReply = (key) => {
    const svc = getService(hotelInfo, key);
    const text = formatService(svc);
    if (text) return { text: `${key}: ${text}`, rooms: null, hasRooms: false };
    if (svc && svc.enabled === false) return { text: `Hiện chưa cung cấp ${key}. Vui lòng liên hệ hotline ${hotline}.`, rooms: null, hasRooms: false };
    return { text: hotelInfo?.disclaimers?.updating || `Thông tin đang cập nhật, vui lòng liên hệ hotline ${hotline}.`, rooms: null, hasRooms: false };
  };
  
  const wantsCurrentRoomChange =
    /đổi.*(phòng này|phòng đang xem|giữ phòng)/i.test(lower) ||
    lower.includes("đổi ngày phòng này") ||
    lower.includes("giữ phòng này") ||
    lower.includes("keep this room");

  const wantsAllRoomsChange =
    /(xem tất cả|xem hết|all room|all rooms|tất cả phòng|phòng khác)/i.test(lower);

  // ✅ PRIORITY: Nếu đang chờ chọn phạm vi đổi ngày, xử lý trước mọi intent khác
  if (pendingChangeDateChoice) {
    if (wantsCurrentRoomChange) {
      bookingContext.changeDateScope = "CURRENT_ROOM";
      bookingContext.pendingChangeDateChoice = false;
      context.bookingContext = bookingContext;
      const hasDatesNow = bookingContext.checkInDate && bookingContext.checkOutDate;
      return {
        text: hasDatesNow
          ? 'Bạn chọn đổi ngày cho phòng đang xem. Mình sẽ kiểm tra phòng này với ngày mới, vui lòng đợi một chút.'
          : 'Bạn chọn đổi ngày cho phòng đang xem. Vui lòng cung cấp ngày nhận/trả mới (dd/mm/yyyy) để mình kiểm tra phòng này còn trống không. Nếu cần phòng khác, gõ "xem tất cả phòng trống".',
        rooms: context.selectedRoom ? [context.selectedRoom] : null,
        hasRooms: !!context.selectedRoom,
        bookingContext: context.bookingContext
      };
    }
    if (wantsAllRoomsChange) {
      bookingContext.changeDateScope = "ALL_ROOMS";
      bookingContext.pendingChangeDateChoice = false;
      // Clear chọn phòng để tìm mới
      context.selectedRoom = null;
      delete bookingContext.roomId;
      delete bookingContext.roomName;
      context.bookingContext = bookingContext;

      const hasDatesNow = bookingContext.checkInDate && bookingContext.checkOutDate;
      const guestsNow = bookingContext.guests || bookingContext.maxOccupancy;

      if (hasDatesNow) {
        // Tìm phòng ngay với ngày đã có
        const criteria = {
          checkInDate: bookingContext.checkInDate,
          checkOutDate: bookingContext.checkOutDate,
          maxOccupancy: guestsNow,
          isAvailable: true,
          status: 'active'
        };

        const roomsFound = await searchRooms(criteria);
        if (roomsFound && roomsFound.length > 0) {
          // Map phòng tìm được
          const mappedRooms = roomsFound.map(r => ({
            ...r.toObject ? r.toObject() : r,
            id: r._id?.toString?.() || r.id || r._id,
            pricePerNight: r.pricePerNight ?? 0,
            image: r.image || r.thumbnailUrl || null,
            thumbnailUrl: r.thumbnailUrl || r.image || null,
            amenities: Array.isArray(r.amenities) ? r.amenities : [],
          }));

          // Lưu lastRoomSearchResults để user có thể chọn phòng số X
          context.lastRoomSearchResults = mappedRooms;

          return {
            text: 'Danh sách phòng trống cho ngày mới. Bạn chọn phòng bằng cách gõ số thứ tự hoặc tên phòng nhé.',
            rooms: mappedRooms,
            hasRooms: true,
            bookingContext: context.bookingContext
          };
        }

        return {
          text: 'Hiện chưa tìm thấy phòng trống cho khoảng ngày này. Bạn muốn đổi ngày khác hoặc liên hệ hotline 0901 234 567 để được hỗ trợ.',
          rooms: null,
          hasRooms: false,
          bookingContext: context.bookingContext
        };
      }

      // Chưa có ngày mới → hỏi thêm
      return {
        text: 'Bạn muốn xem tất cả phòng trống theo ngày mới. Vui lòng cung cấp ngày nhận/trả (dd/mm/yyyy) và số khách để mình tìm lại danh sách phòng mới cho bạn.',
        rooms: null,
        hasRooms: false,
        bookingContext: context.bookingContext
      };
    }
    // Chưa chọn rõ → hỏi lại
    context.bookingContext = bookingContext;
    return {
      text: 'Bạn muốn đổi ngày cho phòng đang xem hay xem tất cả phòng trống theo ngày mới?\n' +
            '• Gõ "đổi ngày phòng này" để giữ phòng hiện tại và kiểm tra lại ngày mới.\n' +
            '• Gõ "xem tất cả phòng trống" để xem danh sách phòng theo ngày mới.\n\n' +
            'Vui lòng cho mình biết ngày nhận/trả mới (dd/mm/yyyy) để kiểm tra.',
      rooms: context.selectedRoom ? [context.selectedRoom] : null,
      hasRooms: !!context.selectedRoom,
      bookingContext: context.bookingContext
    };
  }

  // ✅ PRIORITY: Nếu user muốn xem tiện ích/dịch vụ của phòng đã chọn, load từ DB và trả về thông tin thật
  const breakfastKeywords = ["buffet sáng", "ăn sáng", "breakfast"];
  const shuttleKeywords = ["đưa đón", "đưa rước", "airport", "sân bay", "shuttle", "đón tiễn"];
  const matchesAny = (arr) => arr.some(k => lower.includes(k));

  const isViewRoomAmenitiesIntent = (
    (lower.includes("tiện ích") || lower.includes("amenities") || lower.includes("dịch vụ")) &&
    (lower.includes("phòng này") || lower.includes("phòng đó") || lower.includes("phòng đã chọn") || hasSelectedRoom)
  ) || (
    lower.includes("tiện ích phòng") ||
    lower.includes("dịch vụ phòng") ||
    lower.includes("phòng này có gì") ||
    lower.includes("phòng đó có gì") ||
    (lower.includes("xem") && lower.includes("chi tiết") && (lower.includes("phòng này") || lower.includes("phòng đó") || hasSelectedRoom)) ||
    ((hasSelectedRoom || lower.includes("phòng")) && (matchesAny(breakfastKeywords) || matchesAny(shuttleKeywords)))
  );

  if (isViewRoomAmenitiesIntent && hasSelectedRoom) {
    // ✅ QUAN TRỌNG: Khi hỏi về dịch vụ/tiện ích phòng, không hiển thị thông báo đặt phòng thành công
    // Reset bookingCreated để tránh hiển thị thông báo đặt phòng khi chỉ hỏi thông tin
    if (bookingContext) {
      bookingContext.bookingCreated = false;
      delete bookingContext.bookingId;
    }
    
    // ✅ SINGLE SOURCE OF TRUTH: LUÔN dùng context.selectedRoom
    const selectedRoom = context.selectedRoom;
    
    // ✅ DEFENSIVE VALIDATION: Đảm bảo selectedRoom tồn tại
    if (!selectedRoom) {
      console.warn('⚠️ isViewRoomAmenitiesIntent: context.selectedRoom is null/undefined');
      return {
        text: 'Xin lỗi, mình chưa xác định được phòng bạn đang xem. Vui lòng chọn phòng trước khi hỏi về tiện ích.',
        rooms: null,
        hasRooms: false,
        bookingContext: context.bookingContext
      };
    }
    
    const roomId = selectedRoom._id || selectedRoom.id || bookingContext.roomId;
    
    // ✅ DEFENSIVE LOGGING: Log việc fetch amenities
    console.log('🔍 Fetching room amenities:', {
      intent: 'view_room_amenities',
      selectedRoomId: roomId,
      selectedRoomName: selectedRoom.name,
      hasRoomId: !!roomId,
      source: 'context.selectedRoom',
      bookingContextRoomId: bookingContext.roomId,
      matches: roomId === bookingContext.roomId
    });
    
    if (roomId) {
      try {
        // ✅ Load thông tin phòng từ database để lấy amenities thật
        // Populate includedServices để lấy thông tin Service nếu là ObjectId reference
        // Không dùng .lean() ngay để populate hoạt động đúng
        let dbRoom = await Room.findById(roomId).populate('includedServices', 'name category');
        
        // Convert sang plain object sau khi populate
        if (dbRoom) {
          dbRoom = dbRoom.toObject ? dbRoom.toObject() : dbRoom;
        }
        
        // ✅ LOG để debug dữ liệu thật từ database
        console.log('🔍 Raw room data from DB:', {
          roomId: roomId,
          roomName: dbRoom?.name,
          hasIncludedServices: !!dbRoom?.includedServices,
          includedServicesType: Array.isArray(dbRoom?.includedServices) ? 'array' : typeof dbRoom?.includedServices,
          includedServicesLength: Array.isArray(dbRoom?.includedServices) ? dbRoom.includedServices.length : 0,
          includedServicesSample: Array.isArray(dbRoom?.includedServices) && dbRoom.includedServices.length > 0 ? dbRoom.includedServices[0] : null,
          hasPaidServices: !!dbRoom?.paidServices,
          paidServicesType: Array.isArray(dbRoom?.paidServices) ? 'array' : typeof dbRoom?.paidServices,
          paidServicesLength: Array.isArray(dbRoom?.paidServices) ? dbRoom.paidServices.length : 0,
          paidServicesSample: Array.isArray(dbRoom?.paidServices) && dbRoom.paidServices.length > 0 ? dbRoom.paidServices[0] : null
        });
        
        if (dbRoom) {
          const amenities = dbRoom.amenities || [];
          const amenitiesText = amenities.length > 0 
            ? amenities.map((a, idx) => `${idx + 1}. ${a}`).join('\n')
            : 'Đang cập nhật thông tin tiện ích.';
          
          // ✅ DEFENSIVE LOGGING: Log kết quả fetch amenities
          console.log('✅ Fetched room amenities from DB:', {
            roomId: roomId,
            roomName: dbRoom.name,
            amenitiesCount: amenities.length,
            matchesSelectedRoom: dbRoom._id.toString() === (selectedRoom._id || selectedRoom.id)
          });
          
          // ✅ QUAN TRỌNG: Cập nhật lại context.selectedRoom với thông tin đầy đủ từ DB
          // Đảm bảo selectedRoom luôn có thông tin mới nhất, không bị mất khi user chọn phòng mới
          const updatedSelectedRoom = {
            _id: dbRoom._id.toString(),
            id: dbRoom._id.toString(),
            name: dbRoom.name,
            pricePerNight: dbRoom.pricePerNight,
            roomType: dbRoom.roomType,
            maxOccupancy: dbRoom.maxOccupancy,
            view: dbRoom.view || 'N/A',
            image: dbRoom.image || dbRoom.thumbnailUrl || null,
            thumbnailUrl: dbRoom.thumbnailUrl || dbRoom.image || null,
            amenities: Array.isArray(dbRoom.amenities) ? dbRoom.amenities : []
          };
          
          // ✅ Cập nhật context.selectedRoom với thông tin đầy đủ
          context.selectedRoom = updatedSelectedRoom;
          
          // ✅ Cập nhật bookingContext với thông tin phòng
          if (context.bookingContext) {
            context.bookingContext.roomId = updatedSelectedRoom._id;
            context.bookingContext.roomName = updatedSelectedRoom.name;
            context.bookingContext.roomPrice = updatedSelectedRoom.pricePerNight;
          }
          
          console.log('✅ Updated context.selectedRoom with full DB data (amenities response):', {
            roomId: updatedSelectedRoom._id,
            roomName: updatedSelectedRoom.name,
            amenitiesCount: updatedSelectedRoom.amenities.length
          });

          // ✅ Trả lời dịch vụ cụ thể theo PHÒNG - CHỈ lấy từ database, không fallback hotelInfo
          // Xử lý includedServices: có thể là array of String hoặc array of ObjectId (populated Service)
          let included = [];
          if (Array.isArray(dbRoom.includedServices) && dbRoom.includedServices.length > 0) {
            included = dbRoom.includedServices.map(item => {
              // Nếu là populated Service object, lấy name và map sang key
              if (item && typeof item === 'object' && item.name) {
                const serviceName = item.name;
                // Map Service name sang key để hiển thị đúng
                const nameToKeyMap = {
                  'Buffet sáng': 'breakfast',
                  'Phòng gym': 'gym',
                  'Phòng gym (miễn phí)': 'gym',
                  'Gym': 'gym',
                  'Bãi đỗ xe': 'parking',
                  'Parking': 'parking',
                  'WiFi': 'wifi',
                  'Đưa đón sân bay': 'airportPickup',
                  'Airport Pickup': 'airportPickup',
                  'Hồ bơi': 'pool',
                  'Pool': 'pool',
                  'Spa': 'spa',
                  'Nhà hàng buffet sáng': 'breakfast',
                  'Nhà hàng': 'breakfast'
                };
                
                // Tìm key từ map
                let key = nameToKeyMap[serviceName];
                
                // Nếu không tìm thấy, thử tìm theo pattern
                if (!key) {
                  const lowerName = serviceName.toLowerCase();
                  if (lowerName.includes('gym') || lowerName.includes('phòng gym')) {
                    key = 'gym';
                  } else if (lowerName.includes('buffet') || lowerName.includes('sáng') || lowerName.includes('nhà hàng')) {
                    key = 'breakfast';
                  } else if (lowerName.includes('parking') || lowerName.includes('đỗ xe') || lowerName.includes('bãi đỗ')) {
                    key = 'parking';
                  } else if (lowerName.includes('wifi')) {
                    key = 'wifi';
                  } else if (lowerName.includes('airport') || lowerName.includes('sân bay') || lowerName.includes('đưa đón')) {
                    key = 'airportPickup';
                  } else if (lowerName.includes('pool') || lowerName.includes('hồ bơi')) {
                    key = 'pool';
                  } else if (lowerName.includes('spa')) {
                    key = 'spa';
                  }
                }
                
                return key || serviceName; // Trả về key nếu có, nếu không thì trả về tên gốc
              }
              // Nếu là String, dùng trực tiếp
              if (typeof item === 'string') {
                // Nếu là ObjectId string (24 ký tự hex), bỏ qua
                if (/^[0-9a-fA-F]{24}$/.test(item)) {
                  return null;
                }
                return item;
              }
              // Nếu là ObjectId (chưa populate), bỏ qua vì không có tên
              return null;
            }).filter(Boolean);
          }
          
          // Xử lý paidServices: luôn là array of objects với {key, priceNote, notes}
          const paid = Array.isArray(dbRoom.paidServices) ? dbRoom.paidServices : [];
          
          // ✅ LOG để debug
          console.log('🔍 Room services from DB:', {
            roomId: roomId,
            roomName: dbRoom.name,
            includedServices: included,
            includedCount: included.length,
            paidServices: paid,
            paidCount: paid.length
          });
          const hasIncluded = (key) => included.includes(key);
          const findPaid = (key) => paid.find(p => p?.key === key);
          const serviceCfg = hotelInfo?.services || {};
          const matchesKeywords = (keywords) => keywords.some(k => lower.includes(k));

          const breakfastKeywords = ["buffet sáng", "ăn sáng", "breakfast", "suất sáng"];
          const shuttleKeywords = ["đưa đón", "đưa rước", "airport", "sân bay", "shuttle", "đón tiễn"];

          // ✅ PHÂN BIỆT: "dịch vụ" vs "tiện ích/chi tiết"
          const isServiceOnlyQuery = lower.includes("dịch vụ") && !lower.includes("tiện ích") && !lower.includes("chi tiết");
          const isAmenitiesQuery = lower.includes("tiện ích") || lower.includes("amenities");
          const isFullDetailsQuery = lower.includes("phòng này có gì") || lower.includes("phòng đó có gì") || (lower.includes("xem") && lower.includes("chi tiết"));
          const isServiceWithAmenitiesQuery = (lower.includes("dịch vụ") && lower.includes("tiện ích")) || (lower.includes("dịch vụ") && lower.includes("tiện nghi"));

          // Buffet sáng theo phòng
          if (matchesKeywords(breakfastKeywords)) {
            const hotelBf = serviceCfg.restaurant || {};
            const hotelBfNote = hotelInfo?.localInfo?.breakfast || hotelBf.notes || hotelBf.priceRange || '';
            const paidBreakfast = findPaid('breakfast');

            if (hasIncluded('breakfast')) {
              return {
                text: `Phòng này **đã bao gồm buffet sáng miễn phí**${hotelBfNote ? ` (${hotelBfNote})` : ""}.`,
                rooms: null,
                hasRooms: false
              };
            }

            if (paidBreakfast || hotelBf?.enabled) {
              const price = paidBreakfast?.priceNote || hotelBf?.priceRange;
              return {
                text: `Phòng này **chưa bao gồm buffet sáng**. Bạn có thể mua thêm${price ? ` với giá ${price}` : ""}${hotelBfNote && !price ? ` (${hotelBfNote})` : ""}.`,
                rooms: null,
                hasRooms: false
              };
            }

            return {
              text: `Hiện chưa có thông tin buffet sáng cho phòng này. Vui lòng liên hệ lễ tân để được hỗ trợ thêm.`,
              rooms: null,
              hasRooms: false
            };
          }

          // Đưa đón sân bay theo phòng
          if (matchesKeywords(shuttleKeywords)) {
            const hotelShuttle = serviceCfg.airportPickup || {};
            const paidShuttle = findPaid('airportPickup');

            if (hasIncluded('airportPickup')) {
              return {
                text: `Phòng này **đã bao gồm dịch vụ đưa đón sân bay miễn phí**. Vui lòng cho mình biết giờ/điểm đón để đặt xe.`,
                rooms: null,
                hasRooms: false
              };
            }

            if (paidShuttle || hotelShuttle?.enabled) {
              const price = paidShuttle?.priceNote || hotelShuttle?.priceRange;
              const note = paidShuttle?.notes || hotelShuttle?.notes;
              return {
                text: `Phòng này **chưa bao gồm đưa đón sân bay**. Bạn có thể đặt thêm${price ? ` với giá ${price}` : ""}${note ? ` (${note})` : ""}.`,
                rooms: null,
                hasRooms: false
              };
            }

            return {
              text: `Hiện chưa có dịch vụ đưa đón sân bay cho phòng này. Vui lòng liên hệ lễ tân để được hỗ trợ thêm.`,
              rooms: null,
              hasRooms: false
            };
          }

          // ✅ CHỈ TRẢ VỀ DỊCH VỤ (includedServices + paidServices) khi hỏi "dịch vụ"
          if (isServiceOnlyQuery) {
            const serviceTexts = [];
            
            // Dịch vụ miễn phí (included) - CHỈ lấy từ database
            if (included.length > 0) {
              const serviceNames = {
                'breakfast': 'Buffet sáng',
                'gym': 'Phòng gym',
                'parking': 'Bãi đỗ xe',
                'wifi': 'WiFi',
                'airportPickup': 'Đưa đón sân bay',
                'pool': 'Hồ bơi',
                'spa': 'Spa'
              };
              const includedList = included.map(key => {
                // Xử lý cả ObjectId string và String key
                const keyStr = typeof key === 'string' ? key : (key?.toString?.() || String(key));
                // Nếu là ObjectId string (24 ký tự hex), bỏ qua vì không có tên dịch vụ
                if (/^[0-9a-fA-F]{24}$/.test(keyStr)) {
                  console.warn(`⚠️ Included service is ObjectId without populate: ${keyStr}`);
                  return null; // Bỏ qua ObjectId không có tên
                }
                const name = serviceNames[keyStr] || keyStr;
                return `• ${name} (miễn phí)`;
              }).filter(Boolean); // Loại bỏ null
              
              if (includedList.length > 0) {
                serviceTexts.push(`**Dịch vụ miễn phí:**\n${includedList.join('\n')}`);
              } else {
                serviceTexts.push(`**Dịch vụ miễn phí:**\n• Phòng này chưa có thông tin dịch vụ miễn phí cụ thể.`);
              }
            } else {
              serviceTexts.push(`**Dịch vụ miễn phí:**\n• Phòng này chưa có thông tin dịch vụ miễn phí cụ thể.`);
            }
            
            // Dịch vụ có phí (paid) - CHỈ lấy từ database
            if (paid.length > 0) {
              const paidList = paid
                .filter(p => p && p.key) // Chỉ lấy các item có key hợp lệ
                .map(p => {
                  const serviceNames = {
                    'breakfast': 'Buffet sáng',
                    'airportPickup': 'Đưa đón sân bay',
                    'spa': 'Spa & Massage',
                    'laundry': 'Giặt ủi',
                    'extraBed': 'Giường phụ'
                  };
                  const name = serviceNames[p.key] || p.key || 'Dịch vụ';
                  const price = p.priceNote ? ` (${p.priceNote})` : '';
                  const note = p.notes ? ` - ${p.notes}` : '';
                  return `• ${name}${price}${note}`;
                });
              
              if (paidList.length > 0) {
                serviceTexts.push(`\n**Dịch vụ có phí:**\n${paidList.join('\n')}`);
              } else {
                serviceTexts.push(`\n**Dịch vụ có phí:**\n• Phòng này chưa có thông tin dịch vụ có phí cụ thể.`);
              }
            } else {
              serviceTexts.push(`\n**Dịch vụ có phí:**\n• Phòng này chưa có thông tin dịch vụ có phí cụ thể.`);
            }
            
            // ✅ Nếu không có dịch vụ nào, thông báo rõ ràng
            if (included.length === 0 && paid.length === 0) {
              return {
                text: `**Dịch vụ của ${dbRoom.name || selectedRoom.name}:**\n\nPhòng này hiện chưa có thông tin dịch vụ cụ thể trong hệ thống.\n\n💡 Để biết thêm về các dịch vụ khách sạn, vui lòng liên hệ hotline ${hotline} hoặc hỏi về dịch vụ chung của khách sạn.`,
                rooms: null,
                hasRooms: false
              };
            }
            
            return {
              text: `**Dịch vụ của ${dbRoom.name || selectedRoom.name}:**\n\n${serviceTexts.join('\n')}\n\n💡 Bạn có thể đặt thêm dịch vụ khi check-in hoặc liên hệ hotline ${hotline} để đặt trước.`,
              rooms: null,
              hasRooms: false
            };
          }

          // ✅ TRẢ VỀ ĐẦY ĐỦ (amenities + services) khi hỏi "tiện ích" hoặc "chi tiết" hoặc "dịch vụ kèm tiện nghi"
          if (isAmenitiesQuery || isFullDetailsQuery || isServiceWithAmenitiesQuery) {
            const roomInfo = `**${dbRoom.name || selectedRoom.name}**\n\n` +
              `• **Loại phòng:** ${dbRoom.roomType || 'N/A'}\n` +
              `• **Sức chứa:** ${dbRoom.maxOccupancy || 'N/A'} người\n` +
              `• **Diện tích:** ${dbRoom.size || 'N/A'} m²\n` +
              `• **Loại giường:** ${dbRoom.bedType || 'N/A'}\n` +
              (dbRoom.view ? `• **Hướng phòng:** ${dbRoom.view}\n` : '') +
              `• **Giá/đêm:** ${dbRoom.pricePerNight?.toLocaleString('vi-VN') || 'Đang cập nhật'} VNĐ\n\n` +
              `**Tiện ích của phòng:**\n${amenitiesText}`;
            
            // Thêm dịch vụ nếu hỏi "dịch vụ kèm tiện nghi"
            if (isServiceWithAmenitiesQuery) {
              const serviceTexts = [];
              if (included.length > 0) {
                const serviceNames = {
                  'breakfast': 'Buffet sáng',
                  'gym': 'Phòng gym',
                  'parking': 'Bãi đỗ xe',
                  'wifi': 'WiFi',
                  'airportPickup': 'Đưa đón sân bay',
                  'pool': 'Hồ bơi',
                  'spa': 'Spa'
                };
                const includedList = included.map(key => {
                  const name = serviceNames[key] || key;
                  return `• ${name} (miễn phí)`;
                });
                serviceTexts.push(`\n**Dịch vụ miễn phí:**\n${includedList.join('\n')}`);
              }
              if (paid.length > 0) {
                const paidList = paid.map(p => {
                  const serviceNames = {
                    'breakfast': 'Buffet sáng',
                    'airportPickup': 'Đưa đón sân bay',
                    'spa': 'Spa & Massage',
                    'laundry': 'Giặt ủi',
                    'extraBed': 'Giường phụ'
                  };
                  const name = serviceNames[p?.key] || p?.key || 'Dịch vụ';
                  const price = p?.priceNote ? ` (${p.priceNote})` : '';
                  const note = p?.notes ? ` - ${p.notes}` : '';
                  return `• ${name}${price}${note}`;
                });
                serviceTexts.push(`\n**Dịch vụ có phí:**\n${paidList.join('\n')}`);
              }
              roomInfo += serviceTexts.join('\n');
            }
            
            roomInfo += (dbRoom.description ? `\n\n**Mô tả:**\n${dbRoom.description}` : '');
            
            // Tạo roomDetailLink
            const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const roomDetailLink = `${baseUrl}/rooms/${roomId}`;
            
            return {
              text: roomInfo + `\n\n👉 Nhấn vào [Xem chi tiết đầy đủ](${roomDetailLink}) để xem thêm hình ảnh và mô tả chi tiết.`,
              rooms: [updatedSelectedRoom], // ✅ Trả về updatedSelectedRoom thay vì selectedRoom cũ
              hasRooms: true,
              roomDetailLink: roomDetailLink,
              bookingContext: context.bookingContext
            };
          }
          
          // ✅ FALLBACK: Nếu không match gì cả, trả về chi tiết đầy đủ (giữ nguyên logic cũ)
          const roomInfo = `**${dbRoom.name || selectedRoom.name}**\n\n` +
            `• **Loại phòng:** ${dbRoom.roomType || 'N/A'}\n` +
            `• **Sức chứa:** ${dbRoom.maxOccupancy || 'N/A'} người\n` +
            `• **Diện tích:** ${dbRoom.size || 'N/A'} m²\n` +
            `• **Loại giường:** ${dbRoom.bedType || 'N/A'}\n` +
            (dbRoom.view ? `• **Hướng phòng:** ${dbRoom.view}\n` : '') +
            `• **Giá/đêm:** ${dbRoom.pricePerNight?.toLocaleString('vi-VN') || 'Đang cập nhật'} VNĐ\n\n` +
            `**Tiện ích của phòng:**\n${amenitiesText}` +
            (dbRoom.description ? `\n\n**Mô tả:**\n${dbRoom.description}` : '');
          
          // Tạo roomDetailLink
          const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
          const roomDetailLink = `${baseUrl}/rooms/${roomId}`;
          
          return {
            text: roomInfo + `\n\n👉 Nhấn vào [Xem chi tiết đầy đủ](${roomDetailLink}) để xem thêm hình ảnh và mô tả chi tiết.`,
            rooms: [updatedSelectedRoom], // ✅ Trả về updatedSelectedRoom thay vì selectedRoom cũ
            hasRooms: true,
            roomDetailLink: roomDetailLink,
            bookingContext: context.bookingContext
          };
        } else {
          console.warn('⚠️ Room not found in DB:', roomId);
        }
      } catch (error) {
        console.error('❌ Error loading room amenities from DB:', error);
        // Fallback: trả về thông tin từ selectedRoom nếu có
        const amenities = selectedRoom.amenities || [];
        const amenitiesText = amenities.length > 0 
          ? amenities.map((a, idx) => `${idx + 1}. ${a}`).join('\n')
          : 'Đang cập nhật thông tin tiện ích.';
        
        return {
          text: `**${selectedRoom.name || 'Phòng bạn đã chọn'}**\n\n**Tiện ích của phòng:**\n${amenitiesText}\n\nVui lòng liên hệ hotline ${hotline} để biết thêm chi tiết.`,
          rooms: [selectedRoom],
          hasRooms: true,
          bookingContext: context.bookingContext
        };
      }
    } else {
      console.warn('⚠️ No roomId found for amenities query');
      return {
        text: 'Xin lỗi, mình không tìm thấy thông tin phòng. Vui lòng chọn phòng lại.',
        rooms: null,
        hasRooms: false,
        bookingContext: context.bookingContext
      };
    }
  }

  // ✅ Nếu user nói đổi ngày
  if (isChangeDateIntent) {
    // Trường hợp user nói rõ "đặt phòng khác vào ngày khác" → hiểu là muốn list mới, không hỏi 2 lựa chọn
    const wantsOtherRoomAndDate =
      (lower.includes("phòng khác") || lower.includes("đặt phòng khác")) &&
      (lower.includes("ngày khác") || lower.includes("đổi ngày"));

    if (wantsOtherRoomAndDate) {
      // Xoá selectedRoom và roomId để tìm mới hoàn toàn
      context.selectedRoom = null;
      delete bookingContext.roomId;
      delete bookingContext.roomName;
      // Xoá ngày cũ để buộc nhập ngày mới
      delete bookingContext.checkInDate;
      delete bookingContext.checkOutDate;
      // Xoá list phòng cũ trong context để không fallback
      delete context.lastRoomSearchResults;
      context.bookingContext = bookingContext;
      return {
        text: 'Mình hiểu là bạn muốn đặt **phòng khác vào ngày khác**.\nVui lòng nhập ngày nhận phòng, ngày trả phòng mới và số khách, mình sẽ tìm danh sách phòng phù hợp cho bạn nhé.',
        rooms: null,
        hasRooms: false,
        bookingContext: context.bookingContext
      };
    }

    // Mặc định: hỏi user muốn đổi ngày cho phòng đang xem hay xem tất cả phòng trống
    delete bookingContext.changeDateScope;
    bookingContext.pendingChangeDateChoice = true;
    context.bookingContext = bookingContext;
    const roomsForCard = context.selectedRoom ? [context.selectedRoom] : null;
    const hasRoomsCard = !!roomsForCard;
    return {
      text: 'Bạn muốn đổi ngày cho phòng đang xem hay xem tất cả phòng trống theo ngày mới?\n' +
            '• Gõ "đổi ngày phòng này" để giữ phòng hiện tại và kiểm tra lại ngày mới.\n' +
            '• Gõ "xem tất cả phòng trống" để xem danh sách phòng theo ngày mới.\n\n' +
            (hasRoomsCard
              ? 'Phòng đang xem được giữ bên dưới, bạn xác nhận lựa chọn và cung cấp ngày mới giúp mình nhé.'
              : 'Nếu bạn muốn đổi ngày cho một phòng cụ thể, hãy chọn phòng trong danh sách đã hiển thị trước đó hoặc gõ "xem tất cả phòng trống" để xem lại danh sách. Vui lòng cho mình biết ngày nhận/trả mới để kiểm tra.'),
      rooms: roomsForCard,
      hasRooms: hasRoomsCard,
      bookingContext: context.bookingContext
    };
  }

  // ✅ Pattern 0: "Tôi muốn đặt phòng từ ngày X đến Y cho Z người" → Tự động parse và tìm phòng
  // Pattern này phải được check TRƯỚC Pattern 1 để tránh yêu cầu lại thông tin
  // ✅ SỬA: Pattern regex linh hoạt hơn để match với nhiều format
  const fullBookingPattern = lower.match(/(?:tôi|i|muốn|want|đặt|book).*?(?:phòng|room).*?(?:từ|from).*?(?:ngày\s*)?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow).*?(?:đến|to|-).*?(?:ngày\s*)?(\d{1,2}\/\d{1,2}(?:\/\d{4})?|hôm nay|ngày mai|ngày kia|today|tomorrow).*?(?:cho|for).*?(\d+)\s*(?:người|people|person|guests)/i) ||
                            lower.match(/(?:tôi|i|muốn|want|đặt|book).*?(?:phòng|room).*?(?:ngày\s*)?(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*(?:đến|-|to)\s*(?:ngày\s*)?(\d{1,2}\/\d{1,2}(?:\/\d{4})?).*?(?:cho|for).*?(\d+)\s*(?:người|people|person|guests)/i) ||
                            // Pattern đơn giản hơn: "đặt phòng 25/12/2024 đến 27/12/2024 cho 2 người"
                            lower.match(/(?:đặt|book|muốn|want).*?(?:phòng|room).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*(?:đến|-|to)\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?).*?(?:cho|for).*?(\d+)\s*(?:người|people|person|guests)/i) ||
                            // ✅ THÊM: Pattern với dấu "-" thay vì "đến": "đặt phòng 25/12-27/12 cho 2 người"
                            lower.match(/(?:đặt|book|muốn|want).*?(?:phòng|room).*?(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*-\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?).*?(?:cho|for).*?(\d+)\s*(?:người|people|person|guests)/i);
  
  console.log('🔍 Pattern 0 check:', {
    userMessage: userMessage.substring(0, 100),
    lower: lower.substring(0, 100),
    matched: !!fullBookingPattern,
    matchDetails: fullBookingPattern ? {
      fullMatch: fullBookingPattern[0],
      checkIn: fullBookingPattern[1],
      checkOut: fullBookingPattern[2],
      guests: fullBookingPattern[3]
    } : null
  });
  
  if (fullBookingPattern) {
    console.log('✅ Pattern 0 matched! Full booking pattern detected');
    const checkInDate = parseDateFromText(fullBookingPattern[1]);
    const checkOutDate = parseDateFromText(fullBookingPattern[2]);
    const guests = parseInt(fullBookingPattern[3]);
    
    console.log('🔍 Parsed dates:', {
      checkInRaw: fullBookingPattern[1],
      checkOutRaw: fullBookingPattern[2],
      checkInDate: checkInDate,
      checkOutDate: checkOutDate,
      guests: guests,
      allValid: !!(checkInDate && checkOutDate && guests && guests > 0)
    });
    
    if (checkInDate && checkOutDate && guests && guests > 0) {
      // Validate dates
      if (checkInDate >= checkOutDate) {
        return {
          text: 'Ngày trả phòng phải sau ngày nhận phòng. Vui lòng kiểm tra lại! 📅',
          rooms: null,
          hasRooms: false
        };
      }
      
      // Tự động tìm phòng với thông tin đã có
      try {
        const searchCriteria = {
          maxOccupancy: guests,
          checkInDate: checkInDate,
          checkOutDate: checkOutDate
        };
        
        const rooms = await searchRooms(searchCriteria);
        
        if (rooms && rooms.length > 0) {
          // Lưu thông tin vào context
          if (!context.bookingContext) context.bookingContext = {};
          context.bookingContext.checkInDate = checkInDate;
          context.bookingContext.checkOutDate = checkOutDate;
          context.bookingContext.guests = guests;
          context.bookingContext.maxOccupancy = guests;
          context.lastRoomSearchResults = rooms;
          
          // Format dates để hiển thị
          const checkInStr = checkInDate.toLocaleDateString('vi-VN');
          const checkOutStr = checkOutDate.toLocaleDateString('vi-VN');
          const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
          
          let responseText = `Mình đã tìm được ${rooms.length} phòng phù hợp cho bạn rồi! 😊\n\n`;
          responseText += `📅 **Thông tin đặt phòng:**\n`;
          responseText += `• Check-in: ${checkInStr}\n`;
          responseText += `• Check-out: ${checkOutStr}\n`;
          responseText += `• Số đêm: ${nights} đêm\n`;
          responseText += `• Số khách: ${guests} người\n\n`;
          responseText += `Dưới đây là danh sách phòng:\n\n`;
          
          // Format rooms list
          rooms.forEach((room, index) => {
            const roomPrice = room.pricePerNight || 0;
            const totalPrice = roomPrice * nights;
            responseText += `**${index + 1}. ${room.name || 'Phòng'}**\n`;
            responseText += `- Giá: ${roomPrice.toLocaleString('vi-VN')} VNĐ/đêm\n`;
            responseText += `- Tổng: ${totalPrice.toLocaleString('vi-VN')} VNĐ (${nights} đêm)\n`;
            if (room.description) {
              responseText += `- Mô tả: ${room.description.substring(0, 100)}...\n`;
            }
            responseText += `\n`;
          });
          
          responseText += `Bạn muốn xem chi tiết phòng nào trước? Gõ số thứ tự (1, 2, 3...) hoặc tên phòng, mình sẽ hỗ trợ ngay. 🏨`;
          
          return {
            text: responseText,
            rooms: rooms,
            hasRooms: true
          };
        } else {
          return {
            text: `Rất tiếc, không tìm thấy phòng trống cho ${guests} người từ ${checkInDate.toLocaleDateString('vi-VN')} đến ${checkOutDate.toLocaleDateString('vi-VN')}.\n\n` +
                  `Vui lòng thử:\n` +
                  `- Chọn khoảng thời gian khác\n` +
                  `- Giảm số lượng khách\n` +
                  `- Hoặc liên hệ hotline: 0901 234 567 để được tư vấn\n\n` +
                  `Tôi có thể tìm phòng cho khoảng thời gian khác không? 🔍`,
            rooms: null,
            hasRooms: false
          };
        }
      } catch (error) {
        console.error('Error searching rooms:', error);
        return {
          text: 'Có lỗi xảy ra khi tìm phòng. Vui lòng thử lại hoặc liên hệ hotline: 0901 234 567. 😔',
          rooms: null,
          hasRooms: false
        };
      }
    }
  }

  // 🔄 Fallback pattern: "ngày nhận X đến Y ... người lớn ... trẻ em/bé" (thiếu từ "cho")
  const dateWithFamilyPattern = lower.match(/(?:nhận|check[-\s]?in)?\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?).*?(?:đến|-|tới)\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i);
  if (dateWithFamilyPattern) {
    const checkInDate = parseDateFromText(dateWithFamilyPattern[1]);
    const checkOutDate = parseDateFromText(dateWithFamilyPattern[2]);

    // Parse số người lớn / trẻ em từ toàn bộ câu (độc lập với regex ngày)
    // ✅ Cải thiện: Parse cả "di 2 khách", "đi 2 khách", "2 khách", "2 người"
    const adultsMatch = lower.match(/(\d+)\s*(?:người lớn|adults?)/i);
    const kidsMatch = lower.match(/(\d+)\s*(?:trẻ em|bé|children?)/i);
    const guestsMatch = lower.match(/(?:di|đi|cho|for)\s*(\d+)\s*(?:khách|người|people|guests?)/i) || 
                       lower.match(/(\d+)\s*(?:khách|người|people|guests?)/i);
    
    const adults = adultsMatch ? parseInt(adultsMatch[1]) : 0;
    const kids = kidsMatch ? parseInt(kidsMatch[1]) : 0;
    const guests = adults + kids || (guestsMatch ? parseInt(guestsMatch[1]) : 0) || adults || kids;

    console.log('🔍 Fallback family booking parse:', { 
      checkInRaw: dateWithFamilyPattern[1], 
      checkOutRaw: dateWithFamilyPattern[2], 
      adults, 
      kids, 
      guests,
      hasRequestedView: !!context.requestedView,
      requestedView: context.requestedView
    });

    if (checkInDate && checkOutDate && guests > 0) {
      if (checkInDate >= checkOutDate) {
        return {
          text: 'Ngày trả phòng phải sau ngày nhận phòng. Vui lòng kiểm tra lại! 📅',
          rooms: null,
          hasRooms: false
        };
      }

      try {
        const searchCriteria = {
          maxOccupancy: guests,
          checkInDate,
          checkOutDate
        };
        
        // ✅ QUAN TRỌNG: Nếu có context.requestedView (từ câu hỏi trước về view biển), sử dụng nó
        if (context.requestedView && !searchCriteria.view) {
          searchCriteria.view = context.requestedView;
          console.log(`✅ Using saved requestedView from context in fallback: ${context.requestedView}`);
        }
        
        const rooms = await searchRooms(searchCriteria);
        
        // ✅ Lưu requestedView vào biến tạm trước khi reset (để dùng trong response text)
        const hadRequestedView = context.requestedView;
        
        // ✅ CHỈ reset requestedView nếu đã tìm được phòng HOẶC user không muốn view biển nữa
        // Nếu không tìm được phòng với view biển, giữ lại requestedView để có thể thông báo cho user
        if (context.requestedView && rooms && rooms.length > 0) {
          console.log(`✅ Reset requestedView after fallback room search (found ${rooms.length} rooms)`);
          context.requestedView = null;
          if (context.session) {
            context.session.requestedView = null;
          }
        } else if (context.requestedView && (!rooms || rooms.length === 0)) {
          console.log(`⚠️ No rooms found with requestedView='${context.requestedView}', keeping it for user notification`);
          // Giữ lại requestedView để có thể thông báo cho user rằng không có phòng view biển
        }
        if (rooms && rooms.length > 0) {
          if (!context.bookingContext) context.bookingContext = {};
          context.bookingContext.checkInDate = checkInDate;
          context.bookingContext.checkOutDate = checkOutDate;
          context.bookingContext.guests = guests;
          context.bookingContext.maxOccupancy = guests;
          context.bookingContext.adults = adults || null;
          context.bookingContext.children = kids || null;
          context.lastRoomSearchResults = rooms;

          const checkInStr = checkInDate.toLocaleDateString('vi-VN');
          const checkOutStr = checkOutDate.toLocaleDateString('vi-VN');
          const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

          // ✅ Thêm thông tin về view nếu có requestedView (sử dụng biến tạm đã lưu)
          const viewInfo = hadRequestedView === 'biển' ? ' view biển' : '';
          let responseText = `Mình đã tìm được ${rooms.length} phòng${viewInfo} phù hợp cho ${adults || guests} người lớn${kids ? ` và ${kids} trẻ em` : ''}! 😊\n\n`;
          responseText += `📅 **Thông tin đặt phòng:**\n`;
          responseText += `• Check-in: ${checkInStr}\n`;
          responseText += `• Check-out: ${checkOutStr}\n`;
          responseText += `• Số đêm: ${nights} đêm\n`;
          responseText += `• Số khách: ${guests} người${kids ? ` (gồm ${kids} trẻ em)` : ''}\n\n`;
          responseText += `Dưới đây là danh sách phòng:\n\n`;

          rooms.forEach((room, index) => {
            const roomPrice = room.pricePerNight || 0;
            const totalPrice = roomPrice * nights;
            responseText += `**${index + 1}. ${room.name || 'Phòng'}**\n`;
            responseText += `- Giá: ${roomPrice.toLocaleString('vi-VN')} VNĐ/đêm\n`;
            responseText += `- Tổng: ${totalPrice.toLocaleString('vi-VN')} VNĐ (${nights} đêm)\n`;
            if (room.description) {
              responseText += `- Mô tả: ${room.description.substring(0, 100)}...\n`;
            }
            responseText += `\n`;
          });

          responseText += `Bạn muốn xem chi tiết phòng nào trước? Gõ số thứ tự (1, 2, 3...) hoặc tên phòng, mình sẽ hỗ trợ ngay. 🏨`;

          return {
            text: responseText,
            rooms,
            hasRooms: true
          };
        } else if (context.requestedView === 'biển') {
          // ✅ Xử lý khi không tìm được phòng view biển
          const checkInStr = checkInDate.toLocaleDateString('vi-VN');
          const checkOutStr = checkOutDate.toLocaleDateString('vi-VN');
          return {
            text: `Hiện tại không còn phòng view biển trống từ ${checkInStr} đến ${checkOutStr} cho ${guests} người.\n\n` +
                  `Bạn muốn mình:\n` +
                  `• Tìm phòng view khác (thành phố, núi)?\n` +
                  `• Tìm phòng không yêu cầu view cụ thể?\n` +
                  `• Hoặc thử ngày khác?`,
            rooms: null,
            hasRooms: false
          };
        }
      } catch (error) {
        console.error('Error searching rooms (family fallback):', error);
      }
    }
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern dịch vụ/policy dùng dữ liệu thật từ config
  // TODO: Re-enable after AI/RAG testing
  // Chỉ disable phần serviceMap loop, giữ lại các policy khác vì chúng cũng dùng dữ liệu từ DB
  if (hotelInfo) {
    // ⚠️ DISABLED: Service map loop - để test AI/RAG
    /*
    // Map từ keyword -> service key
    const serviceMap = [
      { key: "spa", keywords: ["spa", "massage"] },
      { key: "pool", keywords: ["hồ bơi", "bể bơi", "pool"] },
      { key: "gym", keywords: ["gym", "phòng gym", "phòng tập", "fitness"] },
      { key: "restaurant", keywords: ["nhà hàng", "restaurant", "ăn uống", "buffet", "breakfast"] },
      { key: "roomService", keywords: ["room service", "dịch vụ phòng"] },
      { key: "laundry", keywords: ["giặt ủi", "giặt đồ", "laundry"] },
      { key: "airportPickup", keywords: ["đón sân bay", "đưa đón", "airport", "shuttle"] },
      { key: "valet", keywords: ["valet", "bãi xe", "đỗ xe", "parking"] },
      { key: "concierge", keywords: ["concierge", "lễ tân", "hỗ trợ", "đặt hộ"] },
      { key: "tour", keywords: ["tour", "city tour", "tham quan"] },
      { key: "currencyExchange", keywords: ["đổi tiền", "currency", "exchange"] },
      { key: "babysitting", keywords: ["giữ trẻ", "trông trẻ", "babysit"] },
      { key: "wakeup", keywords: ["báo thức", "wake up"] },
      { key: "businessCenter", keywords: ["business center", "in ấn", "scan", "fax"] },
      { key: "meetingRoom", keywords: ["phòng họp", "meeting room"] },
      { key: "event", keywords: ["sự kiện", "event", "tiệc", "gala"] },
      { key: "carRental", keywords: ["thuê xe", "car rental", "xe có tài xế"] },
      { key: "parking", keywords: ["bãi xe", "parking"] }
    ];
    for (const svc of serviceMap) {
      if (matchKeywords(svc.keywords)) {
        const resp = serviceReply(svc.key);
        // Giữ nhãn thân thiện
        if (resp.text && resp.text.startsWith(`${svc.key}:`)) {
          const labelMap = {
            spa: "Spa",
            pool: "Hồ bơi",
            gym: "Gym",
            restaurant: "Nhà hàng",
            roomService: "Room service",
            laundry: "Giặt ủi",
            airportPickup: "Đưa đón sân bay",
            valet: "Valet/Bãi xe",
            concierge: "Concierge",
            tour: "Tour",
            currencyExchange: "Đổi tiền",
            babysitting: "Giữ trẻ",
            wakeup: "Báo thức",
            businessCenter: "Business center",
            meetingRoom: "Phòng họp",
            event: "Sự kiện/Tiệc",
            carRental: "Thuê xe",
            parking: "Bãi đỗ xe"
          };
          resp.text = `${labelMap[svc.key] || svc.key}: ${resp.text.replace(`${svc.key}: `, "")}`;
        }
        return resp;
      }
    }
    */

    // Tư vấn phòng cho gia đình/trẻ em (pattern ngắn, không gọi AI)
    if (matchKeywords(["gia đình", "family", "trẻ em", "trẻ nhỏ", "kid", "children"]) && matchKeywords(["phòng", "room"])) {
      const childrenPolicy = getPolicy(hotelInfo, "children");
      const policyText = childrenPolicy ? `\n\nChính sách trẻ em: ${childrenPolicy}` : "";
      const hasBookingContextDates =
        context.bookingContext &&
        context.bookingContext.checkInDate &&
        context.bookingContext.checkOutDate;
      const hasRoomList = context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0;

      if (hasBookingContextDates && hasRoomList) {
        const bc = context.bookingContext;
        const checkInStr = new Date(bc.checkInDate).toLocaleDateString('vi-VN');
        const checkOutStr = new Date(bc.checkOutDate).toLocaleDateString('vi-VN');
        const guests = bc.guests || bc.maxOccupancy || '';

        return {
          text:
            `Bạn đang xem danh sách phòng cho khoảng thời gian ${checkInStr} - ${checkOutStr}` +
            (guests ? ` cho khoảng ${guests} khách.` : '.') +
            `\n\nGợi ý phòng gia đình:\n` +
            "- Ưu tiên các phòng có sức chứa lớn hơn số khách hoặc hỗ trợ giường phụ.\n" +
            "- Nếu bạn thích một phòng cụ thể, hãy gõ số thứ tự (1, 2, 3, ...) để mình hỗ trợ tiếp.\n" +
            policyText,
          rooms: null,
          hasRooms: false
        };
      }

      // Chưa có ngày → chỉ tư vấn chung và xin thêm thông tin
      return {
        text:
          "Gợi ý phòng gia đình:\n" +
          "- Phòng 2 người + giường phụ (cho gia đình nhỏ).\n" +
          "- Cần rộng hơn? Bạn cho mình ngày nhận/trả và số người lớn/trẻ em để mình tìm đúng phòng.\n" +
          "- Giường phụ có thể sắp xếp tùy loại phòng và tình trạng.\n" +
          policyText,
        rooms: null,
        hasRooms: false
      };
    }

    // Hoạt động/địa điểm nhẹ nhàng cho gia đình/trẻ em (pattern ngắn)
    if (matchKeywords(["gia đình", "trẻ em", "kid", "children"]) && matchKeywords(["gần đây", "đi đâu", "hoạt động", "dạo", "ngắm", "vui chơi", "play"])) {
      return {
        text:
          "Gợi ý nhẹ nhàng cho gia đình/trẻ em:\n" +
          "- Bãi Sau: 300-500m, tắm biển/dạo bộ/bình minh.\n" +
          "- Bãi Dứa: ~2km, yên tĩnh, chụp ảnh.\n" +
          "- Hải đăng Vũng Tàu: ~2km, ngắm cảnh/hoàng hôn.\n" +
          "- Ẩm thực: Bánh khọt Gốc Vú Sữa (~2-3km), lẩu cá đuối (~2km).\n" +
          "Bạn muốn đi buổi sáng, chiều hay tối? Mình sẽ gợi ý lịch trình chi tiết hơn.",
        rooms: null,
        hasRooms: false
      };
    }

    // Giường phụ
    if (matchKeywords(["giường phụ", "extra bed", "thêm giường"])) {
      const hasBookingContextDates =
        context.bookingContext &&
        context.bookingContext.checkInDate &&
        context.bookingContext.checkOutDate;
      const hasRoomList = context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0;

      if (hasBookingContextDates && hasRoomList) {
        const bc = context.bookingContext;
        const checkInStr = new Date(bc.checkInDate).toLocaleDateString('vi-VN');
        const checkOutStr = new Date(bc.checkOutDate).toLocaleDateString('vi-VN');

        return {
          text:
            "Có thể sắp xếp giường phụ tùy loại phòng và tình trạng phòng.\n" +
            `Hiện bạn đang xem phòng cho khoảng thời gian ${checkInStr} - ${checkOutStr}.\n` +
            "Bạn hãy chọn phòng trong danh sách (gõ số thứ tự hoặc tên phòng), mình sẽ hỗ trợ kiểm tra khả năng thêm giường phụ và phí áp dụng cho phòng đó.",
          rooms: null,
          hasRooms: false
        };
      }

      // Chưa có ngày → cần xin thêm thông tin
      return {
        text:
          "Có thể sắp xếp giường phụ tùy loại phòng và tình trạng phòng.\n" +
          "Bạn cho mình ngày nhận/trả và số người lớn/trẻ em, mình sẽ kiểm tra phòng nào thêm giường phụ được và báo phí cụ thể.",
        rooms: null,
        hasRooms: false
      };
    }

    // Thanh toán
    if (matchKeywords(["thanh toán", "payment", "visa", "mastercard", "momo", "chuyển khoản"])) {
      const pay = getPayment(hotelInfo);
      const methods = pay?.methods?.join(", ");
      if (methods) {
        const note = pay?.notes ? ` ${pay.notes}` : "";
        const surcharge = pay?.surcharge ? ` ${pay.surcharge}` : "";
        return { text: `Phương thức thanh toán: ${methods}.${note}${surcharge}`, rooms: null, hasRooms: false };
      }
      return { text: hotelInfo.disclaimers?.updating || `Vui lòng liên hệ hotline ${hotline} để xác nhận phương thức thanh toán.`, rooms: null, hasRooms: false };
    }

    // Chính sách trẻ em
    if (matchKeywords(["trẻ em", "child", "kids", "bé"])) {
      const txt = getPolicy(hotelInfo, "children");
      if (txt) return { text: `Chính sách trẻ em: ${txt}`, rooms: null, hasRooms: false };
      return { text: hotelInfo.disclaimers?.updating || `Vui lòng liên hệ hotline ${hotline} để xác nhận chính sách trẻ em.`, rooms: null, hasRooms: false };
    }
    // Chính sách thú cưng
    if (matchKeywords(["thú cưng", "pet", "chó", "mèo"])) {
      const txt = getPolicy(hotelInfo, "pet");
      if (txt) return { text: `Chính sách thú cưng: ${txt}`, rooms: null, hasRooms: false };
      return { text: hotelInfo.disclaimers?.updating || `Vui lòng liên hệ hotline ${hotline} để xác nhận chính sách thú cưng.`, rooms: null, hasRooms: false };
    }
    // Chính sách hủy - Format đẹp hơn
    if (matchKeywords(["hủy", "cancel", "cancellation"])) {
      const retail = hotelInfo.policies?.cancel?.retail;
      const group = hotelInfo.policies?.cancel?.group;
      if (retail || group) {
        let text = "📋 **Chính sách hủy phòng:**\n\n";
        if (retail) {
          text += `👤 **Khách lẻ:**\n${retail}\n\n`;
        }
        if (group) {
          text += `👥 **Khách đoàn:**\n${group}\n\n`;
        }
        text += `💡 **Lưu ý:** Để hủy phòng, vui lòng liên hệ hotline ${hotline} hoặc email ${hotelInfo?.contact?.email || 'info@rayalpark.com'} trước thời hạn quy định.\n\n`;
        text += `📞 **Hotline:** ${hotline}`;
        return { text, rooms: null, hasRooms: false };
      }
      return { text: hotelInfo.disclaimers?.updating || `Vui lòng liên hệ hotline ${hotline} để xác nhận chính sách hủy.`, rooms: null, hasRooms: false };
    }
    // Early/Late check-in/out
    if (matchKeywords(["early", "late", "check-in", "check out", "trả phòng", "nhận phòng sớm", "trả phòng trễ"])) {
      const txt = getPolicy(hotelInfo, "earlyLate");
      if (txt) return { text: `Chính sách early/late: ${txt}`, rooms: null, hasRooms: false };
      return { text: hotelInfo.disclaimers?.updating || `Vui lòng liên hệ hotline ${hotline} để xác nhận chính sách early/late.`, rooms: null, hasRooms: false };
    }
    // Smoking / deposit / no-show
    if (matchKeywords(["hút thuốc", "smoking"])) {
      const txt = getPolicy(hotelInfo, "smoking");
      if (txt) return { text: `Chính sách hút thuốc: ${txt}`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["đặt cọc", "cọc", "deposit"])) {
      const txt = getPolicy(hotelInfo, "deposit");
      if (txt) return { text: `Chính sách đặt cọc: ${txt}`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["no show", "noshow"])) {
      const txt = getPolicy(hotelInfo, "noShow");
      if (txt) return { text: `Chính sách no-show: ${txt}`, rooms: null, hasRooms: false };
    }

    // Khuyến mãi (hiện không công bố, chỉ tặng mã sau khi đặt từ minRooms phòng)
    if (matchKeywords(["khuyến mãi", "ưu đãi", "promotion", "voucher"])) {
      const hotline = hotelInfo?.contact?.hotline || "0901 234 567";
      const postPromo = hotelInfo?.postBookingPromo;
      const minRooms = postPromo?.minRooms || 2;
      const validity = postPromo?.validityMonths || 3;
      const desc = postPromo?.description || `Đặt từ ${minRooms} phòng sẽ được tặng mã áp dụng cho lần lưu trú tiếp theo (hạn ${validity} tháng).`;
      return {
        text: `Hiện không công bố khuyến mãi trên web.\n${desc}\nLiên hệ hotline ${hotline} để được hỗ trợ đặt từ ${minRooms} phòng và nhận mã cho lần sau.`,
        rooms: null,
        hasRooms: false
      };
    }

    // Hội nghị / sự kiện
    if (matchKeywords(["phòng họp", "meeting"])) {
      const m = hotelInfo.events?.meeting;
      if (m?.enabled) {
        return { text: `Phòng họp: sức chứa ${m.capacity || ""}. Thiết bị: ${m.equipment || ""}. Ẩm thực: ${m.catering || ""}. ${m.notes || ""}`, rooms: null, hasRooms: false };
      }
      return { text: hotelInfo.disclaimers?.updating || `Phòng họp đang cập nhật, vui lòng liên hệ hotline ${hotline}.`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["sự kiện", "event", "tiệc", "gala"])) {
      const e = hotelInfo.events?.banquet || hotelInfo.events?.event;
      if (e?.enabled) {
        return { text: `Sự kiện/tiệc: sức chứa ${e.capacity || ""}. ${e.notes || ""} ${e.priceRange ? `Giá: ${e.priceRange}.` : ""}`, rooms: null, hasRooms: false };
      }
      return { text: hotelInfo.disclaimers?.updating || `Thông tin sự kiện đang cập nhật, vui lòng liên hệ hotline ${hotline}.`, rooms: null, hasRooms: false };
    }

    // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern lịch sử/thành lập từ hotelInfo
    // TODO: Re-enable after AI/RAG testing
    /*
    // Giới thiệu / lịch sử / giải thưởng
    if (matchKeywords(["lịch sử", "history", "thành lập", "năm nào"])) {
      const about = hotelInfo.about;
      if (about?.history || about?.founded) {
        return { text: about.history || `Khách sạn thành lập năm ${about.founded}.`, rooms: null, hasRooms: false };
      }
    }
    */
    if (matchKeywords(["chủ", "owner"])) {
      const about = hotelInfo.about;
      if (about?.owner) return { text: `Chủ sở hữu: ${about.owner}.`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["giải thưởng", "awards"])) {
      const awards = hotelInfo.about?.awards;
      if (awards?.length) return { text: `Giải thưởng: ${awards.join(", ")}.`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["nhân viên", "staff"])) {
      const staff = hotelInfo.about?.staffCount;
      if (staff) return { text: `Số lượng nhân sự: ${staff}.`, rooms: null, hasRooms: false };
    }
    if (matchKeywords(["ngôn ngữ", "language"])) {
      const langs = hotelInfo.about?.languages;
      if (langs?.length) return { text: `Ngôn ngữ hỗ trợ: ${langs.join(", ")}.`, rooms: null, hasRooms: false };
    }

    // Giá tham khảo khi chưa có ngày - Lấy giá thực từ database
    const mentionsDate = lower.match(/\d{1,2}\/\d{1,2}/) || lower.includes("hôm nay") || lower.includes("ngày mai") || lower.includes("tuần tới");
    if (!hasDates && !mentionsDate && matchKeywords(["giá", "bao nhiêu", "price", "cost", "giá phòng"]) && lower.includes("phòng")) {
      try {
        // ✅ Lấy giá thực từ database thay vì fallback prices
        const rooms = await Room.find({ available: true })
          .select('name roomType pricePerNight')
          .sort({ pricePerNight: 1 })
          .lean();
        
        if (rooms && rooms.length > 0) {
          // Nhóm phòng theo roomType và lấy giá min/max
          const roomTypes = {};
          rooms.forEach(room => {
            const type = room.roomType || 'Standard';
            if (!roomTypes[type]) {
              roomTypes[type] = {
                min: room.pricePerNight,
                max: room.pricePerNight,
                count: 1
              };
            } else {
              roomTypes[type].min = Math.min(roomTypes[type].min, room.pricePerNight);
              roomTypes[type].max = Math.max(roomTypes[type].max, room.pricePerNight);
              roomTypes[type].count++;
            }
          });
          
          // Format response
          const priceList = Object.entries(roomTypes)
            .map(([type, data]) => {
              if (data.min === data.max) {
                return `**${type}**: ${data.min.toLocaleString('vi-VN')} VNĐ/đêm`;
              } else {
                return `**${type}**: ${data.min.toLocaleString('vi-VN')} - ${data.max.toLocaleString('vi-VN')} VNĐ/đêm`;
              }
            })
            .join('\n');
          
          const minPrice = Math.min(...rooms.map(r => r.pricePerNight));
          const maxPrice = Math.max(...rooms.map(r => r.pricePerNight));
          
          return {
            text: `💰 **Giá phòng tham khảo:**\n\n${priceList}\n\n` +
                  `📊 **Khoảng giá:** ${minPrice.toLocaleString('vi-VN')} - ${maxPrice.toLocaleString('vi-VN')} VNĐ/đêm\n\n` +
                  `💡 **Lưu ý:** Giá có thể thay đổi theo ngày và mùa. Để có giá chính xác, vui lòng cung cấp:\n` +
                  `📅 Ngày nhận phòng\n` +
                  `📅 Ngày trả phòng\n` +
                  `👥 Số lượng khách\n\n` +
                  `Tôi sẽ tìm phòng phù hợp với giá tốt nhất cho bạn! 😊`,
            rooms: null,
            hasRooms: false
          };
        }
      } catch (error) {
        console.error('❌ Error fetching room prices from DB:', error);
      }
      
      // Fallback nếu không lấy được từ DB
      const prices = getFallbackPrices(hotelInfo);
      const deluxe = prices.deluxe ? `**Deluxe**: ${prices.deluxe}` : null;
      const suite = prices.suite ? `**Suite**: ${prices.suite}` : null;
      const family = prices.family ? `**Family**: ${prices.family}` : null;
      const priceList = [deluxe, suite, family].filter(Boolean).join('\n');
      if (priceList) {
        return {
          text: `💰 **Giá phòng tham khảo:**\n\n${priceList}\n\n` +
                `💡 **Lưu ý:** Giá có thể thay đổi theo ngày. Để có giá chính xác, vui lòng cung cấp ngày nhận/trả phòng và số lượng khách.`,
          rooms: null,
          hasRooms: false
        };
      }
      return {
        text: `💰 Giá phòng thay đổi theo ngày và loại phòng.\n\n` +
              `Để có giá chính xác, vui lòng cung cấp:\n` +
              `📅 Ngày nhận phòng\n` +
              `📅 Ngày trả phòng\n` +
              `👥 Số lượng khách\n\n` +
              `Hoặc liên hệ hotline ${hotline} để được báo giá ngay! 📞`,
        rooms: null,
        hasRooms: false
      };
    }

    // Local info (buffet sáng / note chung)
    if (matchKeywords(["buffet sáng", "breakfast", "ăn sáng"])) {
      const bf = hotelInfo.localInfo?.breakfast;
      if (bf) return { text: `Buffet sáng: ${bf}`, rooms: null, hasRooms: false };
    }
  }
  
  // Pattern 1: "tôi muốn đặt phòng" hoặc "đặt phòng thì sao" → Hướng dẫn (chỉ khi CHƯA có đầy đủ thông tin)
  if ((lower.includes('muốn đặt phòng') || 
      lower.includes('đặt phòng thì sao') || 
      lower.includes('cách đặt phòng') ||
      lower.includes('làm sao để đặt phòng') ||
      lower.includes('hướng dẫn đặt phòng') ||
      lower.includes('quy trình đặt phòng')) && !hasDates && !hasGuests) {
    return {
      text: 'Để đặt phòng, bạn vui lòng cung cấp:\n- Ngày nhận phòng (check-in)\n- Ngày trả phòng (check-out)\n- Số lượng khách\n- Email và số điện thoại\n\nTôi sẽ tìm phòng phù hợp cho bạn! 😊',
      rooms: null,
      hasRooms: false
    };
  }
  
  // Pattern 1.5: Câu hỏi về giá phòng chung chung → Hướng dẫn
  if ((lower.includes('giá phòng') || lower.includes('giá bao nhiêu') || lower.includes('room price')) && 
      !hasDates && !hasGuests) {
    return {
      text: 'Giá phòng dao động từ 1.500.000 - 5.000.000 VNĐ/đêm tùy loại. Để biết giá chính xác, vui lòng cho biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n- Số lượng khách\n\nTôi sẽ tìm phòng phù hợp với ngân sách của bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }
  
  // Pattern 1.6: Câu hỏi về loại phòng → Liệt kê
  if ((lower.includes('loại phòng') || lower.includes('có mấy loại') || lower.includes('room types')) && 
      !hasDates && !hasGuests) {
    return {
      text: 'Khách sạn chúng tôi có 4 loại phòng:\n- Phòng Đơn (1-2 người) - từ 1.500.000 VNĐ/đêm\n- Phòng Đôi (2 người) - từ 2.500.000 VNĐ/đêm\n- Phòng VIP (2-4 người) - từ 4.000.000 VNĐ/đêm\n- Phòng Suite (4-6 người) - từ 6.000.000 VNĐ/đêm\n\nBạn muốn đặt loại phòng nào?',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.7: Hỏi về giá phòng theo ngân sách
  const budgetPattern = lower.match(/(?:phòng|room).*?(?:dưới|dưới|under|below|tối đa|max|maximum|rẻ hơn|cheaper than|giá|price).*?(\d+)\s*(?:triệu|million|tr|m)/i) ||
                        lower.match(/(?:phòng|room).*?(\d+)\s*(?:triệu|million|tr|m)/i) ||
                        lower.match(/(?:ngân sách|budget).*?(\d+)\s*(?:triệu|million|tr|m)/i);
  if (budgetPattern && !hasDates) {
    const budget = parseInt(budgetPattern[1]) * 1000000; // Convert triệu -> VNĐ
    return {
      text: `Với ngân sách ${budgetPattern[1]} triệu VNĐ, bạn có thể tham khảo các phòng Standard hoặc Deluxe.\n\n` +
            'Để tìm phòng phù hợp với ngân sách, vui lòng cho biết:\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng tốt nhất trong ngân sách của bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.8: Hỏi về loại phòng cụ thể
  const roomTypePattern = lower.match(/(?:tìm|tìm kiếm|đặt|muốn|book|search).*?(?:phòng|room).*?(vip|suite|đơn|đôi|single|double|deluxe|standard|premium)/i) ||
                          lower.match(/(?:phòng|room).*?(vip|suite|đơn|đôi|single|double|deluxe|standard|premium)/i);
  if (roomTypePattern && !hasDates) {
    const roomType = roomTypePattern[1].toLowerCase();
    let roomInfo = '';
    if (roomType.includes('vip')) {
      roomInfo = 'Phòng VIP: Từ 4.000.000 VNĐ/đêm, sức chứa 2-4 người, tiện nghi cao cấp';
    } else if (roomType.includes('suite')) {
      roomInfo = 'Phòng Suite: Từ 6.000.000 VNĐ/đêm, sức chứa 4-6 người, không gian rộng rãi';
    } else if (roomType.includes('đơn') || roomType.includes('single')) {
      roomInfo = 'Phòng Đơn: Từ 1.500.000 VNĐ/đêm, sức chứa 1-2 người';
    } else if (roomType.includes('đôi') || roomType.includes('double')) {
      roomInfo = 'Phòng Đôi: Từ 2.500.000 VNĐ/đêm, sức chứa 2 người';
    } else if (roomType.includes('deluxe')) {
      roomInfo = 'Phòng Deluxe: Từ 3.000.000 VNĐ/đêm, sức chứa 2-3 người, tiện nghi đầy đủ';
    } else if (roomType.includes('standard')) {
      roomInfo = 'Phòng Standard: Từ 1.500.000 VNĐ/đêm, sức chứa 1-2 người, giá tốt';
    }
    
    return {
      text: `${roomInfo}\n\nĐể kiểm tra phòng trống và giá chính xác, vui lòng cho biết:\n` +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.9: Hỏi về tiện nghi phòng
  const amenitiesPattern = lower.match(/(?:phòng|room).*?(?:có|co|have|has).*?(bồn tắm|bathtub|ban công|balcony|minibar|tủ lạnh|refrigerator|máy lạnh|air conditioner|tivi|tv|wifi|internet|bếp|kitchen|máy giặt|washing machine)/i);
  if (amenitiesPattern && !hasDates) {
    return {
      text: 'Các phòng của chúng tôi đều có đầy đủ tiện nghi:\n\n' +
            '✅ WiFi miễn phí tốc độ cao\n' +
            '✅ TV màn hình phẳng\n' +
            '✅ Máy lạnh\n' +
            '✅ Minibar\n' +
            '✅ Tủ lạnh\n\n' +
            'Một số phòng cao cấp còn có:\n' +
            '✅ Bồn tắm\n' +
            '✅ Ban công\n' +
            '✅ Bếp mini\n\n' +
            'Để xem chi tiết tiện nghi của từng phòng, vui lòng cho biết ngày và số người để tôi tìm phòng phù hợp! 🛏️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.10: Hỏi về view phòng (mở rộng)
  const viewPattern = lower.match(/(?:phòng|room).*?(?:view|hướng).*?(thành phố|city|núi|mountain|biển|sea|ocean|sông|river|vườn|garden|park)/i);
  if (viewPattern && !hasDates) {
    const view = viewPattern[1].toLowerCase();
    let viewInfo = '';
    if (view.includes('biển') || view.includes('sea') || view.includes('ocean')) {
      // ✅ QUAN TRỌNG: Lưu requestedView để dùng khi user cung cấp ngày sau đó
      context.requestedView = 'biển';
      console.log(`✅ Detected sea view request in Pattern 1.10, setting context.requestedView = 'biển'`);
      viewInfo = 'Phòng view biển: Tầm nhìn ra biển tuyệt đẹp, không khí trong lành';
    } else if (view.includes('thành phố') || view.includes('city')) {
      viewInfo = 'Phòng view thành phố: Tầm nhìn ra thành phố nhộn nhịp';
    } else if (view.includes('núi') || view.includes('mountain')) {
      viewInfo = 'Phòng view núi: Tầm nhìn ra núi non hùng vĩ';
    } else if (view.includes('vườn') || view.includes('garden') || view.includes('park')) {
      viewInfo = 'Phòng view vườn: Tầm nhìn ra khu vườn xanh mát';
    }
    
    return {
      text: `${viewInfo}\n\nĐể kiểm tra phòng view ${viewPattern[1]} còn trống, vui lòng cho biết:\n` +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            `Tôi sẽ tìm phòng view ${viewPattern[1]} phù hợp cho bạn! 🌅`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.11: Hỏi về sức chứa phòng
  const capacityPattern = lower.match(/(?:phòng|room).*?(?:cho|for|dành cho|suitable for).*?(\d+)\s*(?:người|people|person|guests)/i) ||
                          lower.match(/(?:phòng|room).*?(?:chứa|capacity|sức chứa|fit|accommodate).*?(?:bao nhiêu|how many|how much)/i);
  if (capacityPattern && !hasDates) {
    if (capacityPattern[1]) {
      const guests = parseInt(capacityPattern[1]);
      // ✅ Lưu số khách vào bookingContext để sử dụng khi user cung cấp ngày
      if (!context.bookingContext) context.bookingContext = {};
      context.bookingContext.guests = guests;
      context.bookingContext.maxOccupancy = guests;
      
      let roomSuggestion = '';
      if (guests <= 2) {
        roomSuggestion = 'Phòng Đơn hoặc Đôi (1-2 người)';
      } else if (guests <= 4) {
        roomSuggestion = 'Phòng VIP (2-4 người)';
      } else {
        roomSuggestion = 'Phòng Suite (4-6 người)';
      }
      
      return {
        text: `Với ${guests} người, bạn nên chọn ${roomSuggestion}.\n\n` +
              'Để tìm phòng phù hợp, vui lòng cho biết:\n' +
              '📅 Ngày nhận phòng\n' +
              '📅 Ngày trả phòng\n\n' +
              'Tôi sẽ tìm phòng có sức chứa phù hợp cho bạn! 👥',
        rooms: null,
        hasRooms: false,
        bookingContext: context.bookingContext
      };
    } else {
      return {
        text: 'Sức chứa phòng:\n\n' +
              '• Phòng Đơn: 1-2 người\n' +
              '• Phòng Đôi: 2 người\n' +
              '• Phòng Deluxe: 2-3 người\n' +
              '• Phòng VIP: 2-4 người\n' +
              '• Phòng Suite: 4-6 người\n\n' +
              'Bạn có bao nhiêu người? Tôi sẽ tìm phòng phù hợp! 🏨',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 1.12: So sánh phòng
  const comparisonPattern = lower.match(/(?:so sánh|compare|khác nhau|difference|khác biệt).*?(?:phòng|room)/i);
  if (comparisonPattern) {
    return {
      text: 'So sánh các loại phòng:\n\n' +
            '**Phòng Standard:**\n' +
            '• Giá: Từ 1.500.000 VNĐ/đêm\n' +
            '• Sức chứa: 1-2 người\n' +
            '• Tiện nghi cơ bản\n\n' +
            '**Phòng Deluxe:**\n' +
            '• Giá: Từ 3.000.000 VNĐ/đêm\n' +
            '• Sức chứa: 2-3 người\n' +
            '• Tiện nghi đầy đủ, không gian rộng hơn\n\n' +
            '**Phòng VIP:**\n' +
            '• Giá: Từ 4.000.000 VNĐ/đêm\n' +
            '• Sức chứa: 2-4 người\n' +
            '• Tiện nghi cao cấp, view đẹp\n\n' +
            '**Phòng Suite:**\n' +
            '• Giá: Từ 6.000.000 VNĐ/đêm\n' +
            '• Sức chứa: 4-6 người\n' +
            '• Tiện nghi sang trọng, không gian rộng rãi\n\n' +
            'Bạn muốn đặt loại phòng nào? 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.13: Hỏi về thời gian lưu trú tối thiểu
  const stayDurationPattern = lower.match(/(?:đặt|book|stay).*?(?:tối thiểu|minimum|ít nhất|at least).*?(\d+)\s*(?:đêm|night)/i) ||
                              lower.match(/(?:có thể|can|can i).*?(?:đặt|book).*?(\d+)\s*(?:đêm|night)/i);
  if (stayDurationPattern) {
    return {
      text: 'Không có yêu cầu về số đêm tối thiểu. Bạn có thể đặt phòng từ 1 đêm trở lên.\n\n' +
            'Tuy nhiên, một số phòng đặc biệt hoặc vào mùa cao điểm có thể có yêu cầu đặt tối thiểu.\n\n' +
            'Để biết chính xác, vui lòng cho biết:\n- Ngày nhận phòng\n- Ngày trả phòng\n\n' +
            'Tôi sẽ kiểm tra và thông báo cho bạn! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.14: Hỏi về chính sách trẻ em
  const childrenPolicyPattern = lower.match(/(?:trẻ em|children|kids|bé).*?(?:tính phí|fee|charge|miễn phí|free|policy|chính sách)/i) ||
                               lower.match(/(?:chính sách|policy).*?(?:trẻ em|children|kids)/i) ||
                               lower.match(/(?:bé|trẻ).*?(\d+)\s*(?:tuổi|years old|age).*?(?:tính phí|fee|charge)/i);
  if (childrenPolicyPattern) {
    const ageMatch = lower.match(/(\d+)\s*(?:tuổi|years old|age)/i);
    const age = ageMatch ? parseInt(ageMatch[1]) : null;
    
    let policyText = 'Chính sách trẻ em:\n\n';
    if (age !== null) {
      if (age < 6) {
        policyText += `✅ Trẻ ${age} tuổi: Miễn phí (ở chung giường với ba mẹ)\n`;
      } else if (age >= 6 && age < 12) {
        policyText += `💰 Trẻ ${age} tuổi: Phụ thu 50% giá người lớn\n`;
      } else {
        policyText += `💰 Trẻ ${age} tuổi: Tính như người lớn (100% giá)\n`;
      }
    } else {
      policyText += '• Trẻ dưới 6 tuổi: Miễn phí (ở chung giường với ba mẹ)\n';
      policyText += '• Trẻ 6-11 tuổi: Phụ thu 50% giá người lớn\n';
      policyText += '• Trẻ từ 12 tuổi trở lên: Tính như người lớn (100% giá)\n';
    }
    policyText += '\nKhi đặt phòng, vui lòng cho biết số lượng và độ tuổi trẻ em để tính giá chính xác! 👶';
    
    return {
      text: policyText,
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 1.15: Hỏi về dịch vụ bổ sung (giường phụ, bữa sáng)
  // TODO: Re-enable after AI/RAG testing
  /*
  const extraServicePattern = lower.match(/(?:thêm|add|extra|additional).*?(?:giường|bed|bữa sáng|breakfast|dịch vụ|service)/i) ||
                              lower.match(/(?:có thể|can).*?(?:thêm|add).*?(?:giường|bed|bữa sáng|breakfast)/i) ||
                              lower.match(/(?:giường phụ|extra bed|additional bed|bữa sáng thêm|extra breakfast)/i);
  if (extraServicePattern) {
    if (lower.includes('giường') || lower.includes('bed')) {
      return {
        text: 'Có thể thêm giường phụ với phí bổ sung.\n\n' +
              'Để biết giá và đặt giường phụ, vui lòng:\n' +
              '- Gọi hotline: 0901 234 567\n' +
              '- Hoặc hỏi khi đặt phòng\n\n' +
              'Giường phụ chỉ áp dụng cho phòng có đủ không gian. Vui lòng đặt trước khi check-in! 🛏️',
        rooms: null,
        hasRooms: false
      };
    } else if (lower.includes('bữa sáng') || lower.includes('breakfast')) {
      return {
        text: 'Có thể thêm bữa sáng với phí bổ sung.\n\n' +
              'Bữa sáng được phục vụ từ 6:30 - 10:00 sáng hàng ngày.\n\n' +
              'Để biết giá và đặt bữa sáng, vui lòng:\n' +
              '- Gọi hotline: 0901 234 567\n' +
              '- Hoặc hỏi khi đặt phòng\n\n' +
              'Khi đặt phòng, vui lòng cho biết số lượng người cần bữa sáng! 🍳',
        rooms: null,
        hasRooms: false
      };
    }
  }
  */

  // Pattern 1.16: Hỏi về thanh toán
  const paymentPattern = lower.match(/(?:thanh toán|payment|pay).*?(?:khi đến|on arrival|tại khách sạn|at hotel)/i) ||
                        lower.match(/(?:có thể|can).*?(?:thanh toán|payment|pay).*?(?:khi đến|on arrival)/i) ||
                        lower.match(/(?:đặt cọc|deposit|down payment|advance payment)/i) ||
                        lower.match(/(?:cần|cần thiết|required).*?(?:đặt cọc|deposit)/i);
  if (paymentPattern) {
    if (lower.includes('đặt cọc') || lower.includes('deposit')) {
      return {
        text: 'Chính sách đặt cọc:\n\n' +
              '• Một số phòng đặc biệt hoặc mùa cao điểm có thể yêu cầu đặt cọc\n' +
              '• Thanh toán còn lại khi check-in\n\n' +
              'Để biết chính xác, vui lòng:\n' +
              '- Gọi hotline: 0901 234 567\n' +
              '- Hoặc hỏi khi đặt phòng\n\n' +
              'Tôi sẽ kiểm tra và thông báo cho bạn! 💳',
        rooms: null,
        hasRooms: false
      };
    } else {
      return {
        text: 'Chúng tôi chấp nhận nhiều phương thức thanh toán:\n\n' +
              '✅ Thanh toán khi đến (tiền mặt, thẻ)\n' +
              '✅ Thanh toán online (VNPay, thẻ tín dụng)\n' +
              '✅ Chuyển khoản ngân hàng\n\n' +
              'Thanh toán tại lễ tân khi check-in hoặc thanh toán trước qua website.\n\n' +
              'Bạn muốn thanh toán bằng cách nào? 💰',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 1.17: Hỏi về hủy/đổi phòng (đã có xử lý đổi ngày ở trên nên giữ nguyên)

  const cancelChangePattern = lower.match(/(?:hủy|cancel|đổi|change|modify).*?(?:phòng|booking|đặt phòng)/i) ||
                             lower.match(/(?:có thể|can).*?(?:hủy|cancel|đổi|change).*?(?:phòng|booking)/i) ||
                             lower.match(/(?:đổi ngày|change date|modify booking)/i);
  if (cancelChangePattern) {
    const currentBookingAction = context.bookingContext?.bookingIntentAction || null;

    if (lower.includes('hủy') || lower.includes('cancel')) {
      return {
        text: 'Chính sách hủy phòng:\n\n' +
              '✅ Hủy trước 48 giờ: Miễn phí\n' +
              '⚠️ Hủy trong 24-48 giờ: Phí 30% giá phòng\n' +
              '⚠️ Hủy trong 24 giờ: Phí 50% giá phòng\n' +
              '❌ Không hủy (No-show): Phí 100% giá phòng\n\n' +
              'Để hủy phòng, vui lòng:\n' +
              '- Gọi hotline: 0901 234 567\n' +
              '- Hoặc email: info@rayalpark.com\n' +
              '- Hoặc hủy trực tuyến trên website\n\n' +
              'Bạn có mã đặt phòng không? Tôi có thể hỗ trợ bạn! 📞',
        rooms: null,
        hasRooms: false
      };
    } else if (currentBookingAction === 'change_room' &&
               (!context.lastRoomSearchResults || context.lastRoomSearchResults.length === 0)) {
      // User muốn đổi phòng nhưng không có danh sách phòng hiện tại -> hỏi lại tiêu chí/tìm phòng mới
      return {
        text: 'Bạn muốn đổi phòng. Hiện chưa có danh sách phòng đang hiển thị. ' +
              'Bạn cho mình **ngày nhận – ngày trả** và **số khách**, hoặc tiêu chí phòng bạn muốn, ' +
              'mình sẽ tìm và gửi lại danh sách phòng mới cho bạn nhé.',
        rooms: null,
        hasRooms: false
      };
    } else if ((lower.includes('đổi') || lower.includes('change') || lower.includes('modify')) &&
               (!context.lastRoomSearchResults || context.lastRoomSearchResults.length === 0) &&
               currentBookingAction !== 'change_room') {
      // Chỉ trả lời chính sách đổi booking khi KHÔNG đang ở giữa flow đổi phòng trong list
      return {
        text: 'Có thể đổi ngày/phòng với điều kiện:\n\n' +
              '✅ Đổi trước 48 giờ: Miễn phí (nếu có phòng trống)\n' +
              '⚠️ Đổi trong 24-48 giờ: Có thể phát sinh phí\n' +
              '⚠️ Đổi trong 24 giờ: Tùy tình trạng phòng\n\n' +
              'Để đổi booking, vui lòng:\n' +
              '- Gọi hotline: 0901 234 567\n' +
              '- Hoặc email: info@rayalpark.com\n\n' +
              'Bạn có mã đặt phòng và muốn đổi sang ngày nào? Tôi có thể kiểm tra phòng trống cho bạn! 📅',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 1.18: Hỏi về check-in sớm/check-out muộn
  const earlyLatePattern = lower.match(/(?:check-in sớm|early check-in|check-in sớm hơn)/i) ||
                          lower.match(/(?:check-out muộn|late check-out|check-out muộn hơn)/i) ||
                          lower.match(/(?:có thể|can).*?(?:check-in|check-out).*?(?:sớm|muộn|early|late)/i);
  if (earlyLatePattern) {
    if (lower.includes('check-in') && (lower.includes('sớm') || lower.includes('early'))) {
      return {
        text: 'Check-in sớm:\n\n' +
              '✅ Giờ check-in tiêu chuẩn: Từ 14:00\n' +
              '✅ Check-in sớm: Tùy tình trạng phòng\n' +
              '💰 Phí check-in sớm (trước 14:00): Có thể phát sinh phí\n\n' +
              'Nếu đến sớm, bạn có thể:\n' +
              '- Gửi hành lý tại lễ tân (miễn phí)\n' +
              '- Sử dụng các tiện ích khách sạn\n' +
              '- Chờ phòng sẵn sàng\n\n' +
              'Vui lòng liên hệ trước qua hotline: 0901 234 567 để sắp xếp check-in sớm! ⏰',
        rooms: null,
        hasRooms: false
      };
    } else if (lower.includes('check-out') && (lower.includes('muộn') || lower.includes('late'))) {
      return {
        text: 'Check-out muộn:\n\n' +
              '✅ Giờ check-out tiêu chuẩn: Trước 12:00\n' +
              '✅ Check-out muộn: Tùy tình trạng phòng\n' +
              '💰 Phí check-out muộn (sau 12:00): Có thể phát sinh phí\n\n' +
              'Nếu cần check-out muộn, vui lòng:\n' +
              '- Thông báo trước với lễ tân\n' +
              '- Kiểm tra tình trạng phòng\n' +
              '- Thanh toán phí nếu có\n\n' +
              'Vui lòng liên hệ lễ tân hoặc hotline: 0901 234 567! ⏰',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 1.19: DISABLED - Để RAG xử lý với data chi tiết từ knowledge-base
  // RAG sẽ trả lời với tên quán cụ thể, địa chỉ, giá, khoảng cách từ nearby-restaurants.md, nearby-beaches.md
  /*
  const nearbyPattern = lower.match(/(?:gần|near|nearby|quanh|around).*?(?:khách sạn|hotel)/i) ||
                        lower.match(/(?:địa điểm|attraction|place|nơi).*?(?:gần|near|nearby)/i) ||
                        lower.match(/(?:có gì|có địa điểm|what).*?(?:gần|near|nearby)/i) ||
                        lower.match(/(?:tham quan|visit|sightseeing|shopping|mua sắm|ăn uống|restaurant)/i) ||
                        lower.match(/(?:đi chơi|đi đâu|chơi gì|du lịch).*?(?:vũng tàu|ở đâu|được đâu|gần)/i) ||
                        lower.match(/(?:biển|bãi biển|núi|hải đăng|bãi sau|bãi trước)/i);
  if (nearbyPattern) {
    context.exploreContext = { topic: 'nearby' };
    return {
      text: '...',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 1.20: Hỏi về ưu đãi/khuyến mãi
  const promotionPattern = lower.match(/(?:khuyến mãi|promotion|discount|ưu đãi|deal|offer|special)/i) ||
                          lower.match(/(?:có|có chương trình|have).*?(?:khuyến mãi|promotion|discount|ưu đãi)/i) ||
                          lower.match(/(?:giảm giá|sale|off|percent off)/i);
  if (promotionPattern) {
    const hotline = hotelInfo?.contact?.hotline || '0901 234 567';
    const postPromo = hotelInfo?.postBookingPromo;
    const minRooms = postPromo?.minRooms || 2;
    const validity = postPromo?.validityMonths || 3;
    const desc = postPromo?.description || `Đặt từ ${minRooms} phòng sẽ được tặng mã áp dụng cho lần lưu trú tiếp theo (hạn ${validity} tháng).`;
    return {
      text: `Hiện không công bố khuyến mãi trên web.\n${desc}\nLiên hệ hotline ${hotline} để được hỗ trợ đặt từ ${minRooms} phòng và nhận mã cho lần sau.`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.21: Hỏi về thời gian tốt nhất để đặt
  const bestTimePattern = lower.match(/(?:khi nào|when|best time|tốt nhất).*?(?:đặt|book)/i) ||
                         lower.match(/(?:mùa|season).*?(?:cao điểm|peak|thấp điểm|low)/i) ||
                         lower.match(/(?:nên|should).*?(?:đặt|book).*?(?:khi nào|when)/i);
  if (bestTimePattern) {
    return {
      text: 'Thời gian tốt nhất để đặt phòng:\n\n' +
            '📅 **Đặt sớm:**\n' +
            '• Đặt trước để có giá tốt nhất\n' +
            '• Nhiều lựa chọn phòng hơn\n\n' +
            '📅 **Mùa cao điểm:**\n' +
            '• Tết, lễ hội, cuối tuần: Nên đặt sớm\n\n' +
            '💡 **Lời khuyên:**\n' +
            '• Đặt càng sớm càng tốt để có giá tốt\n' +
            '• Tránh đặt vào phút chót\n' +
            '• Theo dõi website để biết ưu đãi mới\n\n' +
            'Bạn muốn đặt phòng cho thời gian nào? Tôi sẽ tìm giá tốt nhất cho bạn! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.22: Hỏi về phòng trống
  const availabilityPattern = lower.match(/(?:phòng trống|available|availability|còn trống|free room)/i) ||
                             lower.match(/(?:có|có còn|have).*?(?:phòng trống|available room)/i) ||
                             lower.match(/(?:kiểm tra|check).*?(?:phòng trống|availability)/i);
  if (availabilityPattern && !hasDates) {
    return {
      text: 'Để kiểm tra phòng trống, vui lòng cho biết:\n\n' +
            '📅 **Ngày nhận phòng** (check-in)\n' +
            '📅 **Ngày trả phòng** (check-out)\n' +
            '👥 **Số lượng khách**\n' +
            '🏨 **Loại phòng** (nếu có yêu cầu)\n\n' +
            'Tôi sẽ kiểm tra ngay và cho bạn biết phòng nào còn trống!\n\n' +
            'Bạn muốn đặt phòng cho khoảng thời gian nào? 🔍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.23: Hỏi về giá theo tuần/tháng
  const longTermPattern = lower.match(/(?:giá|price|rate).*?(?:tuần|week|tháng|month|dài hạn|long term)/i) ||
                         lower.match(/(?:theo tuần|weekly|theo tháng|monthly|dài hạn|long term)/i) ||
                         lower.match(/(?:đặt|book).*?(\d+)\s*(?:tuần|week|tháng|month)/i);
  if (longTermPattern) {
    return {
      text: 'Để biết giá dài hạn (theo tuần/tháng), vui lòng:\n\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Vui lòng cho biết:\n' +
            '- Ngày bắt đầu\n' +
            '- Số tuần/tháng\n' +
            '- Số lượng khách\n' +
            '- Loại phòng\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng để có giá ưu đãi! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.24: Hỏi về group booking
  const groupPattern = lower.match(/(?:đặt|book).*?(?:nhiều|multiple|several).*?(?:phòng|room)/i) ||
                      lower.match(/(?:group|đoàn|team|nhóm).*?(?:booking|đặt phòng)/i) ||
                      lower.match(/(?:đặt|book).*?(\d+)\s*(?:phòng|room)/i);
  if (groupPattern) {
    return {
      text: 'Để đặt phòng nhóm, vui lòng:\n\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Vui lòng cho biết:\n' +
            '- Số lượng phòng\n' +
            '- Ngày nhận phòng\n' +
            '- Ngày trả phòng\n' +
            '- Số lượng khách\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng để có giá ưu đãi cho nhóm! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.25: Hỏi về event/meeting
  const eventPattern = lower.match(/(?:tổ chức|organize|host).*?(?:sự kiện|event|meeting|hội nghị|conference)/i) ||
                      lower.match(/(?:phòng họp|meeting room|event space|sự kiện)/i) ||
                      lower.match(/(?:có|có thể|can).*?(?:tổ chức|organize).*?(?:event|sự kiện)/i);
  if (eventPattern) {
    return {
      text: 'Chúng tôi có dịch vụ tổ chức sự kiện và phòng họp.\n\n' +
            'Để biết chi tiết và báo giá, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n\n' +
            'Vui lòng cho biết:\n' +
            '- Loại sự kiện\n' +
            '- Số lượng người\n' +
            '- Ngày giờ\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận sự kiện! 🎊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.26: Hỏi về pet policy
  const petPattern = lower.match(/(?:thú cưng|pet|chó|dog|mèo|cat).*?(?:có thể|allowed|chấp nhận|accept)/i) ||
                    lower.match(/(?:có thể|can).*?(?:mang|bring).*?(?:thú cưng|pet|chó|dog|mèo|cat)/i) ||
                    lower.match(/(?:pet policy|chính sách thú cưng)/i);
  if (petPattern) {
    return {
      text: 'Để biết chính sách thú cưng, vui lòng:\n\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Vui lòng thông báo khi đặt phòng nếu bạn có thú cưng để chúng tôi sắp xếp phòng phù hợp! 🐕🐱',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.27: Hỏi về accessibility
  const accessibilityPattern = lower.match(/(?:người khuyết tật|disabled|wheelchair|accessible|barrier-free)/i) ||
                              lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:người khuyết tật|disabled|wheelchair)/i) ||
                              lower.match(/(?:có|có thể|have).*?(?:accessible|wheelchair).*?(?:phòng|room)/i);
  if (accessibilityPattern) {
    return {
      text: 'Để biết về phòng dành cho người khuyết tật, vui lòng:\n\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Vui lòng thông báo khi đặt phòng để chúng tôi sắp xếp phòng phù hợp! ♿',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.28: Hỏi về parking
  const parkingPattern = lower.match(/(?:chỗ đỗ|parking|bãi đỗ|đỗ xe|park).*?(?:xe|car|vehicle)/i) ||
                        lower.match(/(?:có|có thể|have).*?(?:chỗ đỗ|parking|bãi đỗ|đỗ xe)/i) ||
                        lower.match(/(?:xe|car).*?(?:có thể|can).*?(?:đỗ|park)/i);
  if (parkingPattern) {
    return {
      text: 'Bãi đỗ xe:\n\n' +
            '✅ Bãi đỗ xe miễn phí cho khách lưu trú\n' +
            '✅ Đỗ xe trong suốt thời gian lưu trú\n' +
            '✅ Bảo vệ 24/7\n\n' +
            'Vui lòng đăng ký biển số xe khi check-in.\n\n' +
            'Bạn có cần đỗ xe không? Tôi sẽ ghi nhận khi đặt phòng! 🚗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.29: Hỏi về special requests
  const specialRequestPattern = lower.match(/(?:yêu cầu|request|đặc biệt|special).*?(?:đặc biệt|special)/i) ||
                               lower.match(/(?:có thể|can).*?(?:yêu cầu|request).*?(?:đặc biệt|special)/i) ||
                               lower.match(/(?:honeymoon|kỷ niệm|anniversary|sinh nhật|birthday)/i);
  if (specialRequestPattern) {
    return {
      text: 'Chúng tôi có thể đáp ứng các yêu cầu đặc biệt.\n\n' +
            'Để đặt dịch vụ đặc biệt, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Thông báo khi đặt phòng\n\n' +
            'Vui lòng cho biết yêu cầu cụ thể để chúng tôi sắp xếp tốt nhất! 🎁',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.1: Hỏi về mã khuyến mãi
  const promoCodePattern = lower.match(/(?:mã|code|mã giảm giá|promo code).*?([A-Z0-9]{4,10})/i) ||
                          lower.match(/([A-Z0-9]{4,10}).*?(?:giảm|discount|ưu đãi)/i);
  if (promoCodePattern) {
    const hotline = hotelInfo?.contact?.hotline || '0901 234 567';
    const postPromo = hotelInfo?.postBookingPromo;
    const minRooms = postPromo?.minRooms || 2;
    const validity = postPromo?.validityMonths || 3;
    const desc = postPromo?.description || `Đặt từ ${minRooms} phòng sẽ được tặng mã áp dụng cho lần lưu trú tiếp theo (hạn ${validity} tháng).`;
    return {
      text: `${desc}\nMã sẽ được cấp sau khi đặt thành công (≥${minRooms} phòng) và dùng trong ${validity} tháng cho lần sau.\nNếu bạn đã có mã, vui lòng nhập khi thanh toán hoặc liên hệ hotline ${hotline} để được hỗ trợ.`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.2: Hỏi về ưu đãi cho loại phòng cụ thể
  const promoRoomPattern = lower.match(/(?:ưu đãi|promotion|discount|khuyến mãi).*?(?:cho|for).*?(?:phòng|room)/i) ||
                           lower.match(/(?:phòng|room).*?(vip|suite|deluxe|standard).*?(?:ưu đãi|promotion|discount)/i);
  if (promoRoomPattern) {
    return {
      text: 'Chúng tôi có các chương trình ưu đãi cho từng loại phòng.\n\n' +
            'Để biết ưu đãi hiện tại, vui lòng:\n' +
            '- Xem trên website\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Bạn muốn đặt loại phòng nào? Tôi sẽ kiểm tra ưu đãi cho bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 3.1: Hỏi về mã booking/xác nhận
  const bookingCodePattern = lower.match(/(?:mã booking|booking code|mã đặt phòng|confirmation code|mã xác nhận)/i) ||
                            lower.match(/(?:tôi đã đặt|i booked|đã đặt phòng).*?(?:mã|code)/i);
  if (bookingCodePattern) {
    return {
      text: 'Mã booking sẽ được gửi qua email sau khi đặt phòng thành công.\n\n' +
            'Nếu bạn đã đặt phòng nhưng chưa nhận được mã, vui lòng:\n' +
            '- Kiểm tra hộp thư spam\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n\n' +
            'Bạn có mã booking không? Tôi có thể hỗ trợ bạn! 📧',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 3.2: Hỏi về hóa đơn/chứng từ
  const invoicePattern = lower.match(/(?:hóa đơn|invoice|bill|chứng từ|receipt)/i) ||
                        lower.match(/(?:cần|cần thiết|need).*?(?:hóa đơn|invoice|bill)/i);
  if (invoicePattern) {
    return {
      text: 'Hóa đơn sẽ được gửi qua email sau khi thanh toán.\n\n' +
            'Nếu cần hóa đơn VAT, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Email: info@rayalpark.com\n' +
            '- Cung cấp thông tin công ty khi đặt phòng\n\n' +
            'Bạn cần hóa đơn VAT không? 📄',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 3.3: Hỏi về tình trạng booking
  const bookingStatusPattern = lower.match(/(?:tình trạng|status|trạng thái).*?(?:booking|đặt phòng)/i) ||
                               lower.match(/(?:đã đặt|booked).*?(?:chưa|yet|rồi)/i);
  if (bookingStatusPattern) {
    return {
      text: 'Để kiểm tra tình trạng booking, vui lòng:\n\n' +
            '- Đăng nhập vào website và vào phần "Đặt phòng của tôi"\n' +
            '- Hoặc gọi hotline: 0901 234 567\n' +
            '- Hoặc email: info@rayalpark.com\n\n' +
            'Bạn có mã booking không? Tôi có thể hỗ trợ bạn! 📋',
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 4.1: Hỏi về dịch vụ ăn uống
  // TODO: Re-enable after AI/RAG testing
  /*
  const diningPattern = lower.match(/(?:dịch vụ|service).*?(?:ăn uống|dining|food|restaurant)/i) ||
                        lower.match(/(?:có|có dịch vụ|have).*?(?:nhà hàng|restaurant|ăn sáng|breakfast|buffet)/i) ||
                        lower.match(/(?:ăn sáng|breakfast|buffet|room service|nhà hàng)/i);
  if (diningPattern) {
    return {
      text: 'Rayal Park Hotel có đầy đủ dịch vụ ăn uống:\n\n' +
            '🍽️ **Nhà hàng chính:**\n' +
            '• Phục vụ bữa sáng, trưa, tối\n\n' +
            '🍹 **Bar & Lounge:**\n' +
            '• Đồ uống và snack từ 10:00 - 24:00\n\n' +
            '📞 **Room Service:**\n' +
            '• Phục vụ 24/7\n\n' +
            '🥐 **Buffet sáng:**\n' +
            '• 6:30 - 10:00 hàng ngày\n\n' +
            'Về việc ăn sáng có bao gồm trong giá phòng, tùy theo gói đặt phòng. Để biết chi tiết, vui lòng liên hệ hotline: 0901 234 567. 🍳',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 4.2: Hỏi về Spa & Wellness
  // TODO: Re-enable after AI/RAG testing
  /*
  const spaPattern = lower.match(/(?:spa|massage|wellness|fitness|gym|bể bơi|pool|xông hơi|sauna)/i) ||
                     lower.match(/(?:có|có dịch vụ|have).*?(?:spa|gym|bể bơi|pool)/i);
  if (spaPattern) {
    return {
      text: 'Rayal Park Hotel có đầy đủ dịch vụ Spa & Wellness:\n\n' +
            '💆 **Spa:**\n' +
            '• Các liệu pháp massage thư giãn\n' +
            '• Phục vụ theo yêu cầu\n\n' +
            '💪 **Phòng Gym:**\n' +
            '• Thiết bị hiện đại\n' +
            '• Miễn phí cho khách lưu trú\n\n' +
            '🏊 **Bể bơi:**\n' +
            '• Ngoài trời\n' +
            '• Miễn phí cho khách lưu trú\n\n' +
            '🧖 **Phòng xông hơi:**\n' +
            '• Có sẵn\n\n' +
            'Để biết giờ hoạt động và giá dịch vụ, vui lòng liên hệ hotline: 0901 234 567. 🧘',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 4.3: Hỏi về đưa đón sân bay
  // TODO: Re-enable after AI/RAG testing
  /*
  const airportPattern = lower.match(/(?:đưa đón|transfer|pickup|pick up).*?(?:sân bay|airport)/i) ||
                        lower.match(/(?:airport|sân bay).*?(?:transfer|đưa đón|pickup)/i);
  if (airportPattern) {
    return {
      text: 'Dịch vụ đưa đón sân bay:\n\n' +
            '✅ Có dịch vụ đưa đón sân bay\n' +
            '💰 Có phụ phí\n\n' +
            'Để đặt dịch vụ, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Hoặc đặt khi đặt phòng\n\n' +
            'Vui lòng cho biết:\n' +
            '- Số chuyến bay\n' +
            '- Thời gian đến\n' +
            '- Số lượng người và hành lý\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận dịch vụ! ✈️',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 4.4: Hỏi về giặt ủi
  // TODO: Re-enable after AI/RAG testing
  /*
  const laundryPattern = lower.match(/(?:giặt ủi|laundry|washing|dry cleaning)/i) ||
                        lower.match(/(?:có|có dịch vụ|have).*?(?:giặt|laundry)/i);
  if (laundryPattern) {
    return {
      text: 'Dịch vụ giặt ủi:\n\n' +
            '✅ Có dịch vụ giặt ủi\n' +
            '💰 Có phí\n\n' +
            'Để biết giá và thời gian, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Hoặc hỏi lễ tân khi check-in\n\n' +
            'Dịch vụ có thể được phục vụ trong ngày hoặc qua đêm tùy yêu cầu. 👔',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 4.5: Hỏi về WiFi/Internet
  // TODO: Re-enable after AI/RAG testing
  /*
  const wifiPattern = lower.match(/(?:wifi|internet|mạng|network|connection)/i) ||
                     lower.match(/(?:có|có wifi|have).*?(?:wifi|internet)/i);
  if (wifiPattern) {
    return {
      text: 'WiFi & Internet:\n\n' +
            '✅ WiFi miễn phí tốc độ cao\n' +
            '✅ Phủ sóng toàn khách sạn\n' +
            '✅ Không giới hạn dung lượng\n\n' +
            'Thông tin đăng nhập sẽ được cung cấp khi check-in.\n\n' +
            'Bạn có cần hỗ trợ kết nối WiFi không? 📶',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 6.1: Hỏi về lịch sử khách sạn
  // TODO: Re-enable after AI/RAG testing
  /*
  const historyPattern = lower.match(/(?:lịch sử|history|thành lập|established|khách sạn có từ|bao nhiêu năm)/i) ||
                        lower.match(/(?:khách sạn|hotel).*?(?:thành lập|established|năm nào)/i);
  if (historyPattern) {
    return {
      text: 'Lịch sử Rayal Park Hotel:\n\n' +
            '📜 **2010 - Khởi Nghiệp:**\n' +
            'Rayal Park Hotel được thành lập với 20 phòng đầu tiên.\n\n' +
            '📜 **2015 - Mở Rộng:**\n' +
            'Mở rộng lên 50 phòng, đạt tiêu chuẩn 4 sao.\n\n' +
            '📜 **2020 - Đạt 5 Sao:**\n' +
            'Chính thức đạt tiêu chuẩn 5 sao quốc tế.\n\n' +
            '📜 **2024 - Hiện Tại:**\n' +
            'Tiếp tục đổi mới và nâng cao chất lượng dịch vụ.\n\n' +
            'Bạn muốn tìm hiểu thêm về chủ khách sạn hoặc tính năng mới không? 🏨',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 6.2: Hỏi về chủ khách sạn
  // TODO: Re-enable after AI/RAG testing
  /*
  const ownerPattern = lower.match(/(?:chủ khách sạn|owner|chủ sở hữu|người sáng lập|founder|giám đốc)/i) ||
                      lower.match(/(?:ai|who).*?(?:chủ|owner|sáng lập|founder)/i);
  if (ownerPattern) {
    return {
      text: 'Chủ khách sạn:\n\n' +
            '👤 **Chủ tịch & Nhà sáng lập:** Nguyễn Văn A\n' +
            '• Hơn 20 năm kinh nghiệm trong ngành khách sạn\n' +
            '• Sáng lập Rayal Park Hotel năm 2010\n\n' +
            '🏆 **Thành tựu:**\n' +
            '• Giải thưởng "Khách sạn tốt nhất năm 2023"\n' +
            '• Chứng nhận 5 sao quốc tế\n' +
            '• Top 10 khách sạn hàng đầu Việt Nam\n\n' +
            'Bạn muốn tìm hiểu thêm về lịch sử hoặc tính năng mới không? 👔',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 6.3: Hỏi về tính năng mới
  // TODO: Re-enable after AI/RAG testing
  /*
  const featuresPattern = lower.match(/(?:tính năng|feature|tính năng mới|new feature|công nghệ|technology)/i) ||
                         lower.match(/(?:có|có tính năng|have).*?(?:mới|new|chatbot|ai)/i);
  if (featuresPattern) {
    return {
      text: 'Tính năng mới của Rayal Park Hotel:\n\n' +
            '🤖 **Chatbot AI Thông Minh:**\n' +
            'Hỗ trợ 24/7, đa ngôn ngữ (bạn đang sử dụng tính năng này!)\n\n' +
            '⚡ **Đặt Phòng Tức Thì:**\n' +
            'Đặt phòng ngay từ chat, xác nhận trong vài giây\n\n' +
            '📅 **Đồng Bộ Google Calendar:**\n' +
            'Tự động thêm lịch đặt phòng vào Google Calendar\n\n' +
            '💻 **Quản Lý Booking Online:**\n' +
            'Xem, chỉnh sửa, hủy đặt phòng mọi lúc mọi nơi\n\n' +
            '💳 **Thanh Toán Đa Phương Thức:**\n' +
            'Thẻ tín dụng, chuyển khoản, thanh toán tại khách sạn\n\n' +
            '📍 **Gợi Ý Địa Điểm Gần:**\n' +
            'Khám phá các địa điểm tham quan, nhà hàng gần khách sạn\n\n' +
            'Bạn muốn tìm hiểu chi tiết về tính năng nào? Hoặc nhấn "Khám Phá Ngay" trên trang chủ! ✨',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 6.4: Hỏi về khám phá khách sạn
  // TODO: Re-enable after AI/RAG testing
  /*
  const explorePattern = lower.match(/(?:khám phá|explore|tìm hiểu|giới thiệu|về khách sạn|khách sạn có gì)/i) ||
                        lower.match(/(?:thông tin|information).*?(?:khách sạn|hotel)/i);
  if (explorePattern) {
    return {
      text: 'Khám phá Rayal Park Hotel:\n\n' +
            '🏨 Khách sạn 5 sao được thành lập năm 2015\n' +
            '✨ Hơn 10 năm kinh nghiệm phục vụ\n\n' +
            'Bạn có thể tìm hiểu về:\n\n' +
            '📜 **Lịch Sử Hình Thành:**\n' +
            'Hành trình phát triển từ năm 2015 đến nay\n\n' +
            '👤 **Chủ Khách Sạn:**\n' +
            'Thông tin về người sáng lập và thành tựu\n\n' +
            '✨ **Tính Năng Mới:**\n' +
            '6 tính năng công nghệ mới nhất\n\n' +
            '📍 **Địa Điểm Gần:**\n' +
            'Các điểm tham quan, nhà hàng xung quanh\n\n' +
            'Bạn muốn tìm hiểu về chủ đề nào? Hoặc nhấn "Khám Phá Ngay" trên trang chủ! 🗺️',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 1.30: Câu hỏi phức tạp về đặt phòng với nhiều thông tin (gia đình, cuối tuần, view)
  const complexBookingPattern = lower.match(/(?:đặt|muốn|tìm|book).*?phòng.*?(?:cho|for).*?(?:gia đình|family|đoàn|group).*?(\d+)\s*(?:người|people|guests)/i) ||
                                lower.match(/(?:đặt|muốn|tìm|book).*?phòng.*?(\d+)\s*(?:người|people|guests).*?(?:cuối tuần|weekend|view|biển|núi)/i) ||
                                lower.match(/(?:có|có phòng|have).*?phòng.*?(?:view|hướng).*?(?:đẹp|beautiful|nice).*?(?:cho|for).*?(\d+)\s*(?:người|people)/i);
  if (complexBookingPattern && !hasDates) {
    const guests = parseInt(complexBookingPattern[1]) || 4;
    const hasViewRequest = lower.includes('view') || lower.includes('biển') || lower.includes('núi') || lower.includes('hướng');
    const isWeekend = lower.includes('cuối tuần') || lower.includes('weekend');
    
    let responseText = `Với ${guests} người, bạn nên chọn phòng VIP (2-4 người) hoặc Suite (4-6 người).\n\n`;
    
    if (hasViewRequest) {
      responseText += 'Để tìm phòng view đẹp, vui lòng cho biết:\n';
    } else {
      responseText += 'Để tìm phòng phù hợp, vui lòng cho biết:\n';
    }
    
    responseText += '📅 Ngày nhận phòng\n';
    responseText += '📅 Ngày trả phòng\n';
    
    if (isWeekend) {
      responseText += '\n💡 Lưu ý: Cuối tuần thường đông, nên đặt sớm để có giá tốt!\n';
    }
    
    responseText += '\nTôi sẽ tìm phòng phù hợp cho bạn! 🏨';
    
    return {
      text: responseText,
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 1.31: Dịch vụ đặc biệt cho trẻ em
  // TODO: Re-enable after AI/RAG testing
  /*
  const childrenServicePattern = lower.match(/(?:dịch vụ|service).*?(?:đặc biệt|special).*?(?:cho|for).*?(?:trẻ em|children|kids|bé)/i) ||
                                lower.match(/(?:có|có dịch vụ|have).*?(?:dịch vụ|service).*?(?:cho|for).*?(?:trẻ em|children|kids)/i) ||
                                lower.match(/(?:trẻ em|children|kids).*?(?:dịch vụ|service|tiện ích|amenities)/i);
  if (childrenServicePattern) {
    return {
      text: 'Dịch vụ đặc biệt cho trẻ em:\n\n' +
            '👶 **Chính sách trẻ em:**\n' +
            '• Trẻ dưới 6 tuổi: Miễn phí (ở chung giường với ba mẹ)\n' +
            '• Trẻ 6-11 tuổi: Phụ thu 50% giá người lớn\n' +
            '• Trẻ từ 12 tuổi: Tính như người lớn\n\n' +
            '🎮 **Tiện ích:**\n' +
            '• Giường phụ cho trẻ em\n' +
            '• Đồ chơi và hoạt động giải trí\n' +
            '• Thực đơn trẻ em tại nhà hàng\n\n' +
            '🏊 **Dịch vụ:**\n' +
            '• Bể bơi có khu vực nông cho trẻ em\n' +
            '• Dịch vụ trông trẻ (theo yêu cầu)\n\n' +
            'Để biết chi tiết và đặt dịch vụ, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Bạn có bao nhiêu trẻ em và độ tuổi? Tôi sẽ tính giá chính xác! 👨‍👩‍👧‍👦',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 1.32: Tổ chức tiệc/sự kiện (mở rộng Pattern 1.25)
  const eventBookingPattern = lower.match(/(?:tổ chức|organize|host).*?(?:tiệc|party|sinh nhật|birthday|anniversary|kỷ niệm|event|sự kiện)/i) ||
                             lower.match(/(?:cần|cần làm|need|phải làm).*?(?:gì|what).*?(?:để|to).*?(?:tổ chức|organize)/i) ||
                             lower.match(/(?:sinh nhật|birthday|tiệc|party).*?(?:tại|at).*?(?:khách sạn|hotel)/i);
  if (eventBookingPattern) {
    const eventType = lower.includes('sinh nhật') || lower.includes('birthday') ? 'sinh nhật' :
                     lower.includes('kỷ niệm') || lower.includes('anniversary') ? 'kỷ niệm' :
                     lower.includes('tiệc') || lower.includes('party') ? 'tiệc' : 'sự kiện';
    
    return {
      text: `Để tổ chức ${eventType} tại khách sạn, bạn cần:\n\n` +
            '📋 **Thông tin cần chuẩn bị:**\n' +
            '• Số lượng khách mời\n' +
            '• Ngày giờ tổ chức\n' +
            '• Ngân sách dự kiến\n' +
            '• Yêu cầu đặc biệt (trang trí, thức ăn, v.v.)\n\n' +
            '🎊 **Dịch vụ có thể cung cấp:**\n' +
            '• Phòng tổ chức sự kiện\n' +
            '• Trang trí theo chủ đề\n' +
            '• Thực đơn đặc biệt\n' +
            '• Bánh kem và đồ uống\n' +
            '• Dịch vụ chụp ảnh\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Vui lòng cho biết số lượng khách và ngày giờ để chúng tôi báo giá chi tiết! 🎉',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.33: So sánh phòng cụ thể (mở rộng Pattern 1.12)
  const specificComparisonPattern = lower.match(/(?:so sánh|compare).*?(vip|suite|deluxe|standard).*?(?:và|and|với|with).*?(vip|suite|deluxe|standard)/i) ||
                                    lower.match(/(?:khác nhau|difference|khác biệt).*?(?:giữa|between).*?(vip|suite|deluxe|standard).*?(?:và|and|với|with).*?(vip|suite|deluxe|standard)/i);
  if (specificComparisonPattern) {
    const room1 = specificComparisonPattern[1]?.toLowerCase() || '';
    const room2 = specificComparisonPattern[2]?.toLowerCase() || '';
    
    let comparisonText = `So sánh ${room1.toUpperCase()} và ${room2.toUpperCase()}:\n\n`;
    
    // So sánh chi tiết dựa trên loại phòng
    if ((room1.includes('vip') && room2.includes('suite')) || (room1.includes('suite') && room2.includes('vip'))) {
      comparisonText += '**Phòng VIP:**\n';
      comparisonText += '• Giá: Từ 4.000.000 VNĐ/đêm\n';
      comparisonText += '• Sức chứa: 2-4 người\n';
      comparisonText += '• Tiện nghi cao cấp, view đẹp\n\n';
      comparisonText += '**Phòng Suite:**\n';
      comparisonText += '• Giá: Từ 6.000.000 VNĐ/đêm\n';
      comparisonText += '• Sức chứa: 4-6 người\n';
      comparisonText += '• Tiện nghi sang trọng, không gian rộng rãi\n\n';
      comparisonText += '💡 **Khác biệt:** Suite rộng hơn và có nhiều tiện nghi hơn VIP.';
    } else if ((room1.includes('deluxe') && room2.includes('vip')) || (room1.includes('vip') && room2.includes('deluxe'))) {
      comparisonText += '**Phòng Deluxe:**\n';
      comparisonText += '• Giá: Từ 3.000.000 VNĐ/đêm\n';
      comparisonText += '• Sức chứa: 2-3 người\n';
      comparisonText += '• Tiện nghi đầy đủ\n\n';
      comparisonText += '**Phòng VIP:**\n';
      comparisonText += '• Giá: Từ 4.000.000 VNĐ/đêm\n';
      comparisonText += '• Sức chứa: 2-4 người\n';
      comparisonText += '• Tiện nghi cao cấp hơn, view đẹp hơn\n\n';
      comparisonText += '💡 **Khác biệt:** VIP có view đẹp hơn và tiện nghi cao cấp hơn Deluxe.';
    } else {
      comparisonText += 'Để so sánh chi tiết, vui lòng:\n';
      comparisonText += '- Xem trên website\n';
      comparisonText += '- Gọi hotline: 0901 234 567\n';
      comparisonText += '- Hoặc hỏi khi đặt phòng\n\n';
      comparisonText += 'Bạn muốn đặt loại phòng nào? 💰';
    }
    
    return {
      text: comparisonText,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.34: Phòng phù hợp cho tuần trăng mật/honeymoon
  const honeymoonPattern = lower.match(/(?:phòng|room).*?(?:phù hợp|suitable|best|tốt nhất).*?(?:cho|for).*?(?:tuần trăng mật|honeymoon|hôn nhân|wedding|romantic)/i) ||
                               lower.match(/(?:tuần trăng mật|honeymoon|hôn nhân|wedding|romantic).*?(?:phòng|room)/i) ||
                               lower.match(/(?:phòng|room).*?(?:lãng mạn|romantic|honeymoon)/i);
  if (honeymoonPattern) {
    return {
      text: 'Phòng phù hợp cho tuần trăng mật:\n\n' +
            '💑 **Phòng Suite:**\n' +
            '• Không gian rộng rãi, sang trọng\n' +
            '• View đẹp (view biển hoặc view thành phố)\n' +
            '• Bồn tắm lớn, ban công riêng\n' +
            '• Dịch vụ đặc biệt: Trang trí phòng, rượu champagne\n\n' +
            '💑 **Phòng VIP:**\n' +
            '• View đẹp, tiện nghi cao cấp\n' +
            '• Giá hợp lý hơn Suite\n' +
            '• Phù hợp cho cặp đôi\n\n' +
            '🎁 **Dịch vụ bổ sung:**\n' +
            '• Trang trí phòng theo yêu cầu\n' +
            '• Bánh kem và rượu champagne\n' +
            '• Dịch vụ spa đôi\n' +
            '• Bữa tối lãng mạn\n\n' +
            'Để đặt phòng tuần trăng mật, vui lòng:\n' +
            '- Gọi hotline: 0901 234 567\n' +
            '- Hoặc hỏi khi đặt phòng\n\n' +
            'Bạn muốn đặt phòng cho ngày nào? Tôi sẽ tìm phòng phù hợp nhất! 💕',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.35: Đồ chay/dietary requirements
  const dietaryPattern = lower.match(/(?:có|có phục vụ|serve|have).*?(?:đồ chay|vegetarian|vegan|halal|kosher)/i) ||
                        lower.match(/(?:đồ chay|vegetarian|vegan|halal|kosher|ăn chay)/i) ||
                        lower.match(/(?:dịch vụ|service).*?(?:ăn uống|dining).*?(?:chay|vegetarian)/i);
  if (dietaryPattern) {
    const dietaryType = lower.includes('chay') || lower.includes('vegetarian') ? 'chay' :
                       lower.includes('vegan') ? 'vegan' :
                       lower.includes('halal') ? 'halal' : 'đặc biệt';
    
    return {
      text: `Dịch vụ ăn uống ${dietaryType}:\n\n` +
            '✅ **Nhà hàng:**\n' +
            '• Có thực đơn đồ chay và các món ăn đặc biệt\n' +
            '• Phục vụ theo yêu cầu\n\n' +
            '✅ **Room Service:**\n' +
            '• Có thể đặt món chay 24/7\n' +
            '• Thực đơn đa dạng\n\n' +
            '📞 **Đặt trước:**\n' +
            '• Vui lòng thông báo khi đặt phòng\n' +
            '• Hoặc gọi hotline: 0901 234 567\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Chúng tôi sẽ chuẩn bị món ăn phù hợp với yêu cầu của bạn! 🥗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.36: Pet policy chi tiết (mở rộng Pattern 1.26)
  const detailedPetPattern = lower.match(/(?:có thể|can|allowed).*?(?:mang|bring).*?(?:thú cưng|pet|chó|dog|mèo|cat)/i) ||
                            lower.match(/(?:thú cưng|pet|chó|dog|mèo|cat).*?(?:có thể|allowed|chấp nhận|accept)/i) ||
                            lower.match(/(?:pet policy|chính sách thú cưng|phí thú cưng|pet fee)/i);
  if (detailedPetPattern) {
    return {
      text: 'Chính sách thú cưng:\n\n' +
            '🐕 **Quy định:**\n' +
            '• Một số phòng cho phép mang thú cưng\n' +
            '• Có thể phát sinh phí bổ sung\n' +
            '• Cần thông báo trước khi đặt phòng\n\n' +
            '📋 **Yêu cầu:**\n' +
            '• Thú cưng phải được tiêm phòng đầy đủ\n' +
            '• Phải có dây xích và rọ mõm (nếu cần)\n' +
            '• Không được để thú cưng ở một mình trong phòng\n\n' +
            '💰 **Phí:**\n' +
            '• Phí bổ sung tùy theo loại và kích thước thú cưng\n' +
            '• Vui lòng liên hệ để biết giá cụ thể\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Thông báo khi đặt phòng\n\n' +
            'Bạn có thú cưng loại gì? Tôi sẽ kiểm tra phòng phù hợp! 🐾',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.36.5: Câu hỏi về sức chứa của phòng đã chọn ("phòng này ở được X người không")
  // ✅ QUAN TRỌNG: Sử dụng selectedRoom hoặc bookingContext để trả lời về capacity
  const selectedRoomCapacityPattern = lower.match(/(?:phòng này|phòng đó|phòng đã chọn|room this|room that|selected room).*?(?:ở được|chứa được|có thể ở|fit|accommodate|sức chứa).*?(\d+)\s*(?:người|people|person|guests)(?:.*?(?:không|not|no))?/i) ||
                                       lower.match(/(?:phòng này|phòng đó|phòng đã chọn).*?(\d+)\s*(?:người|people|person|guests).*?(?:ở được|chứa được|có thể ở|fit|accommodate)/i);
  if (selectedRoomCapacityPattern && (context.selectedRoom || context.bookingContext?.roomId || context.lastRoomSearchResults?.length > 0)) {
    const requestedGuests = parseInt(selectedRoomCapacityPattern[1]);
    if (!isNaN(requestedGuests) && requestedGuests > 0) {
      // Ưu tiên lấy từ selectedRoom, sau đó từ bookingContext, cuối cùng từ lastRoomSearchResults
      let selectedRoom = context.selectedRoom;
      let roomId = null;
      
      if (selectedRoom) {
        roomId = selectedRoom._id?.toString ? selectedRoom._id.toString() : String(selectedRoom._id || '');
      } else if (context.bookingContext?.roomId) {
        roomId = context.bookingContext.roomId;
      } else if (context.lastRoomSearchResults?.length > 0) {
        selectedRoom = context.lastRoomSearchResults[0];
        roomId = selectedRoom._id?.toString ? selectedRoom._id.toString() : String(selectedRoom._id || '');
      }
      
      // Nếu có roomId nhưng chưa có maxOccupancy, lấy từ DB
      if (roomId && (!selectedRoom || !selectedRoom.maxOccupancy)) {
        try {
          const dbRoom = await Room.findById(roomId).lean();
          if (dbRoom) {
            selectedRoom = selectedRoom ? { ...selectedRoom, ...dbRoom } : dbRoom;
          }
        } catch (error) {
          console.error('❌ Error fetching room for capacity check:', error);
        }
      }
      
      if (selectedRoom && selectedRoom.maxOccupancy) {
        const maxOccupancy = selectedRoom.maxOccupancy;
        const roomName = selectedRoom.name || context.bookingContext?.roomName || 'phòng này';
        
        if (requestedGuests <= maxOccupancy) {
          return {
            text: `✅ **Có**, ${roomName} ở được **${requestedGuests} người**.\n\n` +
                  `👥 **Sức chứa tối đa:** ${maxOccupancy} người\n\n` +
                  (requestedGuests < maxOccupancy 
                    ? `💡 Phòng còn dư chỗ, rất thoải mái cho ${requestedGuests} người!\n\n`
                    : `💡 Phòng vừa đủ cho ${requestedGuests} người.\n\n`) +
                  `Bạn muốn đặt phòng này không? 🏨`,
            rooms: roomId ? [{
              id: roomId,
              name: roomName,
              roomType: selectedRoom.roomType,
              pricePerNight: selectedRoom.pricePerNight,
              maxOccupancy: maxOccupancy,
              view: selectedRoom.view,
              image: selectedRoom.image || selectedRoom.thumbnailUrl || '',
              amenities: Array.isArray(selectedRoom.amenities) ? selectedRoom.amenities : []
            }] : null,
            hasRooms: !!roomId
          };
        } else {
          return {
            text: `❌ **Không**, ${roomName} chỉ ở được tối đa **${maxOccupancy} người**.\n\n` +
                  `👥 **Sức chứa hiện tại:** ${maxOccupancy} người\n` +
                  `👥 **Bạn cần:** ${requestedGuests} người\n\n` +
                  `💡 **Gợi ý:**\n` +
                  `• Đặt thêm 1 phòng nữa để đủ chỗ cho ${requestedGuests} người\n` +
                  `• Hoặc tìm phòng có sức chứa lớn hơn (Suite, VIP)\n\n` +
                  `Bạn muốn tôi tìm phòng phù hợp cho ${requestedGuests} người không? 🔍`,
            rooms: null,
            hasRooms: false
          };
        }
      }
    }
  }

  // Pattern 1.37: Câu hỏi về phòng đã chọn ("phòng đó", "phòng này", "phòng đã chọn")
  // ✅ QUAN TRỌNG: Sử dụng context để trả lời về phòng đã chọn
  const selectedRoomQuestionPattern = lower.match(/(?:phòng đó|phòng này|phòng đã chọn|room that|room this|selected room).*?(?:có gì|what|đặc biệt|special|tiện nghi|amenities)/i) ||
                                      lower.match(/(?:có gì|what|đặc biệt|special).*?(?:phòng đó|phòng này|phòng đã chọn)/i) ||
                                      lower.match(/(?:phòng đó|phòng này).*?(?:giá|price|giá bao nhiêu)/i);
  if (selectedRoomQuestionPattern && (context.selectedRoom || context.lastRoomSearchResults?.length > 0)) {
    const selectedRoom = context.selectedRoom || (context.lastRoomSearchResults && context.lastRoomSearchResults[0]);
    
    if (selectedRoom) {
      const amenities = Array.isArray(selectedRoom.amenities) ? selectedRoom.amenities : [];
      const amenitiesText = amenities.length > 0 
        ? amenities.map(a => `• ${a}`).join('\n')
        : '• WiFi miễn phí\n• TV màn hình phẳng\n• Máy lạnh\n• Minibar\n• Tủ lạnh';
      
      const roomId = selectedRoom._id?.toString ? selectedRoom._id.toString() : String(selectedRoom._id || '');
      const bookingData = {
        roomId: roomId,
        ...(context.bookingContext || {})
      };
      
      return {
        text: `Thông tin phòng **${selectedRoom.name}**:\n\n` +
              `💰 **Giá:** ${selectedRoom.pricePerNight?.toLocaleString('vi-VN') || 'N/A'} VNĐ/đêm\n` +
              `👥 **Sức chứa:** ${selectedRoom.maxOccupancy || 'N/A'} người\n` +
              `🏨 **Loại:** ${selectedRoom.roomType || 'Standard'}\n` +
              `🌅 **View:** ${selectedRoom.view || 'N/A'}\n\n` +
              `✨ **Tiện nghi:**\n${amenitiesText}\n\n` +
              `🔍 [Xem chi tiết phòng](${createRoomDetailLink(roomId)})\n` +
              `📝 [Đặt phòng ngay](${createBookingLink(bookingData)})\n\n` +
              'Bạn muốn đặt phòng này không? 🏨',
        rooms: [{
          id: roomId,
          name: selectedRoom.name,
          roomType: selectedRoom.roomType,
          pricePerNight: selectedRoom.pricePerNight,
          maxOccupancy: selectedRoom.maxOccupancy,
          view: selectedRoom.view,
          image: selectedRoom.image || selectedRoom.thumbnailUrl || '',
          amenities: amenities
        }],
        hasRooms: true
      };
    }
  }

  // Pattern 1.38: Câu hỏi về giá đã tính ("giá đó", "giá này", "tổng tiền")
  // ✅ QUAN TRỌNG: Sử dụng bookingContext để trả lời về giá
  const priceQuestionPattern = lower.match(/(?:giá đó|giá này|tổng tiền|total price|giá bao nhiêu).*?(?:bao gồm|include|có|has).*?(?:thuế|tax|vat|phí|fee)/i) ||
                               lower.match(/(?:đã|already|đã bao gồm|included).*?(?:thuế|tax|vat|phí|fee)/i) ||
                               lower.match(/(?:giá đó|giá này|tổng tiền).*?(?:là|is|bằng|equal)/i);
  if (priceQuestionPattern && bookingContext.totalPrice) {
    const totalPrice = bookingContext.totalPrice;
    const nights = bookingContext.nights || 1;
    const roomPrice = bookingContext.roomPrice || 0;
    const childSurcharge = bookingContext.childSurcharge || 0;
    
    let priceText = `Tổng giá: **${totalPrice.toLocaleString('vi-VN')} VNĐ**\n\n`;
    priceText += `📋 **Chi tiết:**\n`;
    priceText += `• Giá phòng: ${roomPrice.toLocaleString('vi-VN')} VNĐ/đêm\n`;
    priceText += `• Số đêm: ${nights} đêm\n`;
    if (childSurcharge > 0) {
      priceText += `• Phụ thu trẻ em: ${childSurcharge.toLocaleString('vi-VN')} VNĐ\n`;
    }
    priceText += `• Tổng cộng: ${totalPrice.toLocaleString('vi-VN')} VNĐ\n\n`;
    priceText += `💰 **Về thuế và phí:**\n`;
    priceText += `• Giá đã bao gồm VAT (10%)\n`;
    priceText += `• Không phát sinh phí dịch vụ\n`;
    priceText += `• Phí hủy phòng (nếu có) theo chính sách hủy\n\n`;
    priceText += `Bạn có muốn đặt phòng không? 💳`;
    
    return {
      text: priceText,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.39: Câu hỏi về giá chung (khi chưa có bookingContext)
  if (priceQuestionPattern && !bookingContext.totalPrice) {
    return {
      text: 'Giá phòng đã bao gồm:\n\n' +
            '✅ **Đã bao gồm:**\n' +
            '• VAT (10%)\n' +
            '• WiFi miễn phí\n' +
            '• Dịch vụ cơ bản\n\n' +
            '❌ **Không bao gồm:**\n' +
            '• Bữa sáng (có thể thêm với phí bổ sung)\n' +
            '• Dịch vụ spa, gym (một số dịch vụ có phí)\n' +
            '• Phí hủy phòng (nếu hủy trong thời gian tính phí)\n\n' +
            'Để biết giá chính xác cho phòng của bạn, vui lòng đặt phòng hoặc gọi hotline: 0901 234 567. 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.40: Câu hỏi về ngân sách cụ thể với số đêm
  const budgetNightsPattern = lower.match(/(?:ngân sách|budget).*?(\d+)\s*(?:triệu|million|tr|m).*?(?:ở|stay|đêm|night).*?(\d+)\s*(?:đêm|night)/i) ||
                               lower.match(/(?:có|có thể|can).*?(\d+)\s*(?:triệu|million|tr|m).*?(?:đặt|book).*?(\d+)\s*(?:đêm|night)/i) ||
                               lower.match(/(?:phòng|room).*?(\d+)\s*(?:triệu|million|tr|m).*?(\d+)\s*(?:đêm|night)/i);
  if (budgetNightsPattern && !hasDates) {
    const budget = parseInt(budgetNightsPattern[1]) * 1000000; // Convert triệu -> VNĐ
    const nights = parseInt(budgetNightsPattern[2]) || 1;
    const pricePerNight = Math.floor(budget / nights);
    
    let roomSuggestion = '';
    if (pricePerNight >= 6000000) {
      roomSuggestion = 'Phòng Suite (từ 6.000.000 VNĐ/đêm)';
    } else if (pricePerNight >= 4000000) {
      roomSuggestion = 'Phòng VIP (từ 4.000.000 VNĐ/đêm)';
    } else if (pricePerNight >= 3000000) {
      roomSuggestion = 'Phòng Deluxe (từ 3.000.000 VNĐ/đêm)';
    } else if (pricePerNight >= 1500000) {
      roomSuggestion = 'Phòng Standard hoặc Đôi (từ 1.500.000 VNĐ/đêm)';
    } else {
      roomSuggestion = 'Phòng Standard (từ 1.500.000 VNĐ/đêm) - có thể cần điều chỉnh ngân sách';
    }
    
    return {
      text: `Với ngân sách ${budgetNightsPattern[1]} triệu VNĐ cho ${nights} đêm, bạn có thể tham khảo ${roomSuggestion}.\n\n` +
            `💰 **Tính toán:**\n` +
            `• Ngân sách: ${budget.toLocaleString('vi-VN')} VNĐ\n` +
            `• Số đêm: ${nights} đêm\n` +
            `• Giá/đêm tối đa: ${pricePerNight.toLocaleString('vi-VN')} VNĐ\n\n` +
            `Để tìm phòng phù hợp với ngân sách, vui lòng cho biết:\n` +
            `📅 Ngày nhận phòng\n` +
            `📅 Ngày trả phòng\n` +
            `👥 Số lượng khách\n\n` +
            `Tôi sẽ tìm phòng tốt nhất trong ngân sách của bạn! 💰`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.41: Câu hỏi về đặt nhiều phòng
  const multipleRoomsPattern = lower.match(/(?:đặt|muốn|book).*?(\d+)\s*(?:phòng|room)/i) ||
                              lower.match(/(?:cần|cần đặt|need).*?(\d+)\s*(?:phòng|room)/i) ||
                              lower.match(/(\d+)\s*(?:phòng|room).*?(?:cho|for)/i);
  if (multipleRoomsPattern && parseInt(multipleRoomsPattern[1]) > 1 && !hasDates) {
    const roomCount = parseInt(multipleRoomsPattern[1]);
    
    return {
      text: `Để đặt ${roomCount} phòng, vui lòng:\n\n` +
            '📋 **Thông tin cần cung cấp:**\n' +
            '• Ngày nhận phòng\n' +
            '• Ngày trả phòng\n' +
            '• Số lượng khách/phòng\n' +
            '• Loại phòng mong muốn (nếu có)\n\n' +
            '💰 **Về giá:**\n' +
            '• Đặt nhiều phòng có thể có giá ưu đãi\n' +
            '• Giá sẽ được tính theo từng phòng\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Vui lòng cho biết ngày và số người để tôi tính giá tốt nhất cho bạn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.42: Câu hỏi về giá tốt nhất trong khoảng thời gian
  const bestPricePattern = lower.match(/(?:giá tốt nhất|best price|giá rẻ nhất|cheapest).*?(?:trong|in|tháng|month|tuần|week|năm|year)/i) ||
                          lower.match(/(?:khi nào|when).*?(?:giá|price).*?(?:tốt nhất|best|rẻ nhất|cheapest)/i) ||
                          lower.match(/(?:tháng|month|tuần|week).*?(?:nào|which).*?(?:giá|price).*?(?:tốt|best|rẻ)/i);
  if (bestPricePattern) {
    return {
      text: 'Giá tốt nhất thường vào:\n\n' +
            '📅 **Thời gian:**\n' +
            '• Ngày thường (Thứ 2 - Thứ 5): Giá tốt nhất\n' +
            '• Cuối tuần (Thứ 6 - Chủ nhật): Giá cao hơn\n' +
            '• Mùa cao điểm (Tết, lễ hội): Giá cao nhất\n\n' +
            '💡 **Lời khuyên:**\n' +
            '• Đặt sớm để có giá tốt\n' +
            '• Theo dõi website để biết ưu đãi\n' +
            '• Sử dụng mã khuyến mãi\n\n' +
            'Để biết giá chính xác, vui lòng cho biết:\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm giá tốt nhất cho bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.43: Câu hỏi về người khuyết tật/người già
  const specialNeedsPattern = lower.match(/(?:người khuyết tật|disabled|wheelchair|người già|elderly|senior).*?(?:đi cùng|accompany|với|with)/i) ||
                               lower.match(/(?:có|có người).*?(?:khuyết tật|disabled|wheelchair|già|elderly|senior)/i) ||
                               lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:người khuyết tật|disabled|wheelchair|người già|elderly)/i);
  if (specialNeedsPattern) {
    const isDisabled = lower.includes('khuyết tật') || lower.includes('disabled') || lower.includes('wheelchair');
    const isElderly = lower.includes('già') || lower.includes('elderly') || lower.includes('senior');
    
    let responseText = '';
    if (isDisabled) {
      responseText = 'Phòng cho người khuyết tật:\n\n' +
                    '♿ **Tiện nghi:**\n' +
                    '• Phòng rộng rãi, dễ di chuyển\n' +
                    '• Phòng tắm có tay vịn\n' +
                    '• Cửa rộng, không có bậc thềm\n' +
                    '• Nút bấm gọi nhân viên\n\n';
    } else if (isElderly) {
      responseText = 'Phòng cho người già:\n\n' +
                    '👴 **Tiện nghi:**\n' +
                    '• Phòng tầng thấp (dễ di chuyển)\n' +
                    '• Phòng tắm có tay vịn\n' +
                    '• Giường dễ tiếp cận\n' +
                    '• Nút bấm gọi nhân viên\n\n';
    } else {
      responseText = 'Phòng đặc biệt:\n\n' +
                    '✨ **Tiện nghi:**\n' +
                    '• Phòng rộng rãi\n' +
                    '• Tiện nghi đầy đủ\n' +
                    '• Dễ di chuyển\n\n';
    }
    
    responseText += '📞 **Đặt phòng:**\n' +
                    '• Vui lòng thông báo khi đặt phòng\n' +
                    '• Hotline: 0901 234 567\n' +
                    '• Email: info@rayalpark.com\n\n' +
                    'Chúng tôi sẽ sắp xếp phòng phù hợp nhất! 🏨';
    
    return {
      text: responseText,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.44: Câu hỏi về trẻ sơ sinh
  const babyPattern = lower.match(/(?:trẻ sơ sinh|baby|infant|em bé|newborn).*?(?:đi cùng|accompany|với|with)/i) ||
                     lower.match(/(?:có|có em bé|have).*?(?:trẻ sơ sinh|baby|infant|em bé|newborn)/i) ||
                     lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:trẻ sơ sinh|baby|infant|em bé)/i);
  if (babyPattern) {
    return {
      text: 'Phòng cho gia đình có trẻ sơ sinh:\n\n' +
            '👶 **Chuẩn bị:**\n' +
            '• Có thể cung cấp cũi em bé (theo yêu cầu)\n' +
            '• Phòng rộng rãi để đặt cũi\n' +
            '• Phòng tắm có bồn tắm cho em bé\n\n' +
            '🍼 **Dịch vụ:**\n' +
            '• Có thể đặt nước ấm cho pha sữa\n' +
            '• Room service có thể phục vụ thức ăn cho trẻ\n' +
            '• Dịch vụ giặt ủi quần áo trẻ em\n\n' +
            '📋 **Lưu ý:**\n' +
            '• Trẻ sơ sinh dưới 2 tuổi thường miễn phí\n' +
            '• Vui lòng thông báo khi đặt phòng\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Chúng tôi sẽ chuẩn bị phòng phù hợp nhất cho gia đình bạn! 👨‍👩‍👶',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.45: Câu hỏi về dị ứng/yêu cầu đặc biệt về phòng
  const allergyPattern = lower.match(/(?:dị ứng|allergy|allergic).*?(?:phòng|room)/i) ||
                        lower.match(/(?:phòng|room).*?(?:dị ứng|allergy|allergic)/i) ||
                        lower.match(/(?:yêu cầu đặc biệt|special request).*?(?:phòng|room)/i) ||
                        lower.match(/(?:phòng|room).*?(?:không|no).*?(?:thuốc lá|smoking|hút thuốc)/i);
  if (allergyPattern) {
    const isSmoking = lower.includes('thuốc lá') || lower.includes('smoking') || lower.includes('hút thuốc');
    
    if (isSmoking) {
      return {
        text: 'Phòng không hút thuốc:\n\n' +
              '🚭 **Quy định:**\n' +
              '• Tất cả phòng đều là phòng không hút thuốc\n' +
              '• Có khu vực hút thuốc riêng bên ngoài\n' +
              '• Phí vệ sinh nếu hút thuốc trong phòng\n\n' +
              '✅ **Đảm bảo:**\n' +
              '• Phòng được vệ sinh kỹ lưỡng\n' +
              '• Không có mùi thuốc lá\n' +
              '• Không khí trong lành\n\n' +
              'Bạn có thể yên tâm về môi trường không khói thuốc! 🌿',
        rooms: null,
        hasRooms: false
      };
    } else {
      return {
        text: 'Phòng cho người bị dị ứng:\n\n' +
              '🌿 **Chuẩn bị:**\n' +
              '• Phòng được vệ sinh đặc biệt\n' +
              '• Không sử dụng hóa chất gây dị ứng\n' +
              '• Ga gối vải cotton tự nhiên\n' +
              '• Máy lọc không khí (theo yêu cầu)\n\n' +
              '📋 **Yêu cầu:**\n' +
              '• Vui lòng thông báo loại dị ứng khi đặt phòng\n' +
              '• Chúng tôi sẽ chuẩn bị phòng phù hợp\n\n' +
              '📞 **Liên hệ:**\n' +
              '• Hotline: 0901 234 567\n' +
              '• Email: info@rayalpark.com\n\n' +
              'Chúng tôi sẽ sắp xếp phòng an toàn nhất cho bạn! 🏥',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 1.46: Câu hỏi về giá dịch vụ cụ thể
  // TODO: Re-enable after AI/RAG testing
  /*
  const servicePricePattern = lower.match(/(?:giá|price|phí|fee).*?(?:massage|spa|đưa đón|transfer|giặt ủi|laundry|gym|bể bơi|pool)/i) ||
                              lower.match(/(?:massage|spa|đưa đón|transfer|giặt ủi|laundry).*?(?:giá|price|phí|fee|bao nhiêu)/i);
  if (servicePricePattern) {
    const service = lower.includes('massage') || lower.includes('spa') ? 'spa/massage' :
                   lower.includes('đưa đón') || lower.includes('transfer') ? 'đưa đón sân bay' :
                   lower.includes('giặt') || lower.includes('laundry') ? 'giặt ủi' :
                   lower.includes('gym') ? 'gym' :
                   lower.includes('bể bơi') || lower.includes('pool') ? 'bể bơi' : 'dịch vụ';
    
    return {
      text: `Giá dịch vụ ${service}:\n\n` +
            '💰 **Về giá:**\n' +
            '• Giá dịch vụ có thể thay đổi theo thời gian\n' +
            '• Có các gói dịch vụ khác nhau\n' +
            '• Giá ưu đãi cho khách lưu trú\n\n' +
            '📞 **Để biết giá chính xác:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hỏi lễ tân khi check-in\n\n' +
            'Một số dịch vụ:\n' +
            '• Spa/Massage: Từ 500.000 VNĐ\n' +
            '• Đưa đón sân bay: Từ 300.000 VNĐ\n' +
            '• Giặt ủi: Theo bảng giá\n' +
            '• Gym & Bể bơi: Miễn phí cho khách lưu trú\n\n' +
            'Bạn muốn đặt dịch vụ nào? Tôi sẽ kết nối bạn với bộ phận dịch vụ! 💆',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 1.47: Câu hỏi về mã khuyến mãi cụ thể
  const specificPromoPattern = lower.match(/(?:mã|code).*?([A-Z0-9]{4,10}).*?(?:áp dụng|apply|có thể|can|hợp lệ|valid)/i) ||
                                lower.match(/([A-Z0-9]{4,10}).*?(?:áp dụng|apply|có thể|can|hợp lệ|valid)/i) ||
                                lower.match(/(?:mã khuyến mãi|promo code|promotion).*?(?:nào|which|what).*?(?:đang|currently|hiện tại)/i);
  if (specificPromoPattern) {
    const promoCode = specificPromoPattern[1];
    
    if (promoCode) {
      return {
        text: `Để kiểm tra mã khuyến mãi **${promoCode}**, vui lòng:\n\n` +
              '📋 **Cách kiểm tra:**\n' +
              '• Nhập mã khi đặt phòng trên website\n' +
              '• Mã sẽ được kiểm tra tự động\n' +
              '• Nếu hợp lệ, giá sẽ được giảm tự động\n\n' +
              '📞 **Hỗ trợ:**\n' +
              '• Gọi hotline: 0901 234 567\n' +
              '• Email: info@rayalpark.com\n\n' +
              'Để biết mã khuyến mãi đang có hiệu lực, vui lòng:\n' +
              '• Xem trên website\n' +
              '• Gọi hotline\n' +
              '• Hoặc hỏi khi đặt phòng\n\n' +
              'Bạn có mã khuyến mãi nào khác không? 💰',
        rooms: null,
        hasRooms: false
      };
    } else {
      return {
        text: 'Mã khuyến mãi đang có hiệu lực:\n\n' +
              '📋 **Để biết mã khuyến mãi:**\n' +
              '• Xem trên website\n' +
              '• Gọi hotline: 0901 234 567\n' +
              '• Email: info@rayalpark.com\n' +
              '• Hoặc hỏi khi đặt phòng\n\n' +
              '💡 **Lưu ý:**\n' +
              '• Mã khuyến mãi có thể thay đổi theo thời gian\n' +
              '• Mỗi mã có điều kiện áp dụng riêng\n' +
              '• Nhập mã khi thanh toán để được giảm giá\n\n' +
              'Bạn có mã khuyến mãi nào không? Tôi sẽ hướng dẫn bạn sử dụng! 💰',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 1.48: Câu hỏi về phòng rẻ nhất với điều kiện cụ thể
  const cheapestRoomPattern = lower.match(/(?:phòng|room).*?(?:rẻ nhất|cheapest|giá tốt nhất|best price).*?(?:cho|for).*?(\d+)\s*(?:người|people|guests)/i) ||
                                       lower.match(/(?:phòng|room).*?(?:rẻ nhất|cheapest).*?(\d+)\s*(?:đêm|night)/i) ||
                                       lower.match(/(?:tìm|find|search).*?(?:phòng|room).*?(?:rẻ nhất|cheapest)/i);
  if (cheapestRoomPattern && !hasDates) {
    const guests = cheapestRoomPattern[1] ? parseInt(cheapestRoomPattern[1]) : null;
    const nights = lower.match(/(\d+)\s*(?:đêm|night)/i) ? parseInt(lower.match(/(\d+)\s*(?:đêm|night)/i)[1]) : null;
    
    let responseText = 'Phòng rẻ nhất:\n\n';
    
    if (guests) {
      if (guests <= 2) {
        responseText += '• Phòng Đơn hoặc Đôi: Từ 1.500.000 VNĐ/đêm\n';
      } else if (guests <= 4) {
        responseText += '• Phòng VIP: Từ 4.000.000 VNĐ/đêm\n';
      } else {
        responseText += '• Phòng Suite: Từ 6.000.000 VNĐ/đêm\n';
      }
      responseText += `\nVới ${guests} người, bạn nên chọn phòng phù hợp.\n\n`;
    } else {
      responseText += '• Phòng Standard: Từ 1.500.000 VNĐ/đêm\n';
      responseText += '• Phòng Đơn: Từ 1.500.000 VNĐ/đêm\n\n';
    }
    
    if (nights) {
      const totalPrice = 1500000 * nights;
      responseText += `💰 **Tổng giá dự kiến cho ${nights} đêm:**\n`;
      responseText += `• Từ ${totalPrice.toLocaleString('vi-VN')} VNĐ\n\n`;
    }
    
    responseText += 'Để biết giá chính xác, vui lòng cho biết:\n';
    responseText += '📅 Ngày nhận phòng\n';
    responseText += '📅 Ngày trả phòng\n';
    if (!guests) {
      responseText += '👥 Số lượng khách\n';
    }
    responseText += '\nTôi sẽ tìm phòng rẻ nhất cho bạn! 💰';
    
    return {
      text: responseText,
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 1.49: Câu hỏi về tổng chi phí bao gồm dịch vụ
  // TODO: Re-enable after AI/RAG testing
  /*
  const totalCostPattern = lower.match(/(?:tổng chi phí|total cost|tổng tiền|total price).*?(?:bao gồm|include|có|has).*?(?:dịch vụ|service)/i) ||
                          lower.match(/(?:chi phí|cost|giá).*?(?:bao gồm|include|có|has).*?(?:tất cả|all|everything)/i) ||
                          lower.match(/(?:tổng|total).*?(?:bao nhiêu|how much|giá|price).*?(?:khi|when|nếu|if)/i);
  if (totalCostPattern) {
    return {
      text: 'Tổng chi phí bao gồm:\n\n' +
            '✅ **Đã bao gồm trong giá phòng:**\n' +
            '• VAT (10%)\n' +
            '• WiFi miễn phí\n' +
            '• Dịch vụ cơ bản\n' +
            '• Bảo vệ 24/7\n' +
            '• Dọn phòng hàng ngày\n\n' +
            '💰 **Có thể phát sinh thêm:**\n' +
            '• Bữa sáng (nếu không bao gồm)\n' +
            '• Dịch vụ spa, massage\n' +
            '• Đưa đón sân bay\n' +
            '• Giặt ủi\n' +
            '• Giường phụ\n' +
            '• Phụ thu trẻ em (nếu có)\n\n' +
            '📋 **Để biết tổng chi phí chính xác:**\n' +
            '• Vui lòng đặt phòng và chọn dịch vụ\n' +
            '• Hoặc gọi hotline: 0901 234 567\n\n' +
            'Bạn muốn đặt phòng với dịch vụ gì? Tôi sẽ tính tổng chi phí cho bạn! 💳',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 1.50: Câu hỏi về giảm giá khi đặt nhiều phòng
  const groupDiscountPattern = lower.match(/(?:đặt|book).*?(\d+)\s*(?:phòng|room).*?(?:giảm giá|discount|ưu đãi)/i) ||
                             lower.match(/(?:giảm giá|discount|ưu đãi).*?(?:khi|when|nếu|if).*?(?:đặt|book).*?(\d+)\s*(?:phòng|room)/i) ||
                             lower.match(/(?:đặt|book).*?(?:nhiều|multiple).*?(?:phòng|room).*?(?:có|có được|get).*?(?:giảm|discount)/i);
  if (groupDiscountPattern) {
    const roomCount = groupDiscountPattern[1] ? parseInt(groupDiscountPattern[1]) : 2;
    
    return {
      text: `Đặt ${roomCount} phòng trở lên:\n\n` +
            '💰 **Ưu đãi:**\n' +
            '• Có thể có giá ưu đãi cho đặt nhiều phòng\n' +
            '• Giá tùy theo số lượng và thời gian\n' +
            '• Có thể áp dụng mã khuyến mãi\n\n' +
            '📋 **Để biết giá ưu đãi:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi khi đặt phòng\n\n' +
            'Vui lòng cho biết:\n' +
            '• Số lượng phòng\n' +
            '• Ngày nhận phòng\n' +
            '• Ngày trả phòng\n' +
            '• Số lượng khách/phòng\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng để có giá tốt nhất! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.51: User cung cấp thông tin cá nhân (tên, email, phone) - Template response
  const personalInfoPattern = lower.match(/(?:tên|name|họ tên|full name).*?[:\-]?\s*([A-Za-zÀ-ỹ\s]+).*?(?:email|e-mail).*?[:\-]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+).*?(?:điện thoại|phone|số điện thoại|sđt).*?[:\-]?\s*([0-9+\s-]+)/i) ||
                              lower.match(/([A-Za-zÀ-ỹ\s]+).*?[,;]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+).*?[,;]?\s*([0-9+\s-]+)/i) ||
                              lower.match(/(?:email|e-mail).*?[:\-]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+).*?(?:điện thoại|phone|số điện thoại|sđt).*?[:\-]?\s*([0-9+\s-]+)/i);
  if (personalInfoPattern && (context.selectedRoom || context.bookingContext?.roomId)) {
    // User đang cung cấp thông tin để đặt phòng
    // Cập nhật bookingContext
    context.bookingContext = context.bookingContext || {};
    context.bookingContext.fullName = personalInfoPattern[1]?.trim();
    context.bookingContext.email = personalInfoPattern[2]?.trim();
    context.bookingContext.phone = personalInfoPattern[3]?.trim();

    // Nếu đã có roomId + dates, tạo booking link ngay để user bấm
    let quickBookingLink = null;
    if (context.bookingContext.roomId && context.bookingContext.checkInDate && context.bookingContext.checkOutDate) {
      quickBookingLink = createBookingLink({
        roomId: context.bookingContext.roomId,
        checkInDate: context.bookingContext.checkInDate,
        checkOutDate: context.bookingContext.checkOutDate,
        roomQuantity: context.bookingContext.roomQuantity,
        guests: context.bookingContext.guests || context.bookingContext.maxOccupancy,
        fullName: context.bookingContext.fullName,
        email: context.bookingContext.email,
        phone: context.bookingContext.phone,
        note: context.bookingContext.note
      });
    }

    return {
      text: 'Cảm ơn bạn đã cung cấp thông tin!\n\n' +
      (quickBookingLink
        ? `Tôi đã tạo link đặt phòng cho bạn. Vui lòng nhấn vào [Xem link đặt phòng](booking:${quickBookingLink}) để hoàn tất đặt phòng. Tất cả thông tin bạn đã cung cấp đã được điền sẵn.\n\nSau khi bạn hoàn tất, hệ thống sẽ gửi email xác nhận tự động.`
        : 'Tôi sẽ tạo link đặt phòng với thông tin bạn đã cung cấp. Khi có đủ ngày nhận/trả phòng, tôi sẽ gửi link để bạn hoàn tất và nhận email xác nhận.') +
      '\n\n💳 Có thể thanh toán trực tuyến hoặc tại khách sạn khi check-in.',
      rooms: null,
      hasRooms: false,
      bookingLink: quickBookingLink || null
    };
    
  }

  // Pattern 1.52: User xác nhận đặt phòng ("đặt luôn", "ok", "đồng ý", "yes")
  const confirmBookingPattern = lower.match(/(?:đặt luôn|ok|đồng ý|yes|okay|xác nhận|confirm|đặt phòng này|đặt phòng đó|được|chấp nhận|accept|agree|chấp thuận)/i);
  if (confirmBookingPattern && (context.selectedRoom || context.bookingContext?.roomId)) {
    const bookingContext = context.bookingContext || {};
    const hasPersonalInfo = bookingContext.fullName && bookingContext.email && bookingContext.phone;
    
    if (!hasPersonalInfo) {
      return {
        text: 'Để hoàn tất đặt phòng, vui lòng cung cấp:\n\n' +
              '👤 **Họ và tên:**\n' +
              '📧 **Email:**\n' +
              '📞 **Số điện thoại:**\n\n' +
              'Sau khi có đủ thông tin, tôi sẽ tạo đơn đặt phòng cho bạn ngay! 📝',
        rooms: null,
        hasRooms: false
      };
    }
    
    // ✅ CHỈ TẠO LINK ĐẶT PHÒNG - KHÔNG tạo booking trong chat
    // Booking sẽ được tạo khi user submit form trên FE
    if (bookingContext.roomId && bookingContext.checkInDate && bookingContext.checkOutDate) {
      const quickBookingLink = createBookingLink({
        roomId: bookingContext.roomId,
        checkInDate: bookingContext.checkInDate,
        checkOutDate: bookingContext.checkOutDate,
        roomQuantity: bookingContext.roomQuantity || 1,
        guests: bookingContext.guests || bookingContext.maxOccupancy,
        fullName: bookingContext.fullName,
        email: bookingContext.email,
        phone: bookingContext.phone,
        note: bookingContext.note
      });

      return {
        text: 'Tuyệt vời! Mình đã chuẩn bị link đặt phòng cho bạn với thông tin đã cung cấp.\n\n' +
              'Vui lòng kiểm tra lại thông tin trên form và nhấn **Đặt phòng / Thanh toán** để hoàn tất. ' +
              'Sau khi hoàn tất, hệ thống sẽ gửi email xác nhận cho bạn.\n\n' +
              `📝 [Xem link đặt phòng](booking:${quickBookingLink})`,
        rooms: null,
        hasRooms: false,
        bookingLink: quickBookingLink
      };
    }

    // Nếu chưa có ngày → hướng dẫn bổ sung
    return {
      text: 'Để mình tạo link đặt phòng chính xác, bạn vui lòng cho mình biết thêm:\n' +
            '- Ngày nhận phòng\n' +
            '- Ngày trả phòng\n' +
            '- Số lượng khách (người lớn / trẻ em nếu có)',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.53: Câu hỏi về đề xuất/tư vấn phòng
  const recommendationPattern = lower.match(/(?:đề xuất|tư vấn|gợi ý|suggest|recommend).*?(?:phòng|room)/i) ||
                                lower.match(/(?:phòng|room).*?(?:nào|which|what).*?(?:tốt|best|phù hợp|suitable)/i) ||
                                lower.match(/(?:bạn|you).*?(?:đề xuất|tư vấn|gợi ý|suggest|recommend)/i);
  if (recommendationPattern && !hasDates) {
    return {
      text: 'Tôi có thể đề xuất phòng phù hợp nhất cho bạn!\n\n' +
            '💡 **Để tư vấn chính xác, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n' +
            '💰 Ngân sách (nếu có)\n' +
            '🌅 Yêu cầu đặc biệt (view, tiện nghi, v.v.)\n\n' +
            'Sau khi có thông tin, tôi sẽ đề xuất phòng phù hợp nhất! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.54: Câu hỏi về phòng phù hợp nhất
  const bestRoomPattern = lower.match(/(?:phòng|room).*?(?:phù hợp nhất|best|tốt nhất|suitable|recommended)/i) ||
                         lower.match(/(?:nên|should|nên chọn).*?(?:phòng|room).*?(?:nào|which|what)/i);
  if (bestRoomPattern && !hasDates) {
    return {
      text: 'Để đề xuất phòng phù hợp nhất, vui lòng cho biết:\n\n' +
            '📅 **Ngày nhận phòng** (check-in)\n' +
            '📅 **Ngày trả phòng** (check-out)\n' +
            '👥 **Số lượng khách**\n' +
            '💰 **Ngân sách** (nếu có)\n' +
            '🌅 **Yêu cầu đặc biệt** (view, tiện nghi, v.v.)\n\n' +
            'Sau khi có thông tin, tôi sẽ đề xuất phòng tốt nhất cho bạn! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.55: Câu hỏi về phòng cho mục đích cụ thể (công tác, nghỉ dưỡng, honeymoon)
  const purposePattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:công tác|business|nghỉ dưỡng|vacation|honeymoon|tuần trăng mật|wedding|kỷ niệm|anniversary)/i) ||
                        lower.match(/(?:công tác|business|nghỉ dưỡng|vacation|honeymoon).*?(?:phòng|room)/i);
  if (purposePattern) {
    const purpose = lower.includes('công tác') || lower.includes('business') ? 'công tác' :
                   lower.includes('honeymoon') || lower.includes('tuần trăng mật') ? 'tuần trăng mật' :
                   lower.includes('kỷ niệm') || lower.includes('anniversary') ? 'kỷ niệm' : 'nghỉ dưỡng';
    
    let responseText = '';
    if (purpose === 'công tác') {
      responseText = 'Phòng phù hợp cho công tác:\n\n' +
                    '💼 **Gợi ý:**\n' +
                    '• Phòng có bàn làm việc\n' +
                    '• WiFi tốc độ cao\n' +
                    '• Yên tĩnh, dễ tập trung\n' +
                    '• Gần khu vực họp (nếu cần)\n\n' +
                    '💡 **Phòng đề xuất:**\n' +
                    '• Phòng Deluxe hoặc VIP\n' +
                    '• View thành phố (tiện cho công tác)\n\n';
    } else if (purpose === 'tuần trăng mật') {
      responseText = 'Phòng phù hợp cho tuần trăng mật:\n\n' +
                    '💑 **Gợi ý:**\n' +
                    '• Phòng Suite (không gian rộng rãi)\n' +
                    '• View đẹp (view biển hoặc view thành phố)\n' +
                    '• Tiện nghi cao cấp\n' +
                    '• Dịch vụ đặc biệt (trang trí phòng, champagne)\n\n';
    } else if (purpose === 'kỷ niệm') {
      responseText = 'Phòng phù hợp cho kỷ niệm:\n\n' +
                    '🎉 **Gợi ý:**\n' +
                    '• Phòng VIP hoặc Suite\n' +
                    '• View đẹp\n' +
                    '• Dịch vụ đặc biệt (trang trí, bánh kem)\n\n';
    } else {
      responseText = 'Phòng phù hợp cho nghỉ dưỡng:\n\n' +
                    '🏖️ **Gợi ý:**\n' +
                    '• Phòng có view đẹp\n' +
                    '• Tiện nghi đầy đủ\n' +
                    '• Không gian thoải mái\n\n';
    }
    
    responseText += 'Để tìm phòng phù hợp, vui lòng cho biết:\n' +
                    '📅 Ngày nhận phòng\n' +
                    '📅 Ngày trả phòng\n' +
                    '👥 Số lượng khách\n\n' +
                    'Tôi sẽ tìm phòng tốt nhất cho bạn! 🏨';
    
    return {
      text: responseText,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.56: Câu hỏi về phòng có sẵn ngay hôm nay/ngày mai
  const immediatePattern = lower.match(/(?:phòng|room).*?(?:hôm nay|today|ngày mai|tomorrow|ngay|immediately)/i) ||
                          lower.match(/(?:có|có thể|can).*?(?:đặt|book).*?(?:hôm nay|today|ngày mai|tomorrow)/i);
  if (immediatePattern) {
    return {
      text: 'Để kiểm tra phòng trống hôm nay/ngày mai, vui lòng cho biết:\n\n' +
            '📅 **Ngày nhận phòng** (hôm nay hoặc ngày mai)\n' +
            '📅 **Ngày trả phòng**\n' +
            '👥 **Số lượng khách**\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Đặt phòng gần ngày có thể có giá cao hơn\n' +
            '• Nên đặt sớm để có giá tốt và nhiều lựa chọn\n\n' +
            'Tôi sẽ kiểm tra phòng trống ngay cho bạn! 🔍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.57: Câu hỏi về phòng có sẵn trong tuần/tháng này
  const thisWeekMonthPattern = lower.match(/(?:phòng|room).*?(?:tuần này|this week|tháng này|this month)/i) ||
                               lower.match(/(?:có|có thể|can).*?(?:đặt|book).*?(?:tuần này|this week|tháng này|this month)/i);
  if (thisWeekMonthPattern) {
    return {
      text: 'Để kiểm tra phòng trống trong tuần/tháng này, vui lòng cho biết:\n\n' +
            '📅 **Ngày nhận phòng** (khoảng thời gian cụ thể)\n' +
            '📅 **Ngày trả phòng**\n' +
            '👥 **Số lượng khách**\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Cuối tuần thường đông hơn\n' +
            '• Đặt sớm để có giá tốt\n\n' +
            'Tôi sẽ kiểm tra phòng trống cho bạn! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.58: Câu hỏi về phòng có sẵn vào dịp lễ/Tết
  const holidayPattern = lower.match(/(?:phòng|room).*?(?:tết|new year|lễ|holiday|festival)/i) ||
                        lower.match(/(?:có|có thể|can).*?(?:đặt|book).*?(?:tết|new year|lễ|holiday)/i);
  if (holidayPattern) {
    return {
      text: 'Đặt phòng vào dịp lễ/Tết:\n\n' +
            '🎉 **Lưu ý:**\n' +
            '• Dịp lễ/Tết thường đông, nên đặt sớm\n' +
            '• Giá có thể cao hơn bình thường\n' +
            '• Có thể có yêu cầu đặt tối thiểu số đêm\n\n' +
            '📋 **Để đặt phòng, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ kiểm tra phòng trống và giá cho bạn! 🎊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.59: Câu hỏi về phòng có sẵn vào cuối tuần
  const weekendPattern = lower.match(/(?:phòng|room).*?(?:cuối tuần|weekend)/i) ||
                         lower.match(/(?:có|có thể|can).*?(?:đặt|book).*?(?:cuối tuần|weekend)/i);
  if (weekendPattern && !hasDates) {
    return {
      text: 'Đặt phòng cuối tuần:\n\n' +
            '📅 **Lưu ý:**\n' +
            '• Cuối tuần thường đông hơn\n' +
            '• Giá có thể cao hơn ngày thường\n' +
            '• Nên đặt sớm để có giá tốt\n\n' +
            '📋 **Để kiểm tra phòng trống, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng (thứ 6 hoặc thứ 7)\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.60: Câu hỏi về phòng có sẵn vào mùa cao điểm/thấp điểm
  const seasonPattern = lower.match(/(?:phòng|room).*?(?:mùa cao điểm|peak season|mùa thấp điểm|low season)/i) ||
                       lower.match(/(?:mùa|season).*?(?:cao điểm|peak|thấp điểm|low).*?(?:phòng|room)/i);
  if (seasonPattern) {
    return {
      text: 'Mùa cao điểm và thấp điểm:\n\n' +
            '📅 **Mùa cao điểm:**\n' +
            '• Tết, lễ hội, cuối tuần\n' +
            '• Giá cao hơn, nên đặt sớm\n\n' +
            '📅 **Mùa thấp điểm:**\n' +
            '• Ngày thường\n' +
            '• Giá tốt hơn, nhiều lựa chọn\n\n' +
            '💡 **Lời khuyên:**\n' +
            '• Đặt sớm để có giá tốt\n' +
            '• Tránh đặt vào phút chót\n\n' +
            'Để biết giá cụ thể, vui lòng cho biết ngày đặt phòng! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.61: Câu hỏi về phòng có sẵn cho nhóm lớn
  const largeGroupPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(\d+)\s*(?:người|people|guests).*?(?:trở lên|more|above)/i) ||
                           lower.match(/(?:nhóm lớn|large group|đoàn lớn).*?(?:phòng|room)/i);
  if (largeGroupPattern) {
    const groupSize = largeGroupPattern[1] ? parseInt(largeGroupPattern[1]) : 10;
    
    return {
      text: `Đặt phòng cho nhóm ${groupSize} người trở lên:\n\n` +
            '👥 **Gợi ý:**\n' +
            '• Đặt nhiều phòng Suite hoặc VIP\n' +
            '• Có thể có giá ưu đãi cho nhóm lớn\n' +
            '• Có thể sắp xếp phòng gần nhau\n\n' +
            '📋 **Để đặt phòng nhóm, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết:\n' +
            '  - Số lượng phòng\n' +
            '  - Ngày nhận phòng\n' +
            '  - Ngày trả phòng\n' +
            '  - Số lượng khách/phòng\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng để có giá tốt nhất! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.62: Câu hỏi về phòng có sẵn cho sự kiện đặc biệt
  const specialEventPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:sự kiện|event|tiệc|party|wedding|hôn nhân)/i) ||
                             lower.match(/(?:sự kiện|event|tiệc|party).*?(?:phòng|room)/i);
  if (specialEventPattern) {
    return {
      text: 'Đặt phòng cho sự kiện đặc biệt:\n\n' +
            '🎉 **Dịch vụ:**\n' +
            '• Đặt nhiều phòng cho khách mời\n' +
            '• Phòng tổ chức sự kiện\n' +
            '• Dịch vụ trang trí, ẩm thực\n\n' +
            '📋 **Để đặt phòng, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết:\n' +
            '  - Loại sự kiện\n' +
            '  - Số lượng khách\n' +
            '  - Ngày giờ\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận sự kiện! 🎊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.63: Câu hỏi về phòng có sẵn cho khách quốc tế
  const internationalPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:khách quốc tế|international|foreign|nước ngoài)/i) ||
                               lower.match(/(?:khách quốc tế|international|foreign).*?(?:phòng|room)/i);
  if (internationalPattern) {
    return {
      text: 'Phòng cho khách quốc tế:\n\n' +
            '🌍 **Dịch vụ:**\n' +
            '• Hỗ trợ đa ngôn ngữ (Tiếng Anh, Tiếng Việt)\n' +
            '• Đổi tiền tệ\n' +
            '• Hướng dẫn du lịch\n' +
            '• Dịch vụ đưa đón sân bay\n\n' +
            '📋 **Để đặt phòng, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🌏',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.64: Câu hỏi về phòng có sẵn cho khách thường xuyên
  const regularGuestPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:khách thường xuyên|regular|loyal|thành viên|member)/i) ||
                             lower.match(/(?:khách thường xuyên|regular|loyal|thành viên|member).*?(?:phòng|room)/i);
  if (regularGuestPattern) {
    return {
      text: 'Ưu đãi cho khách thường xuyên:\n\n' +
            '⭐ **Chương trình:**\n' +
            '• Giá ưu đãi cho khách quay lại\n' +
            '• Tích điểm thưởng\n' +
            '• Ưu tiên phòng đẹp\n\n' +
            '📋 **Để biết ưu đãi, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc đăng ký thành viên trên website\n\n' +
            'Bạn có phải là khách thường xuyên không? Tôi sẽ kiểm tra ưu đãi cho bạn! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.65: Câu hỏi về phòng có sẵn cho khách doanh nghiệp
  const corporatePattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:doanh nghiệp|corporate|business|công ty|company)/i) ||
                          lower.match(/(?:doanh nghiệp|corporate|business|công ty|company).*?(?:phòng|room)/i);
  if (corporatePattern) {
    return {
      text: 'Đặt phòng cho doanh nghiệp:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Giá ưu đãi cho đặt nhiều phòng\n' +
            '• Hóa đơn VAT\n' +
            '• Phòng họp\n' +
            '• Dịch vụ công tác\n\n' +
            '📋 **Để đặt phòng, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết:\n' +
            '  - Tên công ty\n' +
            '  - Số lượng phòng\n' +
            '  - Ngày đặt\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận doanh nghiệp! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.66: Câu hỏi về phòng có sẵn cho khách VIP
  const vipGuestPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:khách vip|vip guest|khách đặc biệt|special guest)/i) ||
                         lower.match(/(?:khách vip|vip guest|khách đặc biệt|special guest).*?(?:phòng|room)/i);
  if (vipGuestPattern) {
    return {
      text: 'Phòng cho khách VIP:\n\n' +
            '⭐ **Dịch vụ VIP:**\n' +
            '• Phòng Suite cao cấp\n' +
            '• Dịch vụ đặc biệt\n' +
            '• Ưu tiên check-in/check-out\n' +
            '• Dịch vụ cá nhân hóa\n\n' +
            '📋 **Để đặt phòng VIP, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết yêu cầu đặc biệt\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận VIP! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.67: Câu hỏi về phòng có sẵn cho khách đoàn
  const tourGroupPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:đoàn|tour group|group|nhóm)/i) ||
                          lower.match(/(?:đoàn|tour group|group|nhóm).*?(?:phòng|room)/i);
  if (tourGroupPattern) {
    return {
      text: 'Đặt phòng cho đoàn:\n\n' +
            '👥 **Dịch vụ:**\n' +
            '• Giá ưu đãi cho đặt nhiều phòng\n' +
            '• Sắp xếp phòng gần nhau\n' +
            '• Dịch vụ đưa đón\n' +
            '• Hướng dẫn du lịch\n\n' +
            '📋 **Để đặt phòng, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết:\n' +
            '  - Số lượng phòng\n' +
            '  - Ngày đặt\n' +
            '  - Số lượng khách\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.68: Câu hỏi về phòng có sẵn cho khách dài hạn
  const longStayPattern = lower.match(/(?:phòng|room).*?(?:cho|for).*?(?:dài hạn|long stay|dài ngày|extended stay)/i) ||
                         lower.match(/(?:dài hạn|long stay|dài ngày|extended stay).*?(?:phòng|room)/i);
  if (longStayPattern) {
    return {
      text: 'Đặt phòng dài hạn:\n\n' +
            '📅 **Ưu đãi:**\n' +
            '• Giá ưu đãi cho đặt dài hạn\n' +
            '• Dịch vụ đặc biệt\n' +
            '• Linh hoạt về thanh toán\n\n' +
            '📋 **Để biết giá ưu đãi, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc cho biết:\n' +
            '  - Số đêm/ngày\n' +
            '  - Ngày bắt đầu\n' +
            '  - Số lượng khách\n\n' +
            'Tôi sẽ kết nối bạn với bộ phận đặt phòng! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.69: Câu hỏi về phòng có sẵn cho khách đặt last minute
  const lastMinutePattern = lower.match(/(?:phòng|room).*?(?:last minute|phút chót|gần ngày|sát ngày)/i) ||
                           lower.match(/(?:last minute|phút chót|gần ngày|sát ngày).*?(?:phòng|room)/i);
  if (lastMinutePattern) {
    return {
      text: 'Đặt phòng last minute:\n\n' +
            '⏰ **Lưu ý:**\n' +
            '• Đặt gần ngày có thể có giá cao hơn\n' +
            '• Ít lựa chọn phòng hơn\n' +
            '• Nên đặt sớm để có giá tốt\n\n' +
            '📋 **Để kiểm tra phòng trống, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ kiểm tra phòng trống ngay cho bạn! 🔍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.70: Câu hỏi về phòng có sẵn cho khách đặt sớm
  const earlyBookingPattern = lower.match(/(?:phòng|room).*?(?:đặt sớm|early booking|trước|in advance)/i) ||
                             lower.match(/(?:đặt sớm|early booking|trước|in advance).*?(?:phòng|room)/i);
  if (earlyBookingPattern) {
    return {
      text: 'Đặt phòng sớm:\n\n' +
            '💡 **Lợi ích:**\n' +
            '• Giá tốt hơn\n' +
            '• Nhiều lựa chọn phòng\n' +
            '• Đảm bảo phòng yêu thích\n' +
            '• Có thể áp dụng mã khuyến mãi\n\n' +
            '📋 **Để đặt phòng, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng tốt nhất cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.71: Câu hỏi về phòng có sẵn cho khách đặt theo gói
  const packagePattern = lower.match(/(?:phòng|room).*?(?:gói|package|combo)/i) ||
                        lower.match(/(?:gói|package|combo).*?(?:phòng|room)/i);
  if (packagePattern) {
    return {
      text: 'Đặt phòng theo gói:\n\n' +
            '📦 **Gói dịch vụ:**\n' +
            '• Gói phòng + bữa sáng\n' +
            '• Gói phòng + spa\n' +
            '• Gói phòng + tour\n' +
            '• Gói phòng + dịch vụ đặc biệt\n\n' +
            '📋 **Để biết gói dịch vụ, vui lòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc xem trên website\n\n' +
            'Bạn muốn gói dịch vụ nào? Tôi sẽ tư vấn cho bạn! 📦',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.72: Câu hỏi về phòng có sẵn cho khách đặt theo chương trình khuyến mãi
  const promoPackagePattern = lower.match(/(?:phòng|room).*?(?:chương trình|program|khuyến mãi|promotion)/i) ||
                             lower.match(/(?:chương trình|program|khuyến mãi|promotion).*?(?:phòng|room)/i);
  if (promoPackagePattern) {
    return {
      text: 'Chương trình khuyến mãi:\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giảm giá phòng\n' +
            '• Tặng dịch vụ\n' +
            '• Combo giá tốt\n\n' +
            '📋 **Để biết ưu đãi, vui lòng:**\n' +
            '• Xem trên website\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Bạn có mã khuyến mãi không? Tôi sẽ kiểm tra cho bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.73: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu đặc biệt
  const specialRequirementPattern = lower.match(/(?:phòng|room).*?(?:yêu cầu đặc biệt|special requirement|đặc biệt|special)/i) ||
                                   lower.match(/(?:yêu cầu đặc biệt|special requirement|đặc biệt|special).*?(?:phòng|room)/i);
  if (specialRequirementPattern && !hasDates) {
    return {
      text: 'Phòng theo yêu cầu đặc biệt:\n\n' +
            '✨ **Dịch vụ:**\n' +
            '• Phòng cho người khuyết tật\n' +
            '• Phòng không hút thuốc\n' +
            '• Phòng cho người dị ứng\n' +
            '• Phòng cho trẻ em\n' +
            '• Phòng view đẹp\n' +
            '• Phòng yên tĩnh\n\n' +
            '📋 **Để đặt phòng, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n' +
            '✨ Yêu cầu đặc biệt\n\n' +
            'Tôi sẽ tìm phòng phù hợp nhất cho bạn! ✨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.74: Câu hỏi về phòng có sẵn cho khách đặt theo view cụ thể
  const specificViewPattern = lower.match(/(?:phòng|room).*?(?:view|hướng).*?(?:thành phố|city|núi|mountain|biển|sea|ocean|sông|river|vườn|garden|park)/i) ||
                             lower.match(/(?:view|hướng).*?(?:thành phố|city|núi|mountain|biển|sea|ocean|sông|river|vườn|garden|park).*?(?:phòng|room)/i);
  if (specificViewPattern && !hasDates) {
    const view = specificViewPattern[1] || (lower.match(/(?:view|hướng).*?(thành phố|city|núi|mountain|biển|sea|ocean|sông|river|vườn|garden|park)/i)?.[1]);
    
    return {
      text: `Phòng view ${view || 'đẹp'}:\n\n` +
            '🌅 **View có sẵn:**\n' +
            '• View biển\n' +
            '• View thành phố\n' +
            '• View núi\n' +
            '• View vườn\n\n' +
            `📋 **Để kiểm tra phòng view ${view || 'đẹp'}, vui lòng cho biết:**\n` +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            `Tôi sẽ tìm phòng view ${view || 'đẹp'} cho bạn! 🌅`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.75: Câu hỏi về phòng có sẵn cho khách đặt theo tiện nghi cụ thể
  const specificAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:bồn tắm|bathtub|ban công|balcony|minibar|tủ lạnh|refrigerator|máy lạnh|air conditioner|tivi|tv|wifi|internet|bếp|kitchen|máy giặt|washing machine)/i) ||
                                 lower.match(/(?:bồn tắm|bathtub|ban công|balcony|minibar|tủ lạnh|refrigerator|máy lạnh|air conditioner|tivi|tv|wifi|internet|bếp|kitchen|máy giặt|washing machine).*?(?:phòng|room)/i);
  if (specificAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi đặc biệt:\n\n' +
            '✨ **Tiện nghi có sẵn:**\n' +
            '• Bồn tắm\n' +
            '• Ban công\n' +
            '• Minibar\n' +
            '• Tủ lạnh\n' +
            '• Máy lạnh\n' +
            '• TV màn hình phẳng\n' +
            '• WiFi\n' +
            '• Bếp mini\n' +
            '• Máy giặt\n\n' +
            '📋 **Để tìm phòng có tiện nghi cụ thể, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n' +
            '✨ Tiện nghi mong muốn\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! ✨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.76: Câu hỏi về phòng có sẵn cho khách đặt theo giá cụ thể
  const specificPricePattern = lower.match(/(?:phòng|room).*?(?:giá|price).*?(\d+)\s*(?:triệu|million|tr|m|nghìn|thousand|k)/i) ||
                              lower.match(/(?:giá|price).*?(\d+)\s*(?:triệu|million|tr|m|nghìn|thousand|k).*?(?:phòng|room)/i);
  if (specificPricePattern && !hasDates) {
    const priceStr = specificPricePattern[1];
    const price = parseInt(priceStr);
    const unit = lower.includes('triệu') || lower.includes('million') || lower.includes('tr') || lower.includes('m') ? 'triệu' : 'nghìn';
    const priceValue = unit === 'triệu' ? price * 1000000 : price * 1000;
    
    return {
      text: `Phòng giá ${priceStr} ${unit} VNĐ:\n\n` +
            '💰 **Gợi ý:**\n' +
            `${priceValue >= 6000000 ? '• Phòng Suite\n' : ''}` +
            `${priceValue >= 4000000 && priceValue < 6000000 ? '• Phòng VIP\n' : ''}` +
            `${priceValue >= 3000000 && priceValue < 4000000 ? '• Phòng Deluxe\n' : ''}` +
            `${priceValue < 3000000 ? '• Phòng Standard hoặc Đôi\n' : ''}` +
            '\n📋 **Để tìm phòng phù hợp, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng tốt nhất trong ngân sách của bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.77: Câu hỏi về phòng có sẵn cho khách đặt theo sức chứa cụ thể
  const specificCapacityPattern = lower.match(/(?:phòng|room).*?(?:cho|for|sức chứa|capacity).*?(\d+)\s*(?:người|people|guests)/i) ||
                                 lower.match(/(?:sức chứa|capacity).*?(\d+)\s*(?:người|people|guests).*?(?:phòng|room)/i);
  if (specificCapacityPattern && !hasDates) {
    const capacity = parseInt(specificCapacityPattern[1]);
    
    let roomSuggestion = '';
    if (capacity <= 2) {
      roomSuggestion = 'Phòng Đơn hoặc Đôi (1-2 người)';
    } else if (capacity <= 4) {
      roomSuggestion = 'Phòng VIP (2-4 người)';
    } else if (capacity <= 6) {
      roomSuggestion = 'Phòng Suite (4-6 người)';
    } else {
      roomSuggestion = 'Nhiều phòng hoặc phòng lớn';
    }
    
    return {
      text: `Phòng cho ${capacity} người:\n\n` +
            `💡 **Gợi ý:** ${roomSuggestion}\n\n` +
            '📋 **Để tìm phòng phù hợp, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n\n' +
            'Tôi sẽ tìm phòng có sức chứa phù hợp cho bạn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.78: Câu hỏi về phòng có sẵn cho khách đặt theo loại phòng cụ thể
  const specificRoomTypePattern = lower.match(/(?:phòng|room).*?(?:loại|type).*?(?:đơn|single|đôi|double|deluxe|vip|suite|standard)/i) ||
                                 lower.match(/(?:loại|type).*?(?:đơn|single|đôi|double|deluxe|vip|suite|standard).*?(?:phòng|room)/i);
  if (specificRoomTypePattern && !hasDates) {
    const roomType = specificRoomTypePattern[1] || lower.match(/(?:đơn|single|đôi|double|deluxe|vip|suite|standard)/i)?.[0];
    
    let roomInfo = '';
    if (roomType?.includes('đơn') || roomType?.includes('single')) {
      roomInfo = 'Phòng Đơn: Từ 1.500.000 VNĐ/đêm, sức chứa 1-2 người';
    } else if (roomType?.includes('đôi') || roomType?.includes('double')) {
      roomInfo = 'Phòng Đôi: Từ 2.500.000 VNĐ/đêm, sức chứa 2 người';
    } else if (roomType?.includes('deluxe')) {
      roomInfo = 'Phòng Deluxe: Từ 3.000.000 VNĐ/đêm, sức chứa 2-3 người';
    } else if (roomType?.includes('vip')) {
      roomInfo = 'Phòng VIP: Từ 4.000.000 VNĐ/đêm, sức chứa 2-4 người';
    } else if (roomType?.includes('suite')) {
      roomInfo = 'Phòng Suite: Từ 6.000.000 VNĐ/đêm, sức chứa 4-6 người';
    } else if (roomType?.includes('standard')) {
      roomInfo = 'Phòng Standard: Từ 1.500.000 VNĐ/đêm, sức chứa 1-2 người';
    }
    
    return {
      text: `${roomInfo || 'Thông tin phòng'}\n\n` +
            '📋 **Để kiểm tra phòng trống và giá chính xác, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.79: Câu hỏi về phòng có sẵn cho khách đặt theo số đêm cụ thể
  const specificNightsPattern = lower.match(/(?:phòng|room).*?(\d+)\s*(?:đêm|night)/i) ||
                               lower.match(/(?:đặt|book).*?(\d+)\s*(?:đêm|night).*?(?:phòng|room)/i);
  if (specificNightsPattern && !hasDates) {
    const nights = parseInt(specificNightsPattern[1]);
    
    return {
      text: `Đặt phòng ${nights} đêm:\n\n` +
            '📅 **Để tìm phòng phù hợp, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '👥 Số lượng khách\n\n' +
            `💡 **Lưu ý:** Đặt ${nights} đêm có thể có giá ưu đãi.\n\n` +
            'Tôi sẽ tìm phòng tốt nhất cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.80: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về không gian
  const spaceRequirementPattern = lower.match(/(?:phòng|room).*?(?:rộng|spacious|large|không gian lớn|big)/i) ||
                                 lower.match(/(?:rộng|spacious|large|không gian lớn|big).*?(?:phòng|room)/i);
  if (spaceRequirementPattern && !hasDates) {
    return {
      text: 'Phòng rộng rãi:\n\n' +
            '🏨 **Gợi ý:**\n' +
            '• Phòng Suite (không gian lớn nhất)\n' +
            '• Phòng VIP (không gian rộng)\n' +
            '• Phòng Deluxe (không gian thoải mái)\n\n' +
            '📋 **Để tìm phòng rộng rãi, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng rộng rãi nhất cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.81: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi cao cấp
  const luxuryRequirementPattern = lower.match(/(?:phòng|room).*?(?:cao cấp|luxury|premium|sang trọng)/i) ||
                                  lower.match(/(?:cao cấp|luxury|premium|sang trọng).*?(?:phòng|room)/i);
  if (luxuryRequirementPattern && !hasDates) {
    return {
      text: 'Phòng cao cấp:\n\n' +
            '⭐ **Gợi ý:**\n' +
            '• Phòng Suite (cao cấp nhất)\n' +
            '• Phòng VIP (tiện nghi cao cấp)\n' +
            '• View đẹp, tiện nghi đầy đủ\n\n' +
            '📋 **Để tìm phòng cao cấp, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng cao cấp nhất cho bạn! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.82: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về giá rẻ
  const budgetRequirementPattern = lower.match(/(?:phòng|room).*?(?:rẻ|cheap|budget|giá tốt|economy)/i) ||
                                   lower.match(/(?:rẻ|cheap|budget|giá tốt|economy).*?(?:phòng|room)/i);
  if (budgetRequirementPattern && !hasDates) {
    return {
      text: 'Phòng giá tốt:\n\n' +
            '💰 **Gợi ý:**\n' +
            '• Phòng Standard (giá tốt nhất)\n' +
            '• Phòng Đơn (giá hợp lý)\n' +
            '• Đặt sớm để có giá tốt\n\n' +
            '📋 **Để tìm phòng giá tốt, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng giá tốt nhất cho bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.83: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về vị trí
  const locationRequirementPattern = lower.match(/(?:phòng|room).*?(?:tầng|floor|vị trí|location|gần|near)/i) ||
                                    lower.match(/(?:tầng|floor|vị trí|location|gần|near).*?(?:phòng|room)/i);
  if (locationRequirementPattern && !hasDates) {
    return {
      text: 'Phòng theo vị trí:\n\n' +
            '📍 **Gợi ý:**\n' +
            '• Phòng tầng cao (view đẹp)\n' +
            '• Phòng gần thang máy\n' +
            '• Phòng yên tĩnh\n\n' +
            '📋 **Để tìm phòng theo vị trí, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n' +
            '📍 Yêu cầu về vị trí\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 📍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.84: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi đặc biệt
  const specialAmenityRequirementPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:jacuzzi|hot tub|sauna|xông hơi|massage|spa)/i) ||
                                           lower.match(/(?:jacuzzi|hot tub|sauna|xông hơi|massage|spa).*?(?:phòng|room)/i);
  if (specialAmenityRequirementPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi đặc biệt:\n\n' +
            '✨ **Tiện nghi:**\n' +
            '• Jacuzzi/Hot tub\n' +
            '• Sauna/Xông hơi\n' +
            '• Massage/Spa\n\n' +
            '📋 **Để tìm phòng có tiện nghi đặc biệt, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! ✨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.85: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi công nghệ
  const techAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:smart tv|4k|netflix|streaming|bluetooth|wireless)/i) ||
                            lower.match(/(?:smart tv|4k|netflix|streaming|bluetooth|wireless).*?(?:phòng|room)/i);
  if (techAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi công nghệ:\n\n' +
            '📱 **Tiện nghi:**\n' +
            '• Smart TV\n' +
            '• WiFi tốc độ cao\n' +
            '• Bluetooth\n' +
            '• Streaming services\n\n' +
            '📋 **Để tìm phòng có tiện nghi công nghệ, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 📱',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.86: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi ẩm thực
  const diningAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:bếp|kitchen|nấu ăn|cooking|minibar|tủ lạnh|refrigerator)/i) ||
                              lower.match(/(?:bếp|kitchen|nấu ăn|cooking|minibar|tủ lạnh|refrigerator).*?(?:phòng|room)/i);
  if (diningAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi ẩm thực:\n\n' +
            '🍳 **Tiện nghi:**\n' +
            '• Bếp mini\n' +
            '• Tủ lạnh\n' +
            '• Minibar\n' +
            '• Dụng cụ nấu ăn\n\n' +
            '📋 **Để tìm phòng có tiện nghi ẩm thực, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🍳',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.87: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi giải trí
  const entertainmentAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:game|console|playstation|xbox|board game|boardgame)/i) ||
                                     lower.match(/(?:game|console|playstation|xbox|board game|boardgame).*?(?:phòng|room)/i);
  if (entertainmentAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi giải trí:\n\n' +
            '🎮 **Tiện nghi:**\n' +
            '• Game console\n' +
            '• Board games\n' +
            '• Smart TV với streaming\n\n' +
            '📋 **Để tìm phòng có tiện nghi giải trí, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🎮',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.88: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi làm việc
  const workAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:bàn làm việc|desk|workspace|office|printer|máy in)/i) ||
                            lower.match(/(?:bàn làm việc|desk|workspace|office|printer|máy in).*?(?:phòng|room)/i);
  if (workAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi làm việc:\n\n' +
            '💼 **Tiện nghi:**\n' +
            '• Bàn làm việc\n' +
            '• WiFi tốc độ cao\n' +
            '• Ổ cắm nhiều\n' +
            '• Không gian yên tĩnh\n\n' +
            '📋 **Để tìm phòng có tiện nghi làm việc, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.89: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi thể thao
  const fitnessAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:gym|fitness|tập thể dục|exercise|yoga)/i) ||
                                lower.match(/(?:gym|fitness|tập thể dục|exercise|yoga).*?(?:phòng|room)/i);
  if (fitnessAmenityPattern && !hasDates) {
    return {
      text: 'Phòng gần khu vực thể thao:\n\n' +
            '💪 **Tiện nghi:**\n' +
            '• Phòng gym (miễn phí cho khách lưu trú)\n' +
            '• Bể bơi\n' +
            '• Khu vực yoga\n\n' +
            '📋 **Để tìm phòng gần khu vực thể thao, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 💪',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.90: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi spa
  const spaAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:spa|massage|wellness|relaxation)/i) ||
                            lower.match(/(?:spa|massage|wellness|relaxation).*?(?:phòng|room)/i);
  if (spaAmenityPattern && !hasDates) {
    return {
      text: 'Phòng gần khu vực spa:\n\n' +
            '💆 **Dịch vụ:**\n' +
            '• Spa & Massage\n' +
            '• Wellness center\n' +
            '• Relaxation area\n\n' +
            '📋 **Để tìm phòng gần khu vực spa, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 💆',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.91: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi ẩm thực trong phòng
  const inRoomDiningPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:room service|dịch vụ phòng|ăn trong phòng|dining in room)/i) ||
                             lower.match(/(?:room service|dịch vụ phòng|ăn trong phòng|dining in room).*?(?:phòng|room)/i);
  if (inRoomDiningPattern && !hasDates) {
    return {
      text: 'Dịch vụ ăn uống trong phòng:\n\n' +
            '🍽️ **Dịch vụ:**\n' +
            '• Room Service 24/7\n' +
            '• Minibar\n' +
            '• Đặt món qua điện thoại\n\n' +
            '📋 **Để tìm phòng có dịch vụ ăn uống, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🍽️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.92: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi giải trí trong phòng
  const inRoomEntertainmentPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:giải trí|entertainment|giải trí trong phòng)/i) ||
                                    lower.match(/(?:giải trí|entertainment|giải trí trong phòng).*?(?:phòng|room)/i);
  if (inRoomEntertainmentPattern && !hasDates) {
    return {
      text: 'Tiện nghi giải trí trong phòng:\n\n' +
            '🎮 **Tiện nghi:**\n' +
            '• Smart TV\n' +
            '• Streaming services\n' +
            '• WiFi tốc độ cao\n\n' +
            '📋 **Để tìm phòng có tiện nghi giải trí, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🎮',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.93: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi làm việc trong phòng
  const inRoomWorkPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:làm việc|work|business|office trong phòng)/i) ||
                           lower.match(/(?:làm việc|work|business|office trong phòng).*?(?:phòng|room)/i);
  if (inRoomWorkPattern && !hasDates) {
    return {
      text: 'Tiện nghi làm việc trong phòng:\n\n' +
            '💼 **Tiện nghi:**\n' +
            '• Bàn làm việc\n' +
            '• WiFi tốc độ cao\n' +
            '• Ổ cắm nhiều\n' +
            '• Không gian yên tĩnh\n\n' +
            '📋 **Để tìm phòng có tiện nghi làm việc, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.94: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi nghỉ ngơi
  const relaxationAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:nghỉ ngơi|relaxation|thư giãn|rest)/i) ||
                                   lower.match(/(?:nghỉ ngơi|relaxation|thư giãn|rest).*?(?:phòng|room)/i);
  if (relaxationAmenityPattern && !hasDates) {
    return {
      text: 'Phòng cho nghỉ ngơi:\n\n' +
            '🧘 **Tiện nghi:**\n' +
            '• Không gian yên tĩnh\n' +
            '• View đẹp\n' +
            '• Tiện nghi đầy đủ\n\n' +
            '📋 **Để tìm phòng cho nghỉ ngơi, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🧘',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.95: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi gia đình
  const familyAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:gia đình|family|trẻ em|children|kids)/i) ||
                              lower.match(/(?:gia đình|family|trẻ em|children|kids).*?(?:phòng|room)/i);
  if (familyAmenityPattern && !hasDates) {
    return {
      text: 'Phòng cho gia đình:\n\n' +
            '👨‍👩‍👧‍👦 **Tiện nghi:**\n' +
            '• Không gian rộng rãi\n' +
            '• Phù hợp cho trẻ em\n' +
            '• Tiện nghi đầy đủ\n\n' +
            '📋 **Để tìm phòng cho gia đình, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng người lớn\n' +
            '👶 Số lượng trẻ em và tuổi\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho gia đình bạn! 👨‍👩‍👧‍👦',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.96: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi cặp đôi
  const coupleAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:cặp đôi|couple|romantic|lãng mạn)/i) ||
                              lower.match(/(?:cặp đôi|couple|romantic|lãng mạn).*?(?:phòng|room)/i);
  if (coupleAmenityPattern && !hasDates) {
    return {
      text: 'Phòng cho cặp đôi:\n\n' +
            '💑 **Tiện nghi:**\n' +
            '• Không gian lãng mạn\n' +
            '• View đẹp\n' +
            '• Tiện nghi cao cấp\n\n' +
            '📋 **Để tìm phòng cho cặp đôi, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n\n' +
            'Tôi sẽ tìm phòng lãng mạn nhất cho bạn! 💑',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.97: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi đơn giản
  const simpleAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:đơn giản|simple|basic|cơ bản)/i) ||
                              lower.match(/(?:đơn giản|simple|basic|cơ bản).*?(?:phòng|room)/i);
  if (simpleAmenityPattern && !hasDates) {
    return {
      text: 'Phòng đơn giản:\n\n' +
            '🏨 **Gợi ý:**\n' +
            '• Phòng Standard\n' +
            '• Tiện nghi cơ bản\n' +
            '• Giá tốt\n\n' +
            '📋 **Để tìm phòng đơn giản, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.98: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi đầy đủ
  const fullAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:đầy đủ|full|complete|tất cả|all)/i) ||
                             lower.match(/(?:đầy đủ|full|complete|tất cả|all).*?(?:phòng|room)/i);
  if (fullAmenityPattern && !hasDates) {
    return {
      text: 'Phòng có tiện nghi đầy đủ:\n\n' +
            '✨ **Tiện nghi:**\n' +
            '• WiFi miễn phí\n' +
            '• TV màn hình phẳng\n' +
            '• Máy lạnh\n' +
            '• Minibar\n' +
            '• Tủ lạnh\n' +
            '• Bồn tắm (một số phòng)\n' +
            '• Ban công (một số phòng)\n\n' +
            '📋 **Để tìm phòng có tiện nghi đầy đủ, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! ✨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.99: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi hiện đại
  const modernAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:hiện đại|modern|smart|thông minh)/i) ||
                              lower.match(/(?:hiện đại|modern|smart|thông minh).*?(?:phòng|room)/i);
  if (modernAmenityPattern && !hasDates) {
    return {
      text: 'Phòng hiện đại:\n\n' +
            '📱 **Tiện nghi:**\n' +
            '• Smart TV\n' +
            '• WiFi tốc độ cao\n' +
            '• Điều khiển thông minh\n' +
            '• Tiện nghi công nghệ cao\n\n' +
            '📋 **Để tìm phòng hiện đại, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng hiện đại nhất cho bạn! 📱',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 1.100: Câu hỏi về phòng có sẵn cho khách đặt theo yêu cầu về tiện nghi truyền thống
  const traditionalAmenityPattern = lower.match(/(?:phòng|room).*?(?:có|co|have).*?(?:truyền thống|traditional|cổ điển|classic)/i) ||
                                     lower.match(/(?:truyền thống|traditional|cổ điển|classic).*?(?:phòng|room)/i);
  if (traditionalAmenityPattern && !hasDates) {
    return {
      text: 'Phòng truyền thống:\n\n' +
            '🏛️ **Phong cách:**\n' +
            '• Thiết kế cổ điển\n' +
            '• Tiện nghi đầy đủ\n' +
            '• Không gian ấm cúng\n\n' +
            '📋 **Để tìm phòng truyền thống, vui lòng cho biết:**\n' +
            '📅 Ngày nhận phòng\n' +
            '📅 Ngày trả phòng\n' +
            '👥 Số lượng khách\n\n' +
            'Tôi sẽ tìm phòng phù hợp cho bạn! 🏛️',
      rooms: null,
      hasRooms: false
    };
  }
  
  // Pattern 2: Đã có đủ thông tin booking trong context → Tự động tìm phòng từ DB
  const wantsSeaView = lower.includes('view biển') || lower.includes('biển') || lower.includes('sea view') || lower.includes('ocean view') || lower.includes('hướng biển');
  // Lưu dấu hiệu khách muốn view biển để dùng khi họ cung cấp ngày sau đó
  if (wantsSeaView) {
    context.requestedView = 'biển';
    console.log(`✅ Detected sea view request, setting context.requestedView = 'biển'`);
    // Note: requestedView sẽ được lưu vào session.context.requestedView ở phần save session
  } else if (!wantsSeaView && !context.requestedView) {
    // Nếu không có trong message hiện tại và chưa có trong context, giữ nguyên (đã được restore từ session ở đầu hàm)
    console.log(`ℹ️ No sea view in current message, context.requestedView = ${context.requestedView || 'null'}`);
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
              id: room._id?.toString?.() || room.id || room._id,
              _id: room._id,
              name: room.name,
              roomType: room.roomType,
              pricePerNight: room.pricePerNight ?? 0,
              maxOccupancy: room.maxOccupancy,
              view: room.view,
              image: room.image || room.thumbnailUrl || null,
              thumbnailUrl: room.thumbnailUrl || room.image || null,
              amenities: Array.isArray(room.amenities) ? room.amenities : []
            }));
            
            console.log(`✅ Pattern-based: Found ${rooms.length} rooms (no API call)`);
            
            return {
              text: `Mình đã tìm được ${rooms.length} phòng phù hợp với yêu cầu của bạn! 😊 Vui lòng chọn phòng bạn muốn đặt (gõ số thứ tự hoặc tên phòng).`,
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
  
  // 
  // PATTERN MỚI: Các trường hợp còn lại để tránh tốn API
  // 

  // Pattern 2.3: Câu hỏi đàm thoại tự nhiên
  const conversationPattern = lower.match(/(?:bạn có thể|can you|có thể|help|giúp|tư vấn|advice)/i) ||
                              lower.match(/(?:cảm ơn|thank you|thanks|xin chào|hello|hi|chào)/i) ||
                              lower.match(/(?:bạn làm gì được|what can you do|bạn biết gì)/i) ||
                              lower.match(/(?:ok|okay|được|fine|tốt|good)/i);
  if (conversationPattern) {
    if (lower.includes('cảm ơn') || lower.includes('thank')) {
      return {
        text: 'Không có gì! Tôi rất vui được giúp bạn. Nếu bạn có câu hỏi gì khác về đặt phòng, dịch vụ khách sạn, vui lòng cho tôi biết nhé! 😊',
        rooms: null,
        hasRooms: false
      };
    } else if (lower.includes('xin chào') || lower.includes('hello') || lower.includes('hi') || lower.includes('chào')) {
      return {
        text: 'Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp bạn:\n\n' +
              '🏨 Đặt phòng\n' +
              '💰 Tư vấn giá phòng\n' +
              '📋 Thông tin dịch vụ\n' +
              '❓ Trả lời câu hỏi về khách sạn\n\n' +
              'Bạn cần tôi giúp gì? 😊',
        rooms: null,
        hasRooms: false
      };
    } else {
      return {
        text: 'Tôi có thể giúp bạn:\n\n' +
              '🏨 **Đặt phòng:** Tìm phòng phù hợp, đặt phòng trực tuyến\n' +
              '💰 **Tư vấn giá:** Giá phòng, ưu đãi, khuyến mãi\n' +
              '📋 **Dịch vụ:** Spa, nhà hàng, đưa đón sân bay, v.v.\n' +
              '❓ **Thông tin:** Chính sách, quy định, địa điểm gần khách sạn\n\n' +
              'Bạn muốn tìm hiểu về điều gì? 😊',
        rooms: null,
        hasRooms: false
      };
    }
  }

  // Pattern 2.4: Câu hỏi về giá phòng real-time (không có dates)
  const realtimePricePattern = lower.match(/(?:giá|price).*?(?:hôm nay|today|ngày mai|tomorrow|hiện tại|now|current)/i) ||
                               lower.match(/(?:phòng|room).*?(vip|suite|deluxe|standard).*?(?:giá|price).*?(?:hôm nay|today|ngày mai|tomorrow)/i);
  if (realtimePricePattern && !hasDates) {
    const roomType = lower.includes('vip') ? 'VIP' :
                    lower.includes('suite') ? 'Suite' :
                    lower.includes('deluxe') ? 'Deluxe' : 'Standard';
    
    return {
      text: `Giá phòng ${roomType} dao động từ:\n\n` +
            `• Phòng Standard: 1.500.000 - 2.500.000 VNĐ/đêm\n` +
            `• Phòng Deluxe: 3.000.000 - 4.000.000 VNĐ/đêm\n` +
            `• Phòng VIP: 4.000.000 - 5.000.000 VNĐ/đêm\n` +
            `• Phòng Suite: 6.000.000 - 8.000.000 VNĐ/đêm\n\n` +
            `💡 **Lưu ý:**\n` +
            `• Giá có thể thay đổi theo ngày và mùa\n` +
            `• Cuối tuần và lễ Tết giá cao hơn\n` +
            `• Đặt sớm để có giá tốt nhất\n\n` +
            `Để biết giá chính xác, vui lòng cho biết:\n` +
            `📅 Ngày nhận phòng\n` +
            `📅 Ngày trả phòng\n` +
            `👥 Số lượng khách\n\n` +
            `Tôi sẽ tìm phòng với giá tốt nhất cho bạn! 💰`,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.5: Câu hỏi về phòng đang có khuyến mãi
  const promoRoomPattern2 = lower.match(/(?:phòng|room).*?(?:đang|currently|hiện tại).*?(?:khuyến mãi|promotion|discount|ưu đãi)/i) ||
                            lower.match(/(?:khuyến mãi|promotion|discount).*?(?:cho|for).*?(?:phòng|room)/i);
  if (promoRoomPattern2) {
    return {
      text: 'Ưu đãi hiện tại:\n\n' +
            '💰 **Để biết ưu đãi:**\n' +
            '• Xem trên website\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Ưu đãi có thể thay đổi theo thời gian\n' +
            '• Mỗi ưu đãi có điều kiện áp dụng riêng\n' +
            '• Nhập mã khuyến mãi khi thanh toán\n\n' +
            'Bạn muốn đặt phòng với ưu đãi nào? Tôi sẽ kiểm tra cho bạn! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.6: Câu hỏi về số phòng còn trống
  const availabilityCountPattern = lower.match(/(?:có|có bao nhiêu|how many).*?(?:phòng|room).*?(?:còn trống|available|free)/i) ||
                                   lower.match(/(?:phòng|room).*?(?:còn trống|available|free).*?(?:bao nhiêu|how many)/i);
  if (availabilityCountPattern && !hasDates) {
    return {
      text: 'Để kiểm tra số phòng còn trống, vui lòng cho biết:\n\n' +
            '📅 **Ngày nhận phòng** (check-in)\n' +
            '📅 **Ngày trả phòng** (check-out)\n' +
            '👥 **Số lượng khách**\n' +
            '🏨 **Loại phòng** (nếu có yêu cầu)\n\n' +
            'Sau khi có thông tin, tôi sẽ kiểm tra và cho bạn biết số phòng còn trống! 🔍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.7: Câu hỏi về phòng cụ thể có view biển không
  const specificRoomViewPattern = lower.match(/(?:phòng|room).*?(vip|suite|deluxe).*?(?:có|có view|have).*?(?:view|hướng).*?(?:biển|sea|ocean)/i) ||
                                  lower.match(/(?:phòng|room).*?(?:view|hướng).*?(?:biển|sea|ocean).*?(?:có|có phòng|available)/i);
  if (specificRoomViewPattern && !hasDates) {
    const roomType = lower.includes('vip') ? 'VIP' :
                    lower.includes('suite') ? 'Suite' :
                    lower.includes('deluxe') ? 'Deluxe' : '';
    
    return {
      text: `${roomType ? `Phòng ${roomType} ` : 'Các phòng '}có thể có view biển.\n\n` +
            '🌅 **Về view biển:**\n' +
            '• Một số phòng có view biển tuyệt đẹp\n' +
            '• View tùy theo vị trí phòng\n' +
            '• Có thể yêu cầu view biển khi đặt phòng\n\n' +
            '📋 **Để kiểm tra phòng view biển còn trống:**\n' +
            '• Cho biết ngày nhận phòng\n' +
            '• Cho biết ngày trả phòng\n' +
            '• Cho biết số lượng khách\n\n' +
            'Tôi sẽ tìm phòng view biển phù hợp cho bạn! 🌊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.8: Câu hỏi về đổi phòng sau khi đặt
  const changeRoomAfterBookingPattern = lower.match(/(?:đổi|change|switch).*?(?:phòng|room).*?(?:sau|after).*?(?:đặt|booking)/i) ||
                                        lower.match(/(?:có thể|can).*?(?:đổi|change).*?(?:phòng|room).*?(?:sau|after)/i);
  if (changeRoomAfterBookingPattern) {
    return {
      text: 'Đổi phòng sau khi đặt:\n\n' +
            '✅ **Có thể đổi phòng:**\n' +
            '• Đổi trước 48 giờ: Miễn phí (nếu có phòng trống)\n' +
            '• Đổi trong 24-48 giờ: Có thể phát sinh phí\n' +
            '• Đổi trong 24 giờ: Tùy tình trạng phòng\n\n' +
            '📋 **Để đổi phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cung cấp mã booking\n\n' +
            'Bạn có mã booking không? Tôi sẽ hỗ trợ bạn! 📞',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.9: Câu hỏi về thêm người vào booking
  const addGuestsPattern = lower.match(/(?:thêm|add).*?(?:người|people|guests).*?(?:vào|to|booking|đặt phòng)/i) ||
                          lower.match(/(?:đã đặt|booked).*?(?:muốn|want).*?(?:thêm|add).*?(?:người|people)/i);
  if (addGuestsPattern) {
    return {
      text: 'Thêm người vào booking:\n\n' +
            '⚠️ **Lưu ý:**\n' +
            '• Cần kiểm tra sức chứa phòng\n' +
            '• Có thể cần đổi sang phòng lớn hơn\n' +
            '• Có thể phát sinh phí bổ sung\n\n' +
            '📋 **Để thêm người:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cung cấp mã booking và số người muốn thêm\n\n' +
            'Bạn có mã booking không? Tôi sẽ kiểm tra và hỗ trợ bạn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.10: Câu hỏi về hủy phòng A và đặt phòng B
  const cancelAndReBookPattern = lower.match(/(?:hủy|cancel).*?(?:phòng|room).*?(?:và|and).*?(?:đặt|book).*?(?:phòng|room)/i) ||
                                lower.match(/(?:đổi|change).*?(?:từ|from).*?(?:phòng|room).*?(?:sang|to).*?(?:phòng|room)/i);
  if (cancelAndReBookPattern) {
    return {
      text: 'Hủy và đặt lại phòng:\n\n' +
            '📋 **Quy trình:**\n' +
            '1. Hủy booking hiện tại (theo chính sách hủy)\n' +
            '2. Đặt phòng mới\n' +
            '3. Áp dụng chính sách hủy cho booking cũ\n\n' +
            '⚠️ **Lưu ý:**\n' +
            '• Phí hủy theo chính sách\n' +
            '• Phòng mới có thể có giá khác\n\n' +
            '📞 **Để thực hiện:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cung cấp mã booking cũ và thông tin phòng mới\n\n' +
            'Bạn có mã booking không? Tôi sẽ hỗ trợ bạn! 🔄',
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 2.11: Câu hỏi về giá dịch vụ cụ thể (massage, spa)
  // TODO: Re-enable after AI/RAG testing
  /*
  const specificServicePricePattern = lower.match(/(?:giá|price|phí|fee).*?(?:massage|spa).*?(\d+)\s*(?:phút|minute|min)/i) ||
                                      lower.match(/(?:massage|spa).*?(\d+)\s*(?:phút|minute|min).*?(?:giá|price|phí|fee)/i);
  if (specificServicePricePattern) {
    const duration = specificServicePricePattern[1] || '60';
    
    return {
      text: `Giá massage/spa ${duration} phút:\n\n` +
            '💰 **Bảng giá tham khảo:**\n' +
            '• Massage 60 phút: Từ 500.000 VNĐ\n' +
            '• Massage 90 phút: Từ 700.000 VNĐ\n' +
            '• Massage 120 phút: Từ 900.000 VNĐ\n' +
            '• Gói spa đặc biệt: Từ 1.500.000 VNĐ\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Giá có thể thay đổi theo thời gian\n' +
            '• Có các gói dịch vụ khác nhau\n' +
            '• Giá ưu đãi cho khách lưu trú\n\n' +
            '📞 **Để biết giá chính xác:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn đặt dịch vụ spa nào? Tôi sẽ kết nối bạn! 💆',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 2.12: Câu hỏi về dịch vụ spa
  // TODO: Re-enable after AI/RAG testing
  /*
  const spaServicesPattern = lower.match(/(?:spa|massage).*?(?:có|có dịch vụ|have|services)/i) ||
                            lower.match(/(?:dịch vụ|services).*?(?:spa|massage)/i);
  if (spaServicesPattern) {
    return {
      text: 'Dịch vụ Spa & Massage:\n\n' +
            '💆 **Dịch vụ:**\n' +
            '• Massage thư giãn\n' +
            '• Massage trị liệu\n' +
            '• Chăm sóc da mặt\n' +
            '• Tắm hơi\n' +
            '• Gói spa đặc biệt\n\n' +
            '⏰ **Giờ hoạt động:**\n' +
            '• 9:00 - 22:00 hàng ngày\n' +
            '• Đặt trước được khuyến khích\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn đặt dịch vụ nào? 💆',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 2.13: Câu hỏi về món ăn đặc biệt
  const specialDishPattern = lower.match(/(?:nhà hàng|restaurant).*?(?:có|có món|have|special).*?(?:món|dish|đặc biệt|special)/i) ||
                            lower.match(/(?:món|dish).*?(?:đặc biệt|special|nổi tiếng|famous)/i);
  if (specialDishPattern) {
    return {
      text: 'Món ăn đặc biệt tại nhà hàng:\n\n' +
            '🍽️ **Thực đơn:**\n' +
            '• Món ăn Việt Nam truyền thống\n' +
            '• Món ăn quốc tế\n' +
            '• Hải sản tươi sống\n' +
            '• Món ăn theo mùa\n\n' +
            '📋 **Để biết thực đơn chi tiết:**\n' +
            '• Xem tại nhà hàng khi check-in\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            '🍳 **Giờ phục vụ:**\n' +
            '• Bữa sáng: 6:30 - 10:00\n' +
            '• Bữa trưa: 11:30 - 14:00\n' +
            '• Bữa tối: 17:30 - 22:00\n\n' +
            'Bạn muốn đặt bàn không? Tôi sẽ kết nối bạn! 🍽️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.14: Câu hỏi về giờ mở cửa bể bơi
  const poolHoursPattern = lower.match(/(?:bể bơi|pool).*?(?:mở cửa|open|giờ|hours|hoạt động)/i) ||
                           lower.match(/(?:giờ|hours|mở cửa|open).*?(?:bể bơi|pool)/i);
  if (poolHoursPattern) {
    return {
      text: 'Bể bơi:\n\n' +
            '🏊 **Giờ hoạt động:**\n' +
            '• 6:00 - 22:00 hàng ngày\n' +
            '• Miễn phí cho khách lưu trú\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Có khu vực nông cho trẻ em\n' +
            '• Có ghế tắm nắng\n' +
            '• Có phục vụ đồ uống tại bể bơi\n\n' +
            'Bạn có câu hỏi gì khác về bể bơi không? 🏊',
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 2.15: Câu hỏi về địa điểm cụ thể gần khách sạn
  // TODO: Re-enable after AI/RAG testing
  /*
  const specificPlacePattern = lower.match(/(?:nhà hàng|restaurant|chợ|market|bảo tàng|museum|địa điểm|place).*?([A-Za-zÀ-ỹ\s]+).*?(?:gần|near|quanh|around).*?(?:khách sạn|hotel)/i) ||
                                lower.match(/(?:gần|near|quanh|around).*?(?:khách sạn|hotel).*?(?:có|có nhà hàng|have).*?([A-Za-zÀ-ỹ\s]+)/i);
  if (specificPlacePattern) {
    return {
      text: 'Địa điểm gần khách sạn:\n\n' +
            '📍 **Để xem địa điểm gần khách sạn:**\n' +
            '• Click vào phần "Khám Phá Ngay" trên trang chủ\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            '🗺️ **Các loại địa điểm:**\n' +
            '• Nhà hàng, quán ăn\n' +
            '• Địa điểm tham quan\n' +
            '• Trung tâm thương mại\n' +
            '• Chợ đêm\n\n' +
            'Bạn muốn tìm địa điểm nào? Tôi sẽ hướng dẫn bạn! 🗺️',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 2.16: Câu hỏi về thời gian đi từ khách sạn đến địa điểm
  const travelTimePattern = lower.match(/(?:đi|go|travel|mất|take).*?(?:từ|from).*?(?:khách sạn|hotel).*?(?:đến|to).*?(?:sân bay|airport|địa điểm|place)/i) ||
                            lower.match(/(?:khoảng cách|distance|thời gian|time).*?(?:từ|from).*?(?:khách sạn|hotel)/i);
  if (travelTimePattern) {
    return {
      text: 'Thời gian di chuyển:\n\n' +
            '✈️ **Đến sân bay:**\n' +
            '• Khoảng 30-45 phút bằng xe\n' +
            '• Có dịch vụ đưa đón sân bay\n\n' +
            '📍 **Đến các địa điểm:**\n' +
            '• Tùy theo địa điểm cụ thể\n' +
            '• Có thể hỏi lễ tân để được hướng dẫn\n\n' +
            '🚗 **Dịch vụ:**\n' +
            '• Đưa đón sân bay\n' +
            '• Thuê xe tự lái\n' +
            '• Taxi/Grab\n\n' +
            'Bạn muốn đi đâu? Tôi sẽ hướng dẫn bạn! 🗺️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.17: Câu hỏi về chợ đêm
  const nightMarketPattern = lower.match(/(?:chợ đêm|night market|chợ).*?(?:gần|near|quanh|around)/i) ||
                             lower.match(/(?:có|có chợ|have).*?(?:chợ đêm|night market)/i);
  if (nightMarketPattern) {
    return {
      text: 'Chợ đêm gần khách sạn:\n\n' +
            '🌃 **Thông tin:**\n' +
            '• Có nhiều chợ đêm gần khách sạn\n' +
            '• Bán đồ ăn, đồ lưu niệm\n' +
            '• Hoạt động từ chiều đến đêm\n\n' +
            '📍 **Để biết địa điểm cụ thể:**\n' +
            '• Click vào phần "Khám Phá Ngay" trên trang chủ\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn tìm chợ đêm nào? Tôi sẽ hướng dẫn bạn! 🌃',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.18: Câu hỏi về feedback/complaint
  const feedbackPattern = lower.match(/(?:không hài lòng|not satisfied|complaint|khiếu nại|vấn đề|problem|issue)/i) ||
                         lower.match(/(?:phòng|room).*?(?:có|có vấn đề|have).*?(?:vấn đề|problem|issue)/i);
  if (feedbackPattern) {
    return {
      text: 'Xin lỗi vì sự bất tiện!\n\n' +
            '📞 **Để được hỗ trợ:**\n' +
            '• Gọi hotline: 0901 234 567 (24/7)\n' +
            '• Email: info@rayalpark.com\n' +
            '• Liên hệ lễ tân ngay lập tức\n\n' +
            '💡 **Chúng tôi sẽ:**\n' +
            '• Xử lý vấn đề ngay lập tức\n' +
            '• Bồi thường nếu cần thiết\n' +
            '• Đảm bảo bạn hài lòng\n\n' +
            'Vui lòng cho biết vấn đề cụ thể để chúng tôi hỗ trợ tốt nhất! 🙏',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.19: Câu hỏi về booking đã tồn tại
  const existingBookingPattern = lower.match(/(?:tôi đã đặt|i booked|đã đặt phòng|my booking|đặt phòng của tôi)/i) ||
                                 lower.match(/(?:kiểm tra|check|view).*?(?:booking|đặt phòng)/i);
  if (existingBookingPattern) {
    return {
      text: 'Kiểm tra booking:\n\n' +
            '📋 **Cách kiểm tra:**\n' +
            '• Đăng nhập vào website và vào phần "Đặt phòng của tôi"\n' +
            '• Hoặc gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            '📧 **Thông tin cần:**\n' +
            '• Mã booking (nếu có)\n' +
            '• Email đã dùng để đặt phòng\n' +
            '• Số điện thoại\n\n' +
            'Bạn có mã booking không? Tôi sẽ hỗ trợ bạn! 📞',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.20: Câu hỏi về mã booking
  const bookingCodeQuestionPattern = lower.match(/(?:mã booking|booking code|mã đặt phòng).*?(?:là gì|what|where|của tôi|my)/i) ||
                                     lower.match(/(?:tôi|i).*?(?:có|có mã|have).*?(?:mã booking|booking code)/i);
  if (bookingCodeQuestionPattern) {
    return {
      text: 'Mã booking:\n\n' +
            '📧 **Mã booking sẽ được gửi:**\n' +
            '• Qua email sau khi đặt phòng thành công\n' +
            '• Kiểm tra hộp thư spam nếu chưa nhận được\n\n' +
            '📋 **Nếu chưa nhận được mã:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cung cấp email và số điện thoại đã dùng để đặt phòng\n\n' +
            'Bạn đã nhận được email xác nhận chưa? Tôi sẽ hỗ trợ bạn! 📧',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.21: Câu hỏi về chính sách hủy cho booking group
  const groupCancelPolicyPattern = lower.match(/(?:chính sách|policy).*?(?:hủy|cancel).*?(?:cho|for).*?(?:nhóm|group|đoàn)/i) ||
                                     lower.match(/(?:hủy|cancel).*?(?:nhóm|group|đoàn).*?(?:phòng|room)/i);
  if (groupCancelPolicyPattern) {
    return {
      text: 'Chính sách hủy cho nhóm:\n\n' +
            '📋 **Quy định:**\n' +
            '• Hủy trước 7 ngày: Miễn phí\n' +
            '• Hủy trong 3-7 ngày: Phí 30%\n' +
            '• Hủy trong 1-3 ngày: Phí 50%\n' +
            '• Hủy trong 24 giờ: Phí 100%\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Chính sách có thể khác nhau tùy theo số lượng phòng\n' +
            '• Vui lòng kiểm tra khi đặt phòng\n\n' +
            '📞 **Để biết chính xác:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Bạn muốn đặt bao nhiêu phòng? Tôi sẽ kiểm tra chính sách cho bạn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.22: Câu hỏi về đổi phòng sau check-in
  const changeRoomAfterCheckinPattern = lower.match(/(?:đổi|change|switch).*?(?:phòng|room).*?(?:sau|after).*?(?:check-in|nhận phòng)/i) ||
                                         lower.match(/(?:có thể|can).*?(?:đổi|change).*?(?:phòng|room).*?(?:sau|after).*?(?:check-in)/i);
  if (changeRoomAfterCheckinPattern) {
    return {
      text: 'Đổi phòng sau check-in:\n\n' +
            '⚠️ **Điều kiện:**\n' +
            '• Tùy tình trạng phòng trống\n' +
            '• Có thể phát sinh phí\n' +
            '• Cần thông báo với lễ tân\n\n' +
            '📋 **Quy trình:**\n' +
            '1. Liên hệ lễ tân ngay\n' +
            '2. Kiểm tra phòng trống\n' +
            '3. Đổi phòng nếu có thể\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Lễ tân: Nhấn 0 từ phòng\n' +
            '• Hotline: 0901 234 567\n\n' +
            'Bạn đang ở khách sạn? Vui lòng liên hệ lễ tân ngay! 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.23: Câu hỏi về bảo hiểm
  const insurancePattern = lower.match(/(?:bảo hiểm|insurance|bảo vệ|protection)/i) ||
                           lower.match(/(?:có|có bảo hiểm|have).*?(?:bảo hiểm|insurance)/i);
  if (insurancePattern) {
    return {
      text: 'Bảo hiểm:\n\n' +
            '🛡️ **Về bảo hiểm:**\n' +
            '• Khách sạn có bảo vệ 24/7\n' +
            '• Có tủ an toàn trong phòng\n' +
            '• Bảo vệ tài sản khách hàng\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Khách sạn không chịu trách nhiệm về tài sản cá nhân\n' +
            '• Nên sử dụng tủ an toàn\n' +
            '• Có thể mua bảo hiểm du lịch riêng\n\n' +
            '📞 **Để biết thêm:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n\n' +
            'Bạn có câu hỏi gì khác về bảo hiểm không? 🛡️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.24: Câu hỏi về giải thưởng
  const awardPattern = lower.match(/(?:giải thưởng|award|thành tích|achievement|giải|prize)/i) ||
                      lower.match(/(?:khách sạn|hotel).*?(?:có|có được|won|received).*?(?:giải thưởng|award)/i);
  if (awardPattern) {
    return {
      text: 'Giải thưởng và thành tích:\n\n' +
            '🏆 **Thành tích:**\n' +
            '• Giải thưởng "Khách sạn tốt nhất năm 2023"\n' +
            '• Chứng nhận 5 sao quốc tế\n' +
            '• Top 10 khách sạn hàng đầu Việt Nam\n' +
            '• Đánh giá cao từ khách hàng\n\n' +
            '⭐ **Chất lượng:**\n' +
            '• Dịch vụ 5 sao\n' +
            '• Tiện nghi hiện đại\n' +
            '• Đội ngũ nhân viên chuyên nghiệp\n\n' +
            'Bạn muốn tìm hiểu thêm về khách sạn không? 🏨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.25: Câu hỏi về số nhân viên
  const staffPattern = lower.match(/(?:có|có bao nhiêu|how many).*?(?:nhân viên|staff|employees)/i) ||
                      lower.match(/(?:nhân viên|staff).*?(?:có|có bao nhiêu|how many)/i);
  if (staffPattern) {
    return {
      text: 'Đội ngũ nhân viên:\n\n' +
            '👥 **Thông tin:**\n' +
            '• Đội ngũ nhân viên chuyên nghiệp\n' +
            '• Được đào tạo bài bản\n' +
            '• Phục vụ 24/7\n\n' +
            '💡 **Dịch vụ:**\n' +
            '• Lễ tân: Hỗ trợ mọi lúc\n' +
            '• Dọn phòng: Hàng ngày\n' +
            '• Bảo vệ: 24/7\n' +
            '• Nhà hàng: Phục vụ đầy đủ\n\n' +
            'Bạn có cần hỗ trợ gì không? Tôi sẽ giúp bạn! 😊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.26: Câu hỏi về phục vụ khách quốc tế
  const internationalServicePattern = lower.match(/(?:phục vụ|serve|service).*?(?:khách quốc tế|international|foreign)/i) ||
                                      lower.match(/(?:khách quốc tế|international).*?(?:phục vụ|serve|service)/i);
  if (internationalServicePattern) {
    return {
      text: 'Phục vụ khách quốc tế:\n\n' +
            '🌍 **Dịch vụ:**\n' +
            '• Hỗ trợ đa ngôn ngữ (Tiếng Anh, Tiếng Việt)\n' +
            '• Đổi tiền tệ\n' +
            '• Hướng dẫn du lịch\n' +
            '• Dịch vụ đưa đón sân bay\n\n' +
            '💡 **Tiện ích:**\n' +
            '• WiFi miễn phí\n' +
            '• Thực đơn đa ngôn ngữ\n' +
            '• Hướng dẫn địa phương\n\n' +
            'Bạn là khách quốc tế? Tôi sẽ hỗ trợ bạn! 🌏',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.27: Câu hỏi phức tạp kết hợp nhiều yêu cầu
  const complexRequestPattern = lower.match(/(?:đặt|book|muốn).*?(?:phòng|room).*?(vip|suite|deluxe).*?(?:view|hướng).*?(?:biển|sea).*?(?:cho|for).*?(\d+)\s*(?:người|people).*?(?:từ|from).*?(\d{1,2}\/\d{1,2}).*?(?:đến|to).*?(\d{1,2}\/\d{1,2}).*?(?:trẻ em|children).*?(\d+)\s*(?:tuổi|years old)/i) ||
                                lower.match(/(?:đặt|book|muốn).*?(?:phòng|room).*?(\d+)\s*(?:người|people).*?(?:từ|from).*?(\d{1,2}\/\d{1,2}).*?(?:đến|to).*?(\d{1,2}\/\d{1,2}).*?(?:cần|need).*?(?:giường phụ|extra bed|bữa sáng|breakfast)/i);
  if (complexRequestPattern) {
    const roomType = complexRequestPattern[1] || '';
    const guests = complexRequestPattern[2] ? parseInt(complexRequestPattern[2]) : null;
    const checkIn = complexRequestPattern[3] || complexRequestPattern[4];
    const checkOut = complexRequestPattern[4] || complexRequestPattern[5];
    const hasChild = complexRequestPattern[6] || lower.includes('trẻ em');
    const hasExtraBed = lower.includes('giường phụ') || lower.includes('extra bed');
    const hasBreakfast = lower.includes('bữa sáng') || lower.includes('breakfast');
    
    let responseText = 'Tôi hiểu yêu cầu của bạn!\n\n';
    responseText += '📋 **Thông tin đã nhận:**\n';
    if (roomType) responseText += `• Loại phòng: ${roomType.toUpperCase()}\n`;
    if (guests) responseText += `• Số khách: ${guests} người\n`;
    if (checkIn) responseText += `• Check-in: ${checkIn}\n`;
    if (checkOut) responseText += `• Check-out: ${checkOut}\n`;
    if (hasChild) responseText += '• Có trẻ em\n';
    if (hasExtraBed) responseText += '• Cần giường phụ\n';
    if (hasBreakfast) responseText += '• Cần bữa sáng\n';
    
    responseText += '\n💡 **Để hoàn tất đặt phòng:**\n';
    responseText += '• Xác nhận lại thông tin trên\n';
    responseText += '• Cung cấp thông tin cá nhân (tên, email, số điện thoại)\n';
    responseText += '• Tôi sẽ tính giá tổng và tạo đơn đặt phòng\n\n';
    responseText += 'Bạn có muốn tiếp tục đặt phòng không? 📝';
    
    return {
      text: responseText,
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.28: Câu hỏi về thời tiết/khí hậu
  const weatherPattern = lower.match(/(?:thời tiết|weather|khí hậu|climate)/i) ||
                         lower.match(/(?:nhiệt độ|temperature|mưa|rain)/i);
  if (weatherPattern) {
    return {
      text: 'Thời tiết:\n\n' +
            '🌤️ **Thông tin:**\n' +
            '• Thời tiết thay đổi theo mùa\n' +
            '• Nhiệt độ trung bình: 25-30°C\n' +
            '• Có mùa mưa và mùa khô\n\n' +
            '💡 **Lời khuyên:**\n' +
            '• Nên kiểm tra dự báo thời tiết trước khi đi\n' +
            '• Mang theo áo mưa nếu cần\n' +
            '• Sử dụng kem chống nắng\n\n' +
            'Bạn muốn đặt phòng cho thời gian nào? Tôi sẽ tìm phòng phù hợp! 🌤️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.29: Câu hỏi về phương tiện đi lại
  const transportationPattern = lower.match(/(?:phương tiện|transportation|xe|car|taxi|grab|bus)/i) ||
                               lower.match(/(?:đi lại|travel|di chuyển|move)/i);
  if (transportationPattern) {
    return {
      text: 'Phương tiện đi lại:\n\n' +
            '🚗 **Dịch vụ:**\n' +
            '• Đưa đón sân bay\n' +
            '• Thuê xe tự lái\n' +
            '• Taxi/Grab\n' +
            '• Xe bus công cộng\n\n' +
            '💡 **Để đặt dịch vụ:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn cần phương tiện đi đâu? Tôi sẽ hướng dẫn bạn! 🚗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.30: Câu hỏi về văn hóa/địa phương
  const culturePattern = lower.match(/(?:văn hóa|culture|địa phương|local|truyền thống|tradition)/i) ||
                        lower.match(/(?:lễ hội|festival|sự kiện|event).*?(?:địa phương|local)/i);
  if (culturePattern) {
    return {
      text: 'Văn hóa địa phương:\n\n' +
            '🎭 **Thông tin:**\n' +
            '• Nhiều lễ hội truyền thống\n' +
            '• Ẩm thực đa dạng\n' +
            '• Di tích lịch sử\n\n' +
            '📍 **Để tìm hiểu:**\n' +
            '• Click vào phần "Khám Phá Ngay" trên trang chủ\n' +
            '• Hỏi lễ tân khi check-in\n' +
            '• Tham gia tour địa phương\n\n' +
            'Bạn muốn tìm hiểu về điều gì? Tôi sẽ hướng dẫn bạn! 🎭',
      rooms: null,
      hasRooms: false
    };
  }

  // ⚠️ TEMPORARILY DISABLED FOR AI/RAG TESTING - Pattern 2.31: Câu hỏi về an ninh
  // TODO: Re-enable after AI/RAG testing
  /*
  const securityPattern = lower.match(/(?:an ninh|security|an toàn|safe|bảo vệ|protection)/i) ||
                         lower.match(/(?:có|có an toàn|is safe|secure)/i);
  if (securityPattern) {
    return {
      text: 'An ninh và an toàn:\n\n' +
            '🛡️ **Bảo vệ:**\n' +
            '• Bảo vệ 24/7\n' +
            '• Camera an ninh\n' +
            '• Tủ an toàn trong phòng\n' +
            '• Khóa điện tử\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Nên sử dụng tủ an toàn cho tài sản giá trị\n' +
            '• Không cho người lạ vào phòng\n' +
            '• Liên hệ bảo vệ nếu có vấn đề\n\n' +
            'Bạn có câu hỏi gì về an ninh không? 🛡️',
      rooms: null,
      hasRooms: false
    };
  }
  */

  // Pattern 2.32: Câu hỏi về thanh toán bằng ngoại tệ
  const foreignCurrencyPattern = lower.match(/(?:thanh toán|payment|pay).*?(?:ngoại tệ|foreign currency|usd|dollar|euro)/i) ||
                                 lower.match(/(?:có thể|can).*?(?:thanh toán|payment|pay).*?(?:bằng|by).*?(?:usd|dollar|euro)/i);
  if (foreignCurrencyPattern) {
    return {
      text: 'Thanh toán bằng ngoại tệ:\n\n' +
            '💱 **Chấp nhận:**\n' +
            '• USD (Đô la Mỹ)\n' +
            '• EUR (Euro)\n' +
            '• Tỷ giá theo ngày\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Tỷ giá có thể thay đổi\n' +
            '• Có thể đổi tiền tại lễ tân\n' +
            '• Nên thanh toán bằng VNĐ để tránh chênh lệch tỷ giá\n\n' +
            '📞 **Để biết tỷ giá:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn thanh toán bằng ngoại tệ nào? 💱',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.33: Câu hỏi về dịch vụ giặt ủi chi tiết
  const detailedLaundryPattern = lower.match(/(?:giặt ủi|laundry).*?(?:giá|price|phí|fee|thời gian|time)/i) ||
                                lower.match(/(?:giá|price|phí|fee|thời gian|time).*?(?:giặt ủi|laundry)/i);
  if (detailedLaundryPattern) {
    return {
      text: 'Dịch vụ giặt ủi:\n\n' +
            '👔 **Dịch vụ:**\n' +
            '• Giặt thường: Trong ngày\n' +
            '• Giặt nhanh: 2-4 giờ\n' +
            '• Giặt khô: 24-48 giờ\n\n' +
            '💰 **Giá tham khảo:**\n' +
            '• Áo sơ mi: Từ 50.000 VNĐ\n' +
            '• Quần dài: Từ 60.000 VNĐ\n' +
            '• Váy/Đầm: Từ 70.000 VNĐ\n' +
            '• Giặt khô: Từ 100.000 VNĐ\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Giá có thể thay đổi\n' +
            '• Có bảng giá chi tiết tại phòng\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi lễ tân từ phòng\n' +
            '• Hoặc hotline: 0901 234 567\n\n' +
            'Bạn cần giặt ủi gì? Tôi sẽ hướng dẫn bạn! 👔',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.34: Câu hỏi về dịch vụ phòng (room service)
  const roomServicePattern = lower.match(/(?:room service|dịch vụ phòng|phục vụ phòng)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:room service|phục vụ phòng)/i);
  if (roomServicePattern) {
    return {
      text: 'Dịch vụ phòng (Room Service):\n\n' +
            '🍽️ **Dịch vụ:**\n' +
            '• Phục vụ 24/7\n' +
            '• Thực đơn đa dạng\n' +
            '• Đồ uống và snack\n' +
            '• Phục vụ tận phòng\n\n' +
            '⏰ **Giờ phục vụ:**\n' +
            '• 24/7\n' +
            '• Gọi từ phòng: Nhấn phím dịch vụ\n\n' +
            '💰 **Giá:**\n' +
            '• Theo thực đơn\n' +
            '• Có phí phục vụ\n\n' +
            'Bạn muốn đặt món gì? Tôi sẽ hướng dẫn bạn! 🍽️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.35: Câu hỏi về dịch vụ business center
  const businessCenterPattern = lower.match(/(?:business center|trung tâm kinh doanh|phòng làm việc)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:business center|phòng làm việc)/i);
  if (businessCenterPattern) {
    return {
      text: 'Business Center:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Máy tính và internet\n' +
            '• Máy in, fax, photocopy\n' +
            '• Phòng họp nhỏ\n' +
            '• WiFi tốc độ cao\n\n' +
            '⏰ **Giờ hoạt động:**\n' +
            '• 7:00 - 22:00 hàng ngày\n\n' +
            '💰 **Giá:**\n' +
            '• Miễn phí cho khách lưu trú (một số dịch vụ)\n' +
            '• Có phí cho dịch vụ in ấn\n\n' +
            '📞 **Để sử dụng:**\n' +
            '• Liên hệ lễ tân\n' +
            '• Hoặc hotline: 0901 234 567\n\n' +
            'Bạn cần dịch vụ gì? Tôi sẽ hướng dẫn bạn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.36: Câu hỏi về dịch vụ concierge
  const conciergePattern = lower.match(/(?:concierge|hướng dẫn viên|tư vấn du lịch)/i) ||
                          lower.match(/(?:có|có dịch vụ|have).*?(?:concierge|hướng dẫn)/i);
  if (conciergePattern) {
    return {
      text: 'Dịch vụ Concierge:\n\n' +
            '🎯 **Dịch vụ:**\n' +
            '• Hướng dẫn du lịch\n' +
            '• Đặt tour, vé tham quan\n' +
            '• Đặt nhà hàng\n' +
            '• Tư vấn địa điểm\n\n' +
            '⏰ **Giờ hoạt động:**\n' +
            '• 7:00 - 22:00 hàng ngày\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Lễ tân\n' +
            '• Hotline: 0901 234 567\n\n' +
            'Bạn muốn tìm hiểu về điều gì? Tôi sẽ hướng dẫn bạn! 🎯',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.37: Câu hỏi về dịch vụ valet parking
  const valetParkingPattern = lower.match(/(?:valet parking|đỗ xe hộ|gửi xe)/i) ||
                             lower.match(/(?:có|có dịch vụ|have).*?(?:valet parking|đỗ xe hộ)/i);
  if (valetParkingPattern) {
    return {
      text: 'Dịch vụ Valet Parking:\n\n' +
            '🚗 **Dịch vụ:**\n' +
            '• Đỗ xe hộ\n' +
            '• Lấy xe khi cần\n' +
            '• Bảo vệ 24/7\n\n' +
            '💰 **Giá:**\n' +
            '• Miễn phí cho khách lưu trú\n' +
            '• Có phí cho khách không lưu trú\n\n' +
            '📞 **Để sử dụng:**\n' +
            '• Thông báo khi check-in\n' +
            '• Hoặc gọi hotline: 0901 234 567\n\n' +
            'Bạn có cần đỗ xe không? Tôi sẽ hướng dẫn bạn! 🚗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.38: Câu hỏi về dịch vụ babysitting
  const babysittingPattern = lower.match(/(?:babysitting|trông trẻ|chăm sóc trẻ)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:babysitting|trông trẻ)/i);
  if (babysittingPattern) {
    return {
      text: 'Dịch vụ Trông Trẻ:\n\n' +
            '👶 **Dịch vụ:**\n' +
            '• Trông trẻ theo giờ\n' +
            '• Nhân viên có kinh nghiệm\n' +
            '• Cần đặt trước\n\n' +
            '💰 **Giá:**\n' +
            '• Theo giờ\n' +
            '• Vui lòng liên hệ để biết giá cụ thể\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Đặt trước 24 giờ\n\n' +
            'Bạn có trẻ em cần trông không? Tôi sẽ hướng dẫn bạn! 👶',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.39: Câu hỏi về dịch vụ wake-up call
  const wakeupCallPattern = lower.match(/(?:wake-up call|gọi thức dậy|đánh thức)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:wake-up call|gọi thức dậy)/i);
  if (wakeupCallPattern) {
    return {
      text: 'Dịch vụ Wake-up Call:\n\n' +
            '⏰ **Dịch vụ:**\n' +
            '• Gọi thức dậy theo giờ\n' +
            '• Miễn phí\n' +
            '• Đặt khi check-in hoặc gọi lễ tân\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi lễ tân từ phòng\n' +
            '• Hoặc hotline: 0901 234 567\n' +
            '• Cho biết giờ cần thức dậy\n\n' +
            'Bạn cần thức dậy lúc mấy giờ? Tôi sẽ hướng dẫn bạn! ⏰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.40: Câu hỏi về dịch vụ tour/du lịch
  const tourPattern = lower.match(/(?:tour|du lịch|tham quan|sightseeing)/i) ||
                     lower.match(/(?:có|có dịch vụ|have).*?(?:tour|du lịch)/i);
  if (tourPattern) {
    return {
      text: 'Dịch vụ Tour & Du lịch:\n\n' +
            '🗺️ **Dịch vụ:**\n' +
            '• Tour trong ngày\n' +
            '• Tour nhiều ngày\n' +
            '• Hướng dẫn viên\n' +
            '• Đặt vé tham quan\n\n' +
            '📞 **Đặt tour:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn tham quan đâu? Tôi sẽ hướng dẫn bạn! 🗺️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.41: Câu hỏi về dịch vụ đổi tiền
  const currencyExchangePattern = lower.match(/(?:đổi tiền|currency exchange|đổi ngoại tệ)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đổi tiền|currency exchange)/i);
  if (currencyExchangePattern) {
    return {
      text: 'Dịch vụ Đổi Tiền:\n\n' +
            '💱 **Dịch vụ:**\n' +
            '• Đổi USD, EUR, và các ngoại tệ khác\n' +
            '• Tỷ giá theo ngày\n' +
            '• Tại lễ tân\n\n' +
            '💡 **Lưu ý:**\n' +
            '• Tỷ giá có thể thay đổi\n' +
            '• Nên kiểm tra tỷ giá trước khi đổi\n\n' +
            '📞 **Để biết tỷ giá:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn đổi ngoại tệ nào? Tôi sẽ hướng dẫn bạn! 💱',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.42: Câu hỏi về dịch vụ y tế
  const medicalPattern = lower.match(/(?:dịch vụ y tế|medical|bác sĩ|doctor|thuốc|medicine)/i) ||
                        lower.match(/(?:có|có dịch vụ|have).*?(?:y tế|medical|bác sĩ)/i);
  if (medicalPattern) {
    return {
      text: 'Dịch vụ Y tế:\n\n' +
            '🏥 **Dịch vụ:**\n' +
            '• Tủ thuốc sơ cứu tại lễ tân\n' +
            '• Liên hệ bác sĩ khi cần\n' +
            '• Hướng dẫn đến bệnh viện gần nhất\n\n' +
            '🚨 **Cấp cứu:**\n' +
            '• Gọi 115 (cấp cứu)\n' +
            '• Hoặc liên hệ lễ tân ngay\n\n' +
            '📞 **Liên hệ:**\n' +
            '• Lễ tân: Nhấn 0 từ phòng\n' +
            '• Hotline: 0901 234 567\n\n' +
            'Bạn có cần hỗ trợ y tế không? Tôi sẽ giúp bạn! 🏥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.43: Câu hỏi về dịch vụ giữ hành lý
  const luggagePattern = lower.match(/(?:giữ hành lý|luggage storage|gửi hành lý)/i) ||
                        lower.match(/(?:có|có dịch vụ|have).*?(?:giữ hành lý|luggage)/i);
  if (luggagePattern) {
    return {
      text: 'Dịch vụ Giữ Hành Lý:\n\n' +
            '🧳 **Dịch vụ:**\n' +
            '• Giữ hành lý miễn phí\n' +
            '• Trước và sau check-in/check-out\n' +
            '• An toàn, có bảo vệ\n\n' +
            '⏰ **Thời gian:**\n' +
            '• Trong giờ làm việc của lễ tân\n' +
            '• Có thể giữ qua đêm\n\n' +
            '📞 **Để sử dụng:**\n' +
            '• Thông báo với lễ tân\n' +
            '• Hoặc gọi hotline: 0901 234 567\n\n' +
            'Bạn cần giữ hành lý không? Tôi sẽ hướng dẫn bạn! 🧳',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.44: Câu hỏi về dịch vụ photocopy/in ấn
  const printingPattern = lower.match(/(?:photocopy|in ấn|printing|máy in|printer)/i) ||
                         lower.match(/(?:có|có dịch vụ|have).*?(?:photocopy|in ấn)/i);
  if (printingPattern) {
    return {
      text: 'Dịch vụ Photocopy & In ấn:\n\n' +
            '🖨️ **Dịch vụ:**\n' +
            '• Photocopy\n' +
            '• In tài liệu\n' +
            '• Scan tài liệu\n' +
            '• Tại Business Center\n\n' +
            '💰 **Giá:**\n' +
            '• Theo số trang\n' +
            '• Vui lòng liên hệ để biết giá cụ thể\n\n' +
            '📞 **Để sử dụng:**\n' +
            '• Liên hệ lễ tân\n' +
            '• Hoặc hotline: 0901 234 567\n\n' +
            'Bạn cần in/photocopy gì? Tôi sẽ hướng dẫn bạn! 🖨️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.45: Câu hỏi về dịch vụ fax
  const faxPattern = lower.match(/(?:fax|gửi fax|dịch vụ fax)/i) ||
                    lower.match(/(?:có|có dịch vụ|have).*?(?:fax)/i);
  if (faxPattern) {
    return {
      text: 'Dịch vụ Fax:\n\n' +
            '📠 **Dịch vụ:**\n' +
            '• Gửi và nhận fax\n' +
            '• Tại Business Center\n' +
            '• Có phí\n\n' +
            '💰 **Giá:**\n' +
            '• Theo số trang\n' +
            '• Vui lòng liên hệ để biết giá cụ thể\n\n' +
            '📞 **Để sử dụng:**\n' +
            '• Liên hệ lễ tân\n' +
            '• Hoặc hotline: 0901 234 567\n\n' +
            'Bạn cần gửi fax không? Tôi sẽ hướng dẫn bạn! 📠',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.46: Câu hỏi về dịch vụ thuê xe
  const carRentalPattern = lower.match(/(?:thuê xe|car rental|rent a car|xe tự lái)/i) ||
                          lower.match(/(?:có|có dịch vụ|have).*?(?:thuê xe|car rental)/i);
  if (carRentalPattern) {
    return {
      text: 'Dịch vụ Thuê Xe:\n\n' +
            '🚗 **Dịch vụ:**\n' +
            '• Thuê xe tự lái\n' +
            '• Có tài xế\n' +
            '• Xe 4 chỗ, 7 chỗ, 16 chỗ\n\n' +
            '💰 **Giá:**\n' +
            '• Theo ngày hoặc theo chuyến\n' +
            '• Vui lòng liên hệ để biết giá cụ thể\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Đặt trước 24 giờ\n\n' +
            'Bạn cần thuê xe loại gì? Tôi sẽ hướng dẫn bạn! 🚗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.47: Câu hỏi về dịch vụ đặt vé máy bay
  const flightBookingPattern = lower.match(/(?:đặt vé máy bay|flight booking|book flight|vé máy bay)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt vé máy bay|flight booking)/i);
  if (flightBookingPattern) {
    return {
      text: 'Dịch vụ Đặt Vé Máy Bay:\n\n' +
            '✈️ **Dịch vụ:**\n' +
            '• Đặt vé máy bay nội địa và quốc tế\n' +
            '• Tư vấn lịch trình\n' +
            '• Hỗ trợ đặt vé\n\n' +
            '📞 **Đặt vé:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn đặt vé đi đâu? Tôi sẽ hướng dẫn bạn! ✈️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.48: Câu hỏi về dịch vụ đặt nhà hàng
  const restaurantBookingPattern = lower.match(/(?:đặt nhà hàng|restaurant booking|book restaurant|đặt bàn)/i) ||
                                   lower.match(/(?:có|có dịch vụ|have).*?(?:đặt nhà hàng|restaurant booking)/i);
  if (restaurantBookingPattern) {
    return {
      text: 'Đặt Bàn Nhà Hàng:\n\n' +
            '🍽️ **Dịch vụ:**\n' +
            '• Đặt bàn tại nhà hàng khách sạn\n' +
            '• Đặt bàn tại nhà hàng bên ngoài\n' +
            '• Tư vấn nhà hàng\n\n' +
            '📞 **Đặt bàn:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn đặt bàn cho bao nhiêu người? Tôi sẽ hướng dẫn bạn! 🍽️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.49: Câu hỏi về dịch vụ đặt tour
  const tourBookingPattern = lower.match(/(?:đặt tour|book tour|tour booking)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:đặt tour|book tour)/i);
  if (tourBookingPattern) {
    return {
      text: 'Đặt Tour:\n\n' +
            '🗺️ **Dịch vụ:**\n' +
            '• Tour trong ngày\n' +
            '• Tour nhiều ngày\n' +
            '• Tour tùy chỉnh\n' +
            '• Hướng dẫn viên\n\n' +
            '📞 **Đặt tour:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n\n' +
            'Bạn muốn tham quan đâu? Tôi sẽ hướng dẫn bạn! 🗺️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.50: Câu hỏi về dịch vụ đặt spa
  const spaBookingPattern = lower.match(/(?:đặt spa|book spa|spa booking)/i) ||
                           lower.match(/(?:có|có dịch vụ|have).*?(?:đặt spa|book spa)/i);
  if (spaBookingPattern) {
    return {
      text: 'Đặt Spa:\n\n' +
            '💆 **Dịch vụ:**\n' +
            '• Massage thư giãn\n' +
            '• Massage trị liệu\n' +
            '• Chăm sóc da mặt\n' +
            '• Gói spa đặc biệt\n\n' +
            '📞 **Đặt dịch vụ:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Hoặc hỏi lễ tân khi check-in\n' +
            '• Đặt trước được khuyến khích\n\n' +
            'Bạn muốn đặt dịch vụ spa nào? Tôi sẽ hướng dẫn bạn! 💆',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.51: Câu hỏi về dịch vụ đặt phòng họp
  const meetingRoomPattern = lower.match(/(?:đặt phòng họp|book meeting room|meeting room booking)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:phòng họp|meeting room)/i);
  if (meetingRoomPattern) {
    return {
      text: 'Đặt Phòng Họp:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Phòng họp nhỏ (10-20 người)\n' +
            '• Phòng họp lớn (50-100 người)\n' +
            '• Thiết bị: Máy chiếu, âm thanh, WiFi\n' +
            '• Dịch vụ ăn uống\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Đặt trước 48 giờ\n\n' +
            'Bạn cần phòng họp cho bao nhiêu người? Tôi sẽ hướng dẫn bạn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.52: Câu hỏi về dịch vụ đặt sự kiện
  const eventBookingPattern2 = lower.match(/(?:đặt sự kiện|book event|event booking)/i) ||
                              lower.match(/(?:có|có dịch vụ|have).*?(?:đặt sự kiện|book event)/i);
  if (eventBookingPattern2) {
    return {
      text: 'Đặt Sự Kiện:\n\n' +
            '🎉 **Dịch vụ:**\n' +
            '• Phòng tổ chức sự kiện\n' +
            '• Trang trí theo chủ đề\n' +
            '• Dịch vụ ẩm thực\n' +
            '• Âm thanh, ánh sáng\n\n' +
            '📞 **Đặt sự kiện:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Đặt trước ít nhất 1 tuần\n\n' +
            'Bạn muốn tổ chức sự kiện gì? Tôi sẽ hướng dẫn bạn! 🎉',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.53: Câu hỏi về dịch vụ đặt phòng cho nhóm
  const groupRoomBookingPattern = lower.match(/(?:đặt phòng nhóm|book group room|group booking)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng nhóm|group booking)/i);
  if (groupRoomBookingPattern) {
    return {
      text: 'Đặt Phòng Nhóm:\n\n' +
            '👥 **Dịch vụ:**\n' +
            '• Đặt nhiều phòng\n' +
            '• Giá ưu đãi cho nhóm\n' +
            '• Sắp xếp phòng gần nhau\n' +
            '• Dịch vụ bổ sung\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết số lượng phòng và ngày\n\n' +
            'Bạn cần đặt bao nhiêu phòng? Tôi sẽ hướng dẫn bạn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.54: Câu hỏi về dịch vụ đặt phòng dài hạn
  const longTermBookingPattern = lower.match(/(?:đặt phòng dài hạn|long term booking|monthly booking)/i) ||
                                lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng dài hạn|long term)/i);
  if (longTermBookingPattern) {
    return {
      text: 'Đặt Phòng Dài Hạn:\n\n' +
            '📅 **Dịch vụ:**\n' +
            '• Đặt phòng theo tuần/tháng\n' +
            '• Giá ưu đãi cho đặt dài hạn\n' +
            '• Dịch vụ đầy đủ\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết thời gian và số người\n\n' +
            'Bạn muốn đặt phòng trong bao lâu? Tôi sẽ hướng dẫn bạn! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.55: Câu hỏi về dịch vụ đặt phòng cho khách doanh nghiệp
  const corporateBookingPattern = lower.match(/(?:đặt phòng doanh nghiệp|corporate booking|business booking)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng doanh nghiệp|corporate)/i);
  if (corporateBookingPattern) {
    return {
      text: 'Đặt Phòng Doanh Nghiệp:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Giá ưu đãi cho doanh nghiệp\n' +
            '• Hóa đơn VAT\n' +
            '• Dịch vụ bổ sung\n' +
            '• Phòng họp\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết thông tin công ty\n\n' +
            'Bạn là doanh nghiệp nào? Tôi sẽ hướng dẫn bạn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.56: Câu hỏi về dịch vụ đặt phòng cho khách VIP
  const vipBookingPattern = lower.match(/(?:đặt phòng vip|vip booking|vip service)/i) ||
                          lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng vip|vip service)/i);
  if (vipBookingPattern) {
    return {
      text: 'Đặt Phòng VIP:\n\n' +
            '⭐ **Dịch vụ:**\n' +
            '• Phòng VIP cao cấp\n' +
            '• Dịch vụ đặc biệt\n' +
            '• Ưu tiên check-in/check-out\n' +
            '• Dịch vụ bổ sung\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết yêu cầu đặc biệt\n\n' +
            'Bạn muốn đặt phòng VIP cho ngày nào? Tôi sẽ hướng dẫn bạn! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.57: Câu hỏi về dịch vụ đặt phòng cho khách thường xuyên
  const loyaltyBookingPattern = lower.match(/(?:đặt phòng khách thường xuyên|loyalty booking|regular guest)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng khách thường xuyên|loyalty)/i);
  if (loyaltyBookingPattern) {
    return {
      text: 'Đặt Phòng Khách Thường Xuyên:\n\n' +
            '⭐ **Ưu đãi:**\n' +
            '• Giá ưu đãi cho khách quay lại\n' +
            '• Tích điểm thưởng\n' +
            '• Ưu tiên phòng đẹp\n' +
            '• Dịch vụ đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết bạn là khách thường xuyên\n\n' +
            'Bạn đã từng ở khách sạn chưa? Tôi sẽ kiểm tra và áp dụng ưu đãi cho bạn! ⭐',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.58: Câu hỏi về dịch vụ đặt phòng cho khách quốc tế
  const internationalBookingPattern = lower.match(/(?:đặt phòng khách quốc tế|international booking|foreign guest)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng khách quốc tế|international)/i);
  if (internationalBookingPattern) {
    return {
      text: 'Đặt Phòng Khách Quốc Tế:\n\n' +
            '🌍 **Dịch vụ:**\n' +
            '• Hỗ trợ đa ngôn ngữ\n' +
            '• Đổi tiền tệ\n' +
            '• Hướng dẫn du lịch\n' +
            '• Dịch vụ đưa đón sân bay\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quốc tịch và yêu cầu\n\n' +
            'Bạn là khách quốc tế? Tôi sẽ hỗ trợ bạn! 🌍',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.59: Câu hỏi về dịch vụ đặt phòng cho khách có nhu cầu đặc biệt
  const specialNeedsBookingPattern = lower.match(/(?:đặt phòng nhu cầu đặc biệt|special needs booking|disabled booking)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng nhu cầu đặc biệt|special needs)/i);
  if (specialNeedsBookingPattern) {
    return {
      text: 'Đặt Phòng Nhu Cầu Đặc Biệt:\n\n' +
            '♿ **Dịch vụ:**\n' +
            '• Phòng cho người khuyết tật\n' +
            '• Phòng cho người già\n' +
            '• Phòng cho người bị dị ứng\n' +
            '• Tiện nghi đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết nhu cầu đặc biệt\n\n' +
            'Bạn có nhu cầu đặc biệt gì? Tôi sẽ sắp xếp phòng phù hợp! ♿',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.60: Câu hỏi về dịch vụ đặt phòng cho khách có thú cưng
  const petBookingPattern = lower.match(/(?:đặt phòng thú cưng|pet booking|pet friendly)/i) ||
                           lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng thú cưng|pet friendly)/i);
  if (petBookingPattern) {
    return {
      text: 'Đặt Phòng Thú Cưng:\n\n' +
            '🐕 **Dịch vụ:**\n' +
            '• Phòng cho phép mang thú cưng\n' +
            '• Có thể phát sinh phí bổ sung\n' +
            '• Cần thông báo trước\n\n' +
            '📋 **Yêu cầu:**\n' +
            '• Thú cưng phải được tiêm phòng\n' +
            '• Có dây xích và rọ mõm (nếu cần)\n' +
            '• Không được để thú cưng ở một mình\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Thông báo khi đặt phòng\n\n' +
            'Bạn có thú cưng loại gì? Tôi sẽ kiểm tra phòng phù hợp! 🐾',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.61: Câu hỏi về dịch vụ đặt phòng cho khách có trẻ em
  const childrenBookingPattern = lower.match(/(?:đặt phòng trẻ em|children booking|family booking)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng trẻ em|children booking)/i);
  if (childrenBookingPattern) {
    return {
      text: 'Đặt Phòng Gia Đình Có Trẻ Em:\n\n' +
            '👨‍👩‍👧‍👦 **Dịch vụ:**\n' +
            '• Phòng rộng rãi cho gia đình\n' +
            '• Giường phụ cho trẻ em\n' +
            '• Đồ chơi và hoạt động giải trí\n' +
            '• Thực đơn trẻ em\n\n' +
            '💰 **Chính sách trẻ em:**\n' +
            '• Trẻ dưới 6 tuổi: Miễn phí\n' +
            '• Trẻ 6-11 tuổi: Phụ thu 50%\n' +
            '• Trẻ từ 12 tuổi: Tính như người lớn\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết số lượng và độ tuổi trẻ em\n\n' +
            'Bạn có bao nhiêu trẻ em? Tôi sẽ tính giá chính xác! 👨‍👩‍👧‍👦',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.62: Câu hỏi về dịch vụ đặt phòng cho khách tuần trăng mật
  const honeymoonBookingPattern = lower.match(/(?:đặt phòng tuần trăng mật|honeymoon booking|romantic booking)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng tuần trăng mật|honeymoon)/i);
  if (honeymoonBookingPattern) {
    return {
      text: 'Đặt Phòng Tuần Trăng Mật:\n\n' +
            '💑 **Dịch vụ:**\n' +
            '• Phòng Suite view đẹp\n' +
            '• Trang trí phòng đặc biệt\n' +
            '• Rượu champagne\n' +
            '• Bánh kem\n' +
            '• Dịch vụ spa đôi\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày và yêu cầu đặc biệt\n\n' +
            'Bạn muốn đặt phòng tuần trăng mật cho ngày nào? Tôi sẽ sắp xếp đặc biệt! 💑',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.63: Câu hỏi về dịch vụ đặt phòng cho khách kỷ niệm
  const anniversaryBookingPattern = lower.match(/(?:đặt phòng kỷ niệm|anniversary booking|celebration booking)/i) ||
                                    lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng kỷ niệm|anniversary)/i);
  if (anniversaryBookingPattern) {
    return {
      text: 'Đặt Phòng Kỷ Niệm:\n\n' +
            '🎉 **Dịch vụ:**\n' +
            '• Phòng VIP hoặc Suite\n' +
            '• Trang trí theo chủ đề\n' +
            '• Bánh kem\n' +
            '• Rượu champagne\n' +
            '• Dịch vụ đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết loại kỷ niệm và ngày\n\n' +
            'Bạn muốn kỷ niệm điều gì? Tôi sẽ sắp xếp đặc biệt! 🎉',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.64: Câu hỏi về dịch vụ đặt phòng cho khách công tác
  const businessTravelBookingPattern = lower.match(/(?:đặt phòng công tác|business travel booking|corporate travel)/i) ||
                                      lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng công tác|business travel)/i);
  if (businessTravelBookingPattern) {
    return {
      text: 'Đặt Phòng Công Tác:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Phòng có bàn làm việc\n' +
            '• WiFi tốc độ cao\n' +
            '• Phòng họp\n' +
            '• Business Center\n' +
            '• Hóa đơn VAT\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá ưu đãi cho doanh nghiệp\n' +
            '• Gói công tác\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết thông tin công ty\n\n' +
            'Bạn là doanh nghiệp nào? Tôi sẽ áp dụng ưu đãi! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.65: Câu hỏi về dịch vụ đặt phòng cho khách nghỉ dưỡng
  const vacationBookingPattern = lower.match(/(?:đặt phòng nghỉ dưỡng|vacation booking|resort booking)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng nghỉ dưỡng|vacation)/i);
  if (vacationBookingPattern) {
    return {
      text: 'Đặt Phòng Nghỉ Dưỡng:\n\n' +
            '🏖️ **Dịch vụ:**\n' +
            '• Phòng view đẹp\n' +
            '• Spa & Wellness\n' +
            '• Bể bơi\n' +
            '• Nhà hàng\n' +
            '• Tour & Du lịch\n\n' +
            '💰 **Gói nghỉ dưỡng:**\n' +
            '• Gói spa\n' +
            '• Gói ăn uống\n' +
            '• Gói tour\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày và gói mong muốn\n\n' +
            'Bạn muốn nghỉ dưỡng bao lâu? Tôi sẽ tư vấn gói phù hợp! 🏖️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.66: Câu hỏi về dịch vụ đặt phòng cho khách lễ hội
  const festivalBookingPattern = lower.match(/(?:đặt phòng lễ hội|festival booking|holiday booking)/i) ||
                                lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng lễ hội|festival)/i);
  if (festivalBookingPattern) {
    return {
      text: 'Đặt Phòng Lễ Hội:\n\n' +
            '🎊 **Lưu ý:**\n' +
            '• Lễ hội thường đông, nên đặt sớm\n' +
            '• Giá có thể cao hơn bình thường\n' +
            '• Có thể có yêu cầu đặt tối thiểu số đêm\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Đặt sớm để có giá tốt\n' +
            '• Gói lễ hội đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày lễ hội\n\n' +
            'Bạn muốn đặt phòng cho lễ hội nào? Tôi sẽ kiểm tra giá! 🎊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.67: Câu hỏi về dịch vụ đặt phòng cho khách cuối tuần
  const weekendBookingPattern2 = lower.match(/(?:đặt phòng cuối tuần|weekend booking)/i) ||
                                lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng cuối tuần|weekend)/i);
  if (weekendBookingPattern2) {
    return {
      text: 'Đặt Phòng Cuối Tuần:\n\n' +
            '📅 **Lưu ý:**\n' +
            '• Cuối tuần thường đông\n' +
            '• Giá có thể cao hơn ngày thường\n' +
            '• Nên đặt sớm để có giá tốt\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Gói cuối tuần\n' +
            '• Đặt sớm để có giá tốt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày cuối tuần\n\n' +
            'Bạn muốn đặt phòng cho cuối tuần nào? Tôi sẽ kiểm tra giá! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.68: Câu hỏi về dịch vụ đặt phòng cho khách mùa cao điểm
  const peakSeasonBookingPattern = lower.match(/(?:đặt phòng mùa cao điểm|peak season booking)/i) ||
                                   lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng mùa cao điểm|peak season)/i);
  if (peakSeasonBookingPattern) {
    return {
      text: 'Đặt Phòng Mùa Cao Điểm:\n\n' +
            '📅 **Mùa cao điểm:**\n' +
            '• Tết, lễ hội\n' +
            '• Cuối tuần\n' +
            '• Mùa du lịch\n\n' +
            '💰 **Lưu ý:**\n' +
            '• Giá cao hơn bình thường\n' +
            '• Nên đặt sớm để có giá tốt\n' +
            '• Có thể có yêu cầu đặt tối thiểu\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày mùa cao điểm\n\n' +
            'Bạn muốn đặt phòng cho mùa cao điểm nào? Tôi sẽ kiểm tra giá! 📅',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.69: Câu hỏi về dịch vụ đặt phòng cho khách mùa thấp điểm
  const lowSeasonBookingPattern = lower.match(/(?:đặt phòng mùa thấp điểm|low season booking)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng mùa thấp điểm|low season)/i);
  if (lowSeasonBookingPattern) {
    return {
      text: 'Đặt Phòng Mùa Thấp Điểm:\n\n' +
            '📅 **Mùa thấp điểm:**\n' +
            '• Ngày thường\n' +
            '• Ngoài mùa du lịch\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt hơn\n' +
            '• Nhiều lựa chọn phòng\n' +
            '• Gói ưu đãi đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày mùa thấp điểm\n\n' +
            'Bạn muốn đặt phòng cho ngày nào? Tôi sẽ tìm giá tốt nhất! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.70: Câu hỏi về dịch vụ đặt phòng cho khách last minute
  const lastMinuteBookingPattern = lower.match(/(?:đặt phòng last minute|last minute booking|đặt phòng gấp)/i) ||
                                   lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng last minute|last minute)/i);
  if (lastMinuteBookingPattern) {
    return {
      text: 'Đặt Phòng Last Minute:\n\n' +
            '⏰ **Lưu ý:**\n' +
            '• Đặt gần ngày có thể có giá cao hơn\n' +
            '• Tùy tình trạng phòng trống\n' +
            '• Nên đặt sớm để có giá tốt\n\n' +
            '💰 **Giá:**\n' +
            '• Tùy theo phòng còn trống\n' +
            '• Có thể có giá đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày cần đặt\n\n' +
            'Bạn cần đặt phòng cho ngày nào? Tôi sẽ kiểm tra ngay! ⏰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.71: Câu hỏi về dịch vụ đặt phòng cho khách early bird
  const earlyBirdBookingPattern = lower.match(/(?:đặt phòng early bird|early bird booking|đặt phòng sớm)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng early bird|early bird)/i);
  if (earlyBirdBookingPattern) {
    return {
      text: 'Đặt Phòng Early Bird:\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt nhất khi đặt sớm\n' +
            '• Nhiều lựa chọn phòng\n' +
            '• Đảm bảo phòng\n\n' +
            '💡 **Lời khuyên:**\n' +
            '• Đặt càng sớm càng tốt\n' +
            '• Tránh đặt vào phút chót\n' +
            '• Theo dõi ưu đãi\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết ngày muốn đặt\n\n' +
            'Bạn muốn đặt phòng cho ngày nào? Tôi sẽ tìm giá tốt nhất! 💰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.72: Câu hỏi về dịch vụ đặt phòng cho khách group tour
  const groupTourBookingPattern = lower.match(/(?:đặt phòng group tour|group tour booking|tour group)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng group tour|tour group)/i);
  if (groupTourBookingPattern) {
    return {
      text: 'Đặt Phòng Group Tour:\n\n' +
            '👥 **Dịch vụ:**\n' +
            '• Đặt nhiều phòng cho đoàn\n' +
            '• Giá ưu đãi cho nhóm\n' +
            '• Sắp xếp phòng gần nhau\n' +
            '• Dịch vụ bổ sung\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói tour đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết số lượng phòng và ngày\n\n' +
            'Bạn cần đặt bao nhiêu phòng? Tôi sẽ tính giá tốt nhất! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.73: Câu hỏi về dịch vụ đặt phòng cho khách incentive
  const incentiveBookingPattern = lower.match(/(?:đặt phòng incentive|incentive booking|khuyến khích)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng incentive|incentive)/i);
  if (incentiveBookingPattern) {
    return {
      text: 'Đặt Phòng Incentive:\n\n' +
            '🎁 **Dịch vụ:**\n' +
            '• Gói khuyến khích đặc biệt\n' +
            '• Giá ưu đãi\n' +
            '• Dịch vụ bổ sung\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết yêu cầu incentive\n\n' +
            'Bạn muốn gói incentive nào? Tôi sẽ tư vấn! 🎁',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.74: Câu hỏi về dịch vụ đặt phòng cho khách MICE
  const miceBookingPattern = lower.match(/(?:đặt phòng mice|mice booking|hội nghị)/i) ||
                            lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng mice|mice)/i);
  if (miceBookingPattern) {
    return {
      text: 'Đặt Phòng MICE:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Phòng họp\n' +
            '• Phòng nghỉ\n' +
            '• Dịch vụ ăn uống\n' +
            '• Thiết bị hội nghị\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói MICE đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô hội nghị\n\n' +
            'Bạn muốn tổ chức hội nghị cho bao nhiêu người? Tôi sẽ tư vấn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.75: Câu hỏi về dịch vụ đặt phòng cho khách wedding
  const weddingBookingPattern = lower.match(/(?:đặt phòng wedding|wedding booking|hôn nhân)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng wedding|wedding)/i);
  if (weddingBookingPattern) {
    return {
      text: 'Đặt Phòng Wedding:\n\n' +
            '💒 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho khách mời\n' +
            '• Phòng tổ chức tiệc cưới\n' +
            '• Trang trí theo chủ đề\n' +
            '• Dịch vụ ẩm thực\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói wedding đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô tiệc cưới\n\n' +
            'Bạn muốn tổ chức tiệc cưới cho bao nhiêu người? Tôi sẽ tư vấn! 💒',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.76: Câu hỏi về dịch vụ đặt phòng cho khách retreat
  const retreatBookingPattern = lower.match(/(?:đặt phòng retreat|retreat booking|tĩnh dưỡng)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng retreat|retreat)/i);
  if (retreatBookingPattern) {
    return {
      text: 'Đặt Phòng Retreat:\n\n' +
            '🧘 **Dịch vụ:**\n' +
            '• Phòng yên tĩnh\n' +
            '• Spa & Wellness\n' +
            '• Yoga & Meditation\n' +
            '• Thực đơn healthy\n\n' +
            '💰 **Gói retreat:**\n' +
            '• Gói spa\n' +
            '• Gói yoga\n' +
            '• Gói tĩnh dưỡng\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết loại retreat\n\n' +
            'Bạn muốn retreat loại gì? Tôi sẽ tư vấn! 🧘',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.77: Câu hỏi về dịch vụ đặt phòng cho khách team building
  const teamBuildingBookingPattern = lower.match(/(?:đặt phòng team building|team building booking)/i) ||
                                    lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng team building|team building)/i);
  if (teamBuildingBookingPattern) {
    return {
      text: 'Đặt Phòng Team Building:\n\n' +
            '👥 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho nhóm\n' +
            '• Khu vực team building\n' +
            '• Dịch vụ ăn uống\n' +
            '• Hoạt động team building\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói team building đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô nhóm\n\n' +
            'Bạn muốn team building cho bao nhiêu người? Tôi sẽ tư vấn! 👥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.78: Câu hỏi về dịch vụ đặt phòng cho khách training
  const trainingBookingPattern = lower.match(/(?:đặt phòng training|training booking|đào tạo)/i) ||
                                lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng training|training)/i);
  if (trainingBookingPattern) {
    return {
      text: 'Đặt Phòng Training:\n\n' +
            '📚 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho học viên\n' +
            '• Phòng đào tạo\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói training đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô khóa học\n\n' +
            'Bạn muốn đào tạo cho bao nhiêu người? Tôi sẽ tư vấn! 📚',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.79: Câu hỏi về dịch vụ đặt phòng cho khách conference
  const conferenceBookingPattern = lower.match(/(?:đặt phòng conference|conference booking|hội nghị)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng conference|conference)/i);
  if (conferenceBookingPattern) {
    return {
      text: 'Đặt Phòng Conference:\n\n' +
            '💼 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đại biểu\n' +
            '• Phòng hội nghị\n' +
            '• Thiết bị hội nghị\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói conference đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô hội nghị\n\n' +
            'Bạn muốn tổ chức hội nghị cho bao nhiêu người? Tôi sẽ tư vấn! 💼',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.80: Câu hỏi về dịch vụ đặt phòng cho khách seminar
  const seminarBookingPattern = lower.match(/(?:đặt phòng seminar|seminar booking)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng seminar|seminar)/i);
  if (seminarBookingPattern) {
    return {
      text: 'Đặt Phòng Seminar:\n\n' +
            '📊 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Phòng seminar\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói seminar đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô seminar\n\n' +
            'Bạn muốn tổ chức seminar cho bao nhiêu người? Tôi sẽ tư vấn! 📊',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.81: Câu hỏi về dịch vụ đặt phòng cho khách workshop
  const workshopBookingPattern = lower.match(/(?:đặt phòng workshop|workshop booking)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng workshop|workshop)/i);
  if (workshopBookingPattern) {
    return {
      text: 'Đặt Phòng Workshop:\n\n' +
            '🔧 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Phòng workshop\n' +
            '• Thiết bị cần thiết\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói workshop đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô workshop\n\n' +
            'Bạn muốn tổ chức workshop cho bao nhiêu người? Tôi sẽ tư vấn! 🔧',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.82: Câu hỏi về dịch vụ đặt phòng cho khách exhibition
  const exhibitionBookingPattern = lower.match(/(?:đặt phòng exhibition|exhibition booking|triển lãm)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng exhibition|exhibition)/i);
  if (exhibitionBookingPattern) {
    return {
      text: 'Đặt Phòng Exhibition:\n\n' +
            '🎨 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian triển lãm\n' +
            '• Thiết bị cần thiết\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói exhibition đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô triển lãm\n\n' +
            'Bạn muốn tổ chức triển lãm cho bao nhiêu người? Tôi sẽ tư vấn! 🎨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.83: Câu hỏi về dịch vụ đặt phòng cho khách gala dinner
  const galaDinnerBookingPattern = lower.match(/(?:đặt phòng gala dinner|gala dinner booking|tiệc gala)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng gala dinner|gala dinner)/i);
  if (galaDinnerBookingPattern) {
    return {
      text: 'Đặt Phòng Gala Dinner:\n\n' +
            '🍽️ **Dịch vụ:**\n' +
            '• Phòng nghỉ cho khách mời\n' +
            '• Không gian tiệc gala\n' +
            '• Dịch vụ ẩm thực cao cấp\n' +
            '• Trang trí theo chủ đề\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói gala dinner đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô tiệc gala\n\n' +
            'Bạn muốn tổ chức tiệc gala cho bao nhiêu người? Tôi sẽ tư vấn! 🍽️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.84: Câu hỏi về dịch vụ đặt phòng cho khách product launch
  const productLaunchBookingPattern = lower.match(/(?:đặt phòng product launch|product launch booking|ra mắt sản phẩm)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng product launch|product launch)/i);
  if (productLaunchBookingPattern) {
    return {
      text: 'Đặt Phòng Product Launch:\n\n' +
            '🚀 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho khách mời\n' +
            '• Không gian ra mắt sản phẩm\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ẩm thực\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói product launch đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn ra mắt sản phẩm cho bao nhiêu người? Tôi sẽ tư vấn! 🚀',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.85: Câu hỏi về dịch vụ đặt phòng cho khách press conference
  const pressConferenceBookingPattern = lower.match(/(?:đặt phòng press conference|press conference booking|họp báo)/i) ||
                                       lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng press conference|press conference)/i);
  if (pressConferenceBookingPattern) {
    return {
      text: 'Đặt Phòng Press Conference:\n\n' +
            '📰 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho phóng viên\n' +
            '• Phòng họp báo\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói press conference đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô họp báo\n\n' +
            'Bạn muốn tổ chức họp báo cho bao nhiêu người? Tôi sẽ tư vấn! 📰',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.86: Câu hỏi về dịch vụ đặt phòng cho khách award ceremony
  const awardCeremonyBookingPattern = lower.match(/(?:đặt phòng award ceremony|award ceremony booking|lễ trao giải)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng award ceremony|award ceremony)/i);
  if (awardCeremonyBookingPattern) {
    return {
      text: 'Đặt Phòng Award Ceremony:\n\n' +
            '🏆 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho khách mời\n' +
            '• Không gian lễ trao giải\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ẩm thực\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói award ceremony đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô lễ trao giải\n\n' +
            'Bạn muốn tổ chức lễ trao giải cho bao nhiêu người? Tôi sẽ tư vấn! 🏆',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.87: Câu hỏi về dịch vụ đặt phòng cho khách networking event
  const networkingEventBookingPattern = lower.match(/(?:đặt phòng networking event|networking event booking|sự kiện networking)/i) ||
                                       lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng networking event|networking event)/i);
  if (networkingEventBookingPattern) {
    return {
      text: 'Đặt Phòng Networking Event:\n\n' +
            '🤝 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian networking\n' +
            '• Dịch vụ ăn uống\n' +
            '• Bar & Lounge\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói networking event đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn tổ chức networking event cho bao nhiêu người? Tôi sẽ tư vấn! 🤝',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.88: Câu hỏi về dịch vụ đặt phòng cho khách charity event
  const charityEventBookingPattern = lower.match(/(?:đặt phòng charity event|charity event booking|sự kiện từ thiện)/i) ||
                                    lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng charity event|charity event)/i);
  if (charityEventBookingPattern) {
    return {
      text: 'Đặt Phòng Charity Event:\n\n' +
            '❤️ **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian sự kiện từ thiện\n' +
            '• Dịch vụ ăn uống\n' +
            '• Hỗ trợ tổ chức\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói charity event đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn tổ chức sự kiện từ thiện cho bao nhiêu người? Tôi sẽ tư vấn! ❤️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.89: Câu hỏi về dịch vụ đặt phòng cho khách cultural event
  const culturalEventBookingPattern = lower.match(/(?:đặt phòng cultural event|cultural event booking|sự kiện văn hóa)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng cultural event|cultural event)/i);
  if (culturalEventBookingPattern) {
    return {
      text: 'Đặt Phòng Cultural Event:\n\n' +
            '🎭 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian sự kiện văn hóa\n' +
            '• Dịch vụ ăn uống\n' +
            '• Hỗ trợ tổ chức\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói cultural event đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn tổ chức sự kiện văn hóa cho bao nhiêu người? Tôi sẽ tư vấn! 🎭',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.90: Câu hỏi về dịch vụ đặt phòng cho khách music event
  const musicEventBookingPattern = lower.match(/(?:đặt phòng music event|music event booking|sự kiện âm nhạc)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng music event|music event)/i);
  if (musicEventBookingPattern) {
    return {
      text: 'Đặt Phòng Music Event:\n\n' +
            '🎵 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian sự kiện âm nhạc\n' +
            '• Thiết bị âm thanh\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói music event đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn tổ chức sự kiện âm nhạc cho bao nhiêu người? Tôi sẽ tư vấn! 🎵',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.91: Câu hỏi về dịch vụ đặt phòng cho khách fashion show
  const fashionShowBookingPattern = lower.match(/(?:đặt phòng fashion show|fashion show booking|trình diễn thời trang)/i) ||
                                   lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng fashion show|fashion show)/i);
  if (fashionShowBookingPattern) {
    return {
      text: 'Đặt Phòng Fashion Show:\n\n' +
            '👗 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian trình diễn thời trang\n' +
            '• Sân khấu và ánh sáng\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói fashion show đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô trình diễn\n\n' +
            'Bạn muốn tổ chức trình diễn thời trang cho bao nhiêu người? Tôi sẽ tư vấn! 👗',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.92: Câu hỏi về dịch vụ đặt phòng cho khách art exhibition
  const artExhibitionBookingPattern = lower.match(/(?:đặt phòng art exhibition|art exhibition booking|triển lãm nghệ thuật)/i) ||
                                     lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng art exhibition|art exhibition)/i);
  if (artExhibitionBookingPattern) {
    return {
      text: 'Đặt Phòng Art Exhibition:\n\n' +
            '🎨 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian triển lãm nghệ thuật\n' +
            '• Hệ thống ánh sáng\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói art exhibition đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô triển lãm\n\n' +
            'Bạn muốn tổ chức triển lãm nghệ thuật cho bao nhiêu người? Tôi sẽ tư vấn! 🎨',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.93: Câu hỏi về dịch vụ đặt phòng cho khách book launch
  const bookLaunchBookingPattern = lower.match(/(?:đặt phòng book launch|book launch booking|ra mắt sách)/i) ||
                                  lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng book launch|book launch)/i);
  if (bookLaunchBookingPattern) {
    return {
      text: 'Đặt Phòng Book Launch:\n\n' +
            '📚 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho khách mời\n' +
            '• Không gian ra mắt sách\n' +
            '• Thiết bị trình chiếu\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói book launch đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô sự kiện\n\n' +
            'Bạn muốn ra mắt sách cho bao nhiêu người? Tôi sẽ tư vấn! 📚',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.94: Câu hỏi về dịch vụ đặt phòng cho khách film screening
  const filmScreeningBookingPattern = lower.match(/(?:đặt phòng film screening|film screening booking|chiếu phim)/i) ||
                                      lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng film screening|film screening)/i);
  if (filmScreeningBookingPattern) {
    return {
      text: 'Đặt Phòng Film Screening:\n\n' +
            '🎬 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho người tham dự\n' +
            '• Không gian chiếu phim\n' +
            '• Thiết bị chiếu phim\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói film screening đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô chiếu phim\n\n' +
            'Bạn muốn chiếu phim cho bao nhiêu người? Tôi sẽ tư vấn! 🎬',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.95: Câu hỏi về dịch vụ đặt phòng cho khách photo shoot
  const photoShootBookingPattern = lower.match(/(?:đặt phòng photo shoot|photo shoot booking|chụp ảnh)/i) ||
                                   lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng photo shoot|photo shoot)/i);
  if (photoShootBookingPattern) {
    return {
      text: 'Đặt Phòng Photo Shoot:\n\n' +
            '📸 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian chụp ảnh\n' +
            '• Hệ thống ánh sáng\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói photo shoot đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô chụp ảnh\n\n' +
            'Bạn muốn chụp ảnh cho bao nhiêu người? Tôi sẽ tư vấn! 📸',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.96: Câu hỏi về dịch vụ đặt phòng cho khách video production
  const videoProductionBookingPattern = lower.match(/(?:đặt phòng video production|video production booking|quay phim)/i) ||
                                       lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng video production|video production)/i);
  if (videoProductionBookingPattern) {
    return {
      text: 'Đặt Phòng Video Production:\n\n' +
            '🎥 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian quay phim\n' +
            '• Thiết bị quay phim\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói video production đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô quay phim\n\n' +
            'Bạn muốn quay phim cho bao nhiêu người? Tôi sẽ tư vấn! 🎥',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.97: Câu hỏi về dịch vụ đặt phòng cho khách live streaming
  const liveStreamingBookingPattern = lower.match(/(?:đặt phòng live streaming|live streaming booking|phát trực tiếp)/i) ||
                                      lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng live streaming|live streaming)/i);
  if (liveStreamingBookingPattern) {
    return {
      text: 'Đặt Phòng Live Streaming:\n\n' +
            '📡 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian phát trực tiếp\n' +
            '• Thiết bị phát trực tiếp\n' +
            '• Internet tốc độ cao\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói live streaming đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô phát trực tiếp\n\n' +
            'Bạn muốn phát trực tiếp cho bao nhiêu người? Tôi sẽ tư vấn! 📡',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.98: Câu hỏi về dịch vụ đặt phòng cho khách podcast recording
  const podcastRecordingBookingPattern = lower.match(/(?:đặt phòng podcast recording|podcast recording booking|ghi âm podcast)/i) ||
                                        lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng podcast recording|podcast recording)/i);
  if (podcastRecordingBookingPattern) {
    return {
      text: 'Đặt Phòng Podcast Recording:\n\n' +
            '🎙️ **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian ghi âm podcast\n' +
            '• Thiết bị ghi âm\n' +
            '• Yên tĩnh\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói podcast recording đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô ghi âm\n\n' +
            'Bạn muốn ghi âm podcast cho bao nhiêu người? Tôi sẽ tư vấn! 🎙️',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.99: Câu hỏi về dịch vụ đặt phòng cho khách radio show
  const radioShowBookingPattern = lower.match(/(?:đặt phòng radio show|radio show booking|chương trình radio)/i) ||
                                 lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng radio show|radio show)/i);
  if (radioShowBookingPattern) {
    return {
      text: 'Đặt Phòng Radio Show:\n\n' +
            '📻 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian chương trình radio\n' +
            '• Thiết bị phát thanh\n' +
            '• Yên tĩnh\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói radio show đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô chương trình\n\n' +
            'Bạn muốn tổ chức chương trình radio cho bao nhiêu người? Tôi sẽ tư vấn! 📻',
      rooms: null,
      hasRooms: false
    };
  }

  // Pattern 2.100: Câu hỏi về dịch vụ đặt phòng cho khách TV show
  const tvShowBookingPattern2 = lower.match(/(?:đặt phòng tv show|tv show booking|chương trình truyền hình)/i) ||
                               lower.match(/(?:có|có dịch vụ|have).*?(?:đặt phòng tv show|tv show)/i);
  if (tvShowBookingPattern2) {
    return {
      text: 'Đặt Phòng TV Show:\n\n' +
            '📺 **Dịch vụ:**\n' +
            '• Phòng nghỉ cho đoàn làm phim\n' +
            '• Không gian chương trình truyền hình\n' +
            '• Thiết bị quay phim\n' +
            '• Dịch vụ ăn uống\n\n' +
            '💰 **Ưu đãi:**\n' +
            '• Giá tốt cho đặt nhiều phòng\n' +
            '• Gói TV show đặc biệt\n\n' +
            '📞 **Đặt phòng:**\n' +
            '• Gọi hotline: 0901 234 567\n' +
            '• Email: info@rayalpark.com\n' +
            '• Cho biết quy mô chương trình\n\n' +
            'Bạn muốn tổ chức chương trình truyền hình cho bao nhiêu người? Tôi sẽ tư vấn! 📺',
      rooms: null,
      hasRooms: false
    };
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
  
  // ✅ ƯU TIÊN: Pattern-based trước rule-based để trả lời dịch vụ theo config
  // ⚠️ TEMPORARILY DISABLED FOR RAG TESTING - Cache
  // TODO: Re-enable after RAG testing
  /*
  const cachedResponse = await getCachedResponse(userMessage);
  if (cachedResponse) {
    return cachedResponse;
  }
  */

  const patternBasedResponse = await getPatternBasedResponse(userMessage, context);
  if (patternBasedResponse) {
    console.log('✅ Using pattern-based response (no API call)');
    await setCachedResponse(userMessage, patternBasedResponse);
    return patternBasedResponse;
  }

  // ⚠️ TEMPORARILY DISABLED FOR RAG TESTING - Rule-based
  // TODO: Re-enable after RAG testing
  /*
  // ✅ Rule-based sau pattern (vẫn không tốn Gemini)
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
  */
  
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
  
  // ✅ Nhận diện ý định đổi ngày (mở rộng từ khóa)
  const isChangeDateIntent = [
    "đổi ngày", "đổi lịch", "thay đổi ngày", "thay đổi lịch",
    "đi ngày khác", "ngày khác", "đổi ngày nhận", "đổi ngày trả",
    "đổi checkin", "đổi checkout", "dời ngày", "dời lịch", "reschedule",
    "change date", "change dates", "change booking date",
    "change check-in", "change checkin", "change check out", "update date", "move date"
  ].some(k => lowerMessage.includes(k));

  const changeCurrentRoomIntent = isChangeDateIntent && (
    lowerMessage.includes("phòng này") || lowerMessage.includes("phòng đang xem") || lowerMessage.includes("giữ phòng") || lowerMessage.includes("giữ phòng này")
  );

  const changeAllRoomsIntent = isChangeDateIntent && (
    lowerMessage.includes("tất cả") || lowerMessage.includes("xem tất cả") || lowerMessage.includes("xem hết") || lowerMessage.includes("all room") || lowerMessage.includes("all rooms") ||
    ((lowerMessage.includes("phòng khác") || lowerMessage.includes("đặt phòng khác")) && (lowerMessage.includes("ngày khác") || lowerMessage.includes("đổi ngày")))
  );

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
    // ✅ SỬA: Chỉ nhận diện "view biển/núi" khi có từ "phòng" trong câu (tìm phòng view biển), không phải hỏi về địa điểm bãi biển/núi
    ((lowerMessage.includes("phòng") && (lowerMessage.includes("view biển") || lowerMessage.includes("view núi") || lowerMessage.includes("phòng biển") || lowerMessage.includes("phòng núi") || lowerMessage.includes("hướng biển") || lowerMessage.includes("hướng núi"))) && !hasRoomList) ||
    // ✅ Nhận diện cung cấp ngày check-in/out (kể cả có chữ "ngày nhận/ngày trả")
    (lowerMessage.match(/\d{1,2}\/\d{1,2}/) && !hasRoomList) ||
    lowerMessage.includes("ngày nhận") ||
    lowerMessage.includes("ngày trả") ||
    lowerMessage.includes("check-in") ||
    lowerMessage.includes("check-out") ||
    ((lowerMessage.includes("hôm nay") || lowerMessage.includes("ngày mai") || lowerMessage.includes("ngày kia")) && !hasRoomList) ||
    changeAllRoomsIntent || changeCurrentRoomIntent
  );

  let roomSearchResults = null;
  let searchCriteria = null;
  
  // ✅ Nếu user đã chọn phương án đổi ngày cho phòng đang xem
  if (changeCurrentRoomIntent && hasSelectedRoom) {
    // Clear pending flag
    if (bookingContext.pendingChangeDateChoice) delete bookingContext.pendingChangeDateChoice;
    context.bookingContext = bookingContext;
    return {
      text: 'Bạn muốn đổi ngày cho phòng đang xem. Vui lòng cung cấp ngày nhận/trả mới (dd/mm/yyyy) để mình kiểm tra phòng này còn trống không. Nếu cần phòng khác, gõ "xem tất cả phòng trống".',
      rooms: context.selectedRoom ? [context.selectedRoom] : null,
      hasRooms: !!context.selectedRoom,
      bookingContext: context.bookingContext
    };
  }

  // ✅ Nếu user đã chọn phương án xem tất cả phòng trống theo ngày mới
  if (changeAllRoomsIntent) {
    if (bookingContext.pendingChangeDateChoice) delete bookingContext.pendingChangeDateChoice;
    // Xóa selectedRoom và roomId để tìm mới hoàn toàn
    context.selectedRoom = null;
    delete bookingContext.roomId;
    delete bookingContext.roomName;
    // Xóa ngày cũ để buộc nhập ngày mới
    delete bookingContext.checkInDate;
    delete bookingContext.checkOutDate;
    context.bookingContext = bookingContext;
    // Xóa list phòng cũ trong context để không fallback
    delete context.lastRoomSearchResults;
    return {
      text: 'Bạn muốn đặt phòng khác vào ngày khác. Vui lòng nhập ngày nhận phòng và ngày trả phòng mới (dd/mm/yyyy) cùng số khách để mình tìm lại danh sách phòng mới cho bạn.',
      rooms: null,
      hasRooms: false,
      bookingContext: context.bookingContext
    };
  }

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
  
  // ✅ FIX: Phát hiện khi user thay đổi thông tin (ngày/số người) sau khi đã chọn phòng
  // Parse thông tin mới từ message
  const parsedIntent = parseBookingIntent(userMessage, context);
  const newCheckInDate = parsedIntent.checkInDate ? new Date(parsedIntent.checkInDate) : null;
  const newCheckOutDate = parsedIntent.checkOutDate ? new Date(parsedIntent.checkOutDate) : null;
  const newGuests = parsedIntent.maxOccupancy || parsedIntent.adults || null;
  
  // So sánh với thông tin cũ trong bookingContext
  const oldCheckInDate = bookingContext.checkInDate ? new Date(bookingContext.checkInDate) : null;
  const oldCheckOutDate = bookingContext.checkOutDate ? new Date(bookingContext.checkOutDate) : null;
  const oldGuests = bookingContext.guests || bookingContext.maxOccupancy || null;
  
  // ✅ Nếu user nói đổi ngày/đổi lịch trong khi đã có phòng đang xem, nhưng chưa chọn phương án
  if (isChangeDateIntent && hasSelectedRoom && !changeCurrentRoomIntent && !changeAllRoomsIntent) {
    context.bookingContext = bookingContext;
    context.bookingContext.pendingChangeDateChoice = true;
    return {
      text: 'Bạn muốn đổi ngày cho phòng đang xem, hay xem tất cả phòng trống theo ngày mới?\n\n' +
            '• Gõ "đổi ngày phòng này" để giữ phòng hiện tại và kiểm tra lại ngày mới.\n' +
            '• Gõ "xem tất cả phòng trống" để xem danh sách phòng theo ngày mới.\n\n' +
            'Vui lòng cho mình biết ngày nhận/trả mới (dd/mm/yyyy) để kiểm tra.',
      rooms: context.selectedRoom ? [context.selectedRoom] : null,
      hasRooms: !!context.selectedRoom,
      bookingContext: context.bookingContext
    };
  }

  // Kiểm tra xem có thay đổi không
  const datesChanged = (newCheckInDate && oldCheckInDate && 
    newCheckInDate.getTime() !== oldCheckInDate.getTime()) ||
    (newCheckOutDate && oldCheckOutDate && 
    newCheckOutDate.getTime() !== oldCheckOutDate.getTime());
  const guestsChanged = newGuests && oldGuests && newGuests !== oldGuests;
  const isChangingBookingInfo = hasSelectedRoomOrRoomId && (datesChanged || guestsChanged);
  
  // Nếu user thay đổi thông tin, clear selectedRoom và tìm lại phòng mới
  if (isChangingBookingInfo) {
    console.log('✅ Detected booking info change - clearing selected room and searching again:', {
      datesChanged,
      guestsChanged,
      oldDates: { checkIn: oldCheckInDate, checkOut: oldCheckOutDate },
      newDates: { checkIn: newCheckInDate, checkOut: newCheckOutDate },
      oldGuests,
      newGuests
    });
    // Clear selectedRoom để tìm lại phòng mới
    context.selectedRoom = null;
    context.bookingContext.roomId = null;
    context.shouldNotSearchRooms = false;
    // Update bookingContext với thông tin mới
    if (newCheckInDate) bookingContext.checkInDate = newCheckInDate;
    if (newCheckOutDate) bookingContext.checkOutDate = newCheckOutDate;
    if (newGuests) {
      bookingContext.guests = newGuests;
      bookingContext.maxOccupancy = newGuests;
    }
  }
  
  const isProvidingInfoForSelectedRoom = hasSelectedRoomOrRoomId && !isChangingBookingInfo && (hasDates || hasGuests || 
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
          // ✅ Lưu vào lastRoomSearchResults để user có thể chọn phòng số X
          context.lastRoomSearchResults = roomSearchResults.map((r, idx) => ({
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
    
    // ✅ QUAN TRỌNG: Nếu có context.requestedView (từ câu hỏi trước về view biển), sử dụng nó
    if (context.requestedView && !searchCriteria.view) {
      searchCriteria.view = context.requestedView;
      console.log(`✅ Using saved requestedView from context: ${context.requestedView}`);
    }
    
    // ✅ QUAN TRỌNG: Nếu không có số khách trong message nhưng có trong bookingContext (từ message trước), sử dụng nó
    if (!searchCriteria.maxOccupancy && context.bookingContext) {
      const savedGuests = context.bookingContext.guests || context.bookingContext.maxOccupancy;
      if (savedGuests) {
        searchCriteria.maxOccupancy = savedGuests;
        console.log(`✅ Using saved guests from bookingContext: ${savedGuests}`);
      }
    }
    
    // 🚫 Đừng tìm phòng nếu chưa có đủ ngày + số khách, tránh trả list mặc định
    const hasDatesInCriteria = searchCriteria.checkInDate && searchCriteria.checkOutDate;
    const hasGuestsInCriteria = searchCriteria.guests || searchCriteria.maxOccupancy || searchCriteria.adults;
    
    // ✅ Lưu dates và guests vào context nếu có
    if (searchCriteria.checkInDate || searchCriteria.checkOutDate || searchCriteria.maxOccupancy) {
      if (!context.bookingContext) context.bookingContext = {};
      if (searchCriteria.checkInDate) {
        context.bookingContext.checkInDate = searchCriteria.checkInDate;
      }
      if (searchCriteria.checkOutDate) {
        context.bookingContext.checkOutDate = searchCriteria.checkOutDate;
      }
      if (searchCriteria.maxOccupancy) {
        context.bookingContext.maxOccupancy = searchCriteria.maxOccupancy;
        context.bookingContext.guests = searchCriteria.maxOccupancy;
      }
    }
    
    // Nếu chưa đủ thông tin, không tìm phòng -> để block thiếu thông tin xử lý
    if (!hasDatesInCriteria || !hasGuestsInCriteria) {
      console.log('ℹ️ Skipping searchRooms - missing dates or guests for room search request', {
        hasDatesInCriteria,
        hasGuestsInCriteria,
        searchCriteria,
        savedGuestsFromContext: context.bookingContext?.guests || context.bookingContext?.maxOccupancy
      });
      roomSearchResults = null;
    } else {
      // Tìm phòng với criteria (bao gồm dates để check availability)
      console.log(`🔍 Searching rooms with criteria:`, {
        view: searchCriteria.view,
        maxOccupancy: searchCriteria.maxOccupancy,
        checkInDate: searchCriteria.checkInDate?.toISOString().split('T')[0],
        checkOutDate: searchCriteria.checkOutDate?.toISOString().split('T')[0]
      });
      roomSearchResults = await searchRooms(searchCriteria);
      
      // ✅ Reset requestedView sau khi đã tìm phòng
      if (context.requestedView) {
        console.log(`✅ Reset requestedView after room search`);
        context.requestedView = null;
        if (context.session) {
          context.session.requestedView = null;
        }
      }
    }
    
    // Log để debug (chỉ khi đã thực sự tìm phòng)
    if (searchCriteria.checkInDate && searchCriteria.checkOutDate && roomSearchResults) {
      console.log(`🔍 Searching rooms from ${searchCriteria.checkInDate.toISOString().split('T')[0]} to ${searchCriteria.checkOutDate.toISOString().split('T')[0]}`);
      console.log(`✅ Found ${roomSearchResults.length} available rooms`);
    }
    
    // ✅ Lưu vào lastRoomSearchResults nếu tìm được phòng
    if (roomSearchResults && roomSearchResults.length > 0) {
      context.lastRoomSearchResults = roomSearchResults.map((r, idx) => ({
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
    }
  }

  // ✅ TỐI ƯU: Nếu đã có roomSearchResults từ auto-search hoặc manual search, tạo response template mà KHÔNG cần gọi AI
  if (roomSearchResults && roomSearchResults.length > 0 && !isConfirmingSelectedRoom && !hasSelectedRoom) {
    const bookingContext = context.bookingContext || {};
    const hasDates = bookingContext.checkInDate && bookingContext.checkOutDate;
    const hasGuests = bookingContext.guests || bookingContext.maxOccupancy;
    const language = context.language || 'vi';
    
    // Chỉ tạo template response nếu đây là kết quả tìm phòng (không phải câu hỏi khác)
    const isRoomSearchResult = context.autoSearchedRooms || 
                                (hasDates && hasGuests && !hasSelectedRoom) ||
                                isRoomSearchRequest;
    
    if (isRoomSearchResult) {
      console.log('✅ Using template response for room search results (NO API call)');
      
      // Tính giá chi tiết nếu có dates
      let enrichedRooms = null;
      if (hasDates) {
        const checkIn = new Date(bookingContext.checkInDate);
        const checkOut = new Date(bookingContext.checkOutDate);
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        const roomQuantity = bookingContext.roomQuantity || 1;
        const adults = bookingContext.adults || bookingContext.guests || 1;
        const children = bookingContext.children || [];
        
        enrichedRooms = roomSearchResults.map(room => {
          const priceCalculation = calculateTotalPriceWithChildSurcharge(
            room.pricePerNight,
            nights,
            roomQuantity,
            adults,
            children
          );
          
          return {
            ...room.toObject ? room.toObject() : room,
            id: room._id?.toString?.() || room.id || room._id,
            pricePerNight: room.pricePerNight ?? 0,
            image: room.image || room.thumbnailUrl || null,
            thumbnailUrl: room.thumbnailUrl || room.image || null,
            priceDetails: {
              basePricePerNight: room.pricePerNight,
              nights: nights,
              roomQuantity: roomQuantity,
              baseTotal: priceCalculation.baseTotal,
              childSurcharge: priceCalculation.childSurcharge,
              totalPrice: priceCalculation.totalPrice,
              adults: adults,
              children: children
            }
          };
        });
      } else {
        enrichedRooms = roomSearchResults.map(room => ({
          ...room.toObject ? room.toObject() : room,
          id: room._id?.toString?.() || room.id || room._id,
          pricePerNight: room.pricePerNight ?? 0,
          image: room.image || room.thumbnailUrl || null,
          thumbnailUrl: room.thumbnailUrl || room.image || null,
          priceDetails: {
            basePricePerNight: room.pricePerNight,
            note: language === 'vi' 
              ? 'Chưa có thông tin ngày check-in/out, chưa thể tính tổng giá'
              : 'No check-in/out dates, cannot calculate total price'
          }
        }));
      }
      
      // Tạo response text template
      let responseText = '';
      if (language === 'vi') {
        responseText = `Tôi đã tìm thấy ${roomSearchResults.length} phòng phù hợp với yêu cầu của bạn.\n\n`;
        if (hasDates) {
          const checkInStr = new Date(bookingContext.checkInDate).toLocaleDateString('vi-VN');
          const checkOutStr = new Date(bookingContext.checkOutDate).toLocaleDateString('vi-VN');
          responseText += `📅 **Ngày đặt:** ${checkInStr} - ${checkOutStr}\n`;
        }
        if (hasGuests) {
          responseText += `👥 **Số người:** ${bookingContext.guests || bookingContext.maxOccupancy} người\n\n`;
        }
        responseText += `Vui lòng chọn phòng bạn muốn đặt (gõ số thứ tự hoặc tên phòng).`;
      } else {
        responseText = `I found ${roomSearchResults.length} rooms matching your requirements.\n\n`;
        if (hasDates) {
          const checkInStr = new Date(bookingContext.checkInDate).toLocaleDateString('en-US');
          const checkOutStr = new Date(bookingContext.checkOutDate).toLocaleDateString('en-US');
          responseText += `📅 **Dates:** ${checkInStr} - ${checkOutStr}\n`;
        }
        if (hasGuests) {
          responseText += `👥 **Guests:** ${bookingContext.guests || bookingContext.maxOccupancy} people\n\n`;
        }
        responseText += `Please select the room you want to book (type the number or room name).`;
      }
      
      // Cache response để tái sử dụng
      await setCachedResponse(userMessage, {
        text: responseText,
        rooms: enrichedRooms,
        hasRooms: true
      });
      
      // Nếu chỉ có 1 phòng trong kết quả và chưa có selectedRoom, tự chọn phòng đó để tránh yêu cầu chọn lại
      if (!hasSelectedRoom && roomSearchResults.length === 1) {
        const singleRoom = enrichedRooms[0];
        // Set selectedRoom + bookingContext
        context.selectedRoom = {
          _id: singleRoom.id,
          id: singleRoom.id,
          name: singleRoom.name,
          pricePerNight: singleRoom.pricePerNight,
          roomType: singleRoom.roomType,
          maxOccupancy: singleRoom.maxOccupancy,
          view: singleRoom.view,
          image: singleRoom.image,
          thumbnailUrl: singleRoom.thumbnailUrl || singleRoom.image || null,
          amenities: Array.isArray(singleRoom.amenities) ? singleRoom.amenities : []
        };
        if (!context.bookingContext) context.bookingContext = {};
        context.bookingContext.roomId = singleRoom.id;
        context.bookingContext.roomName = singleRoom.name;
        context.bookingContext.roomPrice = singleRoom.pricePerNight;

        // Lưu session nếu có
        if (context.session) {
          context.session.context = context.session.context || {};
          context.session.context.selectedRoom = context.selectedRoom;
          context.session.context.bookingContext = context.bookingContext;
          context.session.markModified && context.session.markModified('context');
          await context.session.save?.();
        }

        // Tạo message xác nhận thay vì yêu cầu chọn phòng
        const dateLine = hasDates
          ? `📅 Ngày đặt: ${new Date(bookingContext.checkInDate).toLocaleDateString('vi-VN')} - ${new Date(bookingContext.checkOutDate).toLocaleDateString('vi-VN')}\n`
          : '';
        const guestLine = hasGuests ? `👥 Số người: ${bookingContext.guests || bookingContext.maxOccupancy}\n` : '';
        responseText = `Mình đã chọn sẵn phòng **${singleRoom.name}** cho bạn${hasDates || hasGuests ? ':\n' : '.'}` +
          `${dateLine}${guestLine}` +
          `Bạn cần mình giữ phòng và hoàn tất đặt chỗ? Hãy gửi **họ tên, email, số điện thoại** để mình hỗ trợ ngay.`;
      }

      return {
        text: responseText,
        rooms: enrichedRooms,
        hasRooms: true
      };
    }
  }

  // 🚫 Chặn từ sớm: Không gọi Gemini khi tìm phòng mà không có dữ liệu thật
  if (isRoomSearchRequest && (!roomSearchResults || roomSearchResults.length === 0)) {
    const missing = [];
    if (!bookingContext.checkInDate || !bookingContext.checkOutDate) {
      missing.push("ngày nhận phòng", "ngày trả phòng");
    }
    if (!bookingContext.guests && !bookingContext.maxOccupancy) {
      missing.push("số khách");
    }
    const hotline = "0901 234 567"; // Hotline mặc định
    const missingText = missing.length
      ? `Mình cần thêm ${missing.join(", ")} và số khách để kiểm tra phòng trống cho bạn.`
      : "Bạn có thể đổi khoảng ngày khác hoặc liên hệ hotline để được hỗ trợ.";
    return {
      text: `${missing.length ? "" : "Hiện chưa tìm thấy phòng trống cho khoảng thời gian này. "}${missingText} Hotline ${hotline}.`,
      rooms: null,
      hasRooms: false
    };
  }

  // Nếu có Gemini API và đã được khởi tạo thành công, sử dụng nó
  if (geminiAvailable && geminiModel) {
    console.log("[AI Fallback] No rule/cache/pattern/db template matched. Calling Gemini.");
    // ✅ Khai báo retrievedDocs ở ngoài try block để có thể truy cập trong catch block
    let retrievedDocs = [];
    let ragAvailable = false;
    
    try {
      // ✅ RAG: ENABLED với rate limit (50 queries/ngày)
      
      if (ragService) {
        try {
          await ragService.initialize();
          console.log(`🔍 RAG: Searching for: "${userMessage}"`);
          // Giảm topK để tiết kiệm tokens/quota
          retrievedDocs = await ragService.retrieve(userMessage, 2);
          
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
        // ✅ THÊM: Filter documents có score >= 0.6 (đủ phù hợp)
        const relevantDocs = retrievedDocs.filter(doc => doc.score >= 0.6);
        
        if (relevantDocs.length > 0) {
          // ✅ Dùng RAG prompt với retrieved context
          prompt = languageHeader + SYSTEM_PROMPT + "\n\n";
          
          // Build RAG context chỉ với relevant documents
          const langLabel = language === 'vi' ? 'THÔNG TIN THAM KHẢO' : 'REFERENCE INFORMATION';
          const langNote = language === 'vi' 
            ? 'LƯU Ý: Sử dụng thông tin trên để trả lời câu hỏi một cách CHI TIẾT và ĐẦY ĐỦ. Liệt kê tất cả thông tin liên quan từ knowledge base (khoảng cách, thời gian di chuyển, đặc điểm, hoạt động, v.v.). Nếu thông tin không có trong knowledge base, hãy nói rõ và hướng dẫn khách liên hệ hotline.'
            : 'NOTE: Use the information above to answer the question in DETAIL and COMPLETELY. List all relevant information from the knowledge base (distance, travel time, features, activities, etc.). If the information is not in the knowledge base, please clarify and guide the customer to contact the hotline.';

          prompt += `${langLabel} TỪ KNOWLEDGE BASE:\n`;
          prompt += "=".repeat(50) + "\n";

          // ✅ CHỈ đưa relevant documents vào prompt
          relevantDocs.forEach((doc, index) => {
            prompt += `\n[Document ${index + 1}]\n`;
            prompt += `${doc.text}\n`;
            if (doc.metadata?.source) {
              prompt += `${language === 'vi' ? 'Nguồn' : 'Source'}: ${doc.metadata.source}\n`;
            }
            prompt += "\n";
          });

          prompt += "=".repeat(50) + "\n\n";
          prompt += `${langNote}\n\n`;
          
          // ✅ Log số documents đã filter
          console.log(`✅ Filtered RAG documents: ${retrievedDocs.length} → ${relevantDocs.length} (score >= 0.6)`);
        } else {
          // ✅ Không có documents phù hợp → Không dùng RAG
          console.warn('⚠️  RAG documents have low relevance scores (< 0.6), not using RAG');
          ragAvailable = false;
        }
        
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
                `Bạn PHẢI hiển thị lại phòng đã chọn và TÓM TẮT chi tiết đặt phòng theo ĐÚNG FORMAT sau (thay thế các giá trị trong ngoặc vuông bằng dữ liệu thật):\n\n` +
                `Tuyệt vời! Chúng tôi đã ghi nhận yêu cầu đặt phòng của quý khách.\n` +
                `Quý khách đã chọn **[Tên phòng]**.\n\n` +
                `**Chi tiết đặt phòng của bạn:**\n` +
                `| Mục | Chi tiết |\n` +
                `| :--- | :--- |\n` +
                `| **Tên phòng** | [Tên phòng] |\n` +
                `| **View** | [View] |\n` +
                `| **Loại phòng** | [Loại phòng] |\n` +
                `| **Sức chứa** | Tối đa [Số khách] người |\n` +
                `| **Ngày nhận phòng** | [dd/MM/yyyy] |\n` +
                `| **Ngày trả phòng** | [dd/MM/yyyy] ([Số đêm] đêm) |\n` +
                `| **Giá phòng** | [Giá/đêm] |\n` +
                `| **Tổng tiền** | **[Tổng tiền]** |\n\n` +
                `Để hoàn tất việc đặt phòng và điền thông tin cá nhân (Họ tên, Email, SĐT).\n` +
                `Sau khi điền đầy đủ thông tin vào link **Đặt phòng ngay**, hệ thống sẽ gửi xác nhận booking qua email cho quý khách.\n\n` +
                `⚠️ Bạn KHÔNG cần tự tạo URL cho link, hệ thống sẽ thêm dòng "📝 [Xem link đặt phòng](booking:...)" sau khi bạn trả lời.\n` +
                `⚠️ KHÔNG được tìm phòng mới hoặc hiển thị danh sách phòng khác.\n` +
                `Hãy trả lời NGẮN GỌN, đúng đúng format trên, tiếng Việt, không thêm nội dung khác.`
              : `⚠️⚠️⚠️ IMPORTANT: Customer said "confirm this room" or "book this room".\n` +
                `You MUST summarise the selected room and booking details using the EXACT FORMAT below (replace brackets with real values):\n\n` +
                `Great! We have recorded your booking request.\n` +
                `You have selected **[Room name]**.\n\n` +
                `**Your booking details:**\n` +
                `| Item | Details |\n` +
                `| :--- | :--- |\n` +
                `| **Room name** | [Room name] |\n` +
                `| **View** | [View] |\n` +
                `| **Room type** | [Room type] |\n` +
                `| **Capacity** | Up to [Guests] people |\n` +
                `| **Check-in date** | [dd/MM/yyyy] |\n` +
                `| **Check-out date** | [dd/MM/yyyy] ([Nights] nights) |\n` +
                `| **Price per night** | [Price/night] |\n` +
                `| **Total** | **[Total price]** |\n\n` +
                `To complete your booking and fill in personal information (Full name, Email, Phone).\n` +
                `After filling in the **Book now** link, the system will send a booking confirmation via email.\n\n` +
                `⚠️ You DO NOT need to create the URL yourself, the system will add "📝 [View booking link](booking:...)" automatically.\n` +
                `⚠️ DO NOT search for new rooms or show other room lists.\n` +
                `Reply SHORT, following this format only.`;
            
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
                `Rayal Park Hotel được thành lập vào năm 2015 với tầm nhìn trở thành điểm đến nghỉ dưỡng hàng đầu tại Việt Nam.\n\n` +
                `Timeline chi tiết:\n` +
                `- Năm 2015: Khởi Nghiệp - Từ một dự án nhỏ với 20 phòng đầu tiên\n` +
                `- Năm 2018: Mở Rộng Quy Mô - Lên 50 phòng cao cấp, đạt tiêu chuẩn 4 sao và nhận được nhiều giải thưởng về chất lượng dịch vụ\n` +
                `- Năm 2020: Đạt Tiêu Chuẩn 5 Sao - Sau 5 năm phát triển, chính thức đạt tiêu chuẩn 5 sao quốc tế\n` +
                `- Năm 2024: Hiện Tại & Tương Lai - Tiếp tục đổi mới, hướng tới mục tiêu trở thành khách sạn hàng đầu khu vực Đông Nam Á\n\n` +
                `Thành tựu nổi bật:\n` +
                `- Giải thưởng "Khách sạn tốt nhất năm 2023"\n` +
                `- Chứng nhận 5 sao quốc tế\n` +
                `- Top 10 khách sạn hàng đầu Việt Nam\n\n` +
                `Bạn PHẢI trả lời chi tiết về lịch sử hình thành. Luôn gợi ý khách xem phần 'Khám Phá Ngay' trên trang chủ để có thông tin đầy đủ hơn.`
              : `Customer is asking about hotel history.\n` +
                `Rayal Park Hotel was founded in 2015 with the vision of becoming a leading resort destination in Vietnam.\n\n` +
                `Detailed timeline:\n` +
                `- 2015: Startup - Started as a small project with 20 rooms\n` +
                `- 2018: Expansion - Expanded to 50 premium rooms, achieved 4-star standard and received many awards for service quality\n` +
                `- 2020: Achieved 5-Star Standard - After 5 years of development, officially achieved international 5-star standard\n` +
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
                `- Với tầm nhìn xa và đam mê mang đến trải nghiệm nghỉ dưỡng đẳng cấp, ông đã sáng lập Rayal Park Hotel vào năm 2015\n` +
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
                `- With vision and passion for delivering premium resort experiences, he founded Rayal Park Hotel in 2015\n` +
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
                `Rayal Park Hotel là khách sạn 5 sao được thành lập năm 2015, với hơn 10 năm kinh nghiệm phục vụ khách hàng.\n\n` +
                `Bạn có thể tìm hiểu về:\n` +
                `- 📜 Lịch Sử Hình Thành: Hành trình phát triển từ 2015 đến nay\n` +
                `- 👤 Chủ Khách Sạn: Thông tin về người sáng lập và triết lý kinh doanh\n` +
                `- ✨ Tính Năng Mới: 6 tính năng công nghệ mới nhất\n` +
                `- 📍 Địa Điểm Gần: Các điểm tham quan, nhà hàng, mua sắm xung quanh\n\n` +
                `Bạn PHẢI giới thiệu tổng quan và đề xuất 4 chủ đề trên. Hướng dẫn khách click vào [Khám Phá Ngay](explore) trên trang chủ để xem đầy đủ thông tin.`
              : `Customer is asking general questions about the hotel (explore).\n` +
                `Rayal Park Hotel is a 5-star hotel founded in 2015, with over 10 years of experience serving customers.\n\n` +
                `You can learn about:\n` +
                `- 📜 Hotel History: Development journey from 2015 to present\n` +
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
        await setCachedResponse(userMessage, aiResponse);
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

      // ✅ CẢI THIỆN: Nếu RAG đã retrieve được documents, sử dụng chúng để trả lời thay vì fallback chung chung
      if (retrievedDocs && retrievedDocs.length > 0) {
        console.log('✅ Using RAG documents as fallback response (Gemini API failed)');
        const language = context.language || 'vi';
        
        // ✅ Kiểm tra score - chỉ dùng document có score >= 0.6 (đủ phù hợp)
        const relevantDocs = retrievedDocs.filter(doc => doc.score >= 0.6);
        
        if (relevantDocs.length === 0) {
          console.warn('⚠️  RAG documents have low relevance scores (< 0.6), using general fallback');
          // Fall through to general fallback below
        } else {
          // ✅ Extract keywords từ user message để tìm đoạn text liên quan
          const userLower = userMessage.toLowerCase();
          const keywords = [];
          if (userLower.includes('đặc biệt') || userLower.includes('special') || userLower.includes('unique')) keywords.push('đặc biệt', 'tính năng', 'nổi bật');
          if (userLower.includes('tính năng') || userLower.includes('feature')) keywords.push('tính năng', 'công nghệ');
          if (userLower.includes('dịch vụ') || userLower.includes('service')) keywords.push('dịch vụ', 'service');
          if (userLower.includes('có gì') || userLower.includes('what')) keywords.push('tính năng', 'dịch vụ', 'đặc biệt');
          
          let ragResponse = '';
          
          // ✅ Nếu câu hỏi về "đặc biệt" hoặc "có gì", trả về thông tin về 6 tính năng nổi bật
          const isAboutSpecialFeatures = userLower.includes('đặc biệt') || 
                                        userLower.includes('có gì') || 
                                        userLower.includes('what') ||
                                        userLower.includes('special') ||
                                        userLower.includes('unique') ||
                                        userLower.includes('nổi bật');
          
          // ✅ Tìm document về "Tính Năng Mới" hoặc "đặc biệt" nếu có
          const featuresDoc = relevantDocs.find(doc => 
            doc.text.toLowerCase().includes('tính năng mới') || 
            doc.text.toLowerCase().includes('tính năng nổi bật') ||
            doc.text.toLowerCase().includes('6 tính năng') ||
            doc.text.toLowerCase().includes('chatbot ai') ||
            doc.metadata?.source?.includes('chatbot-scenarios')
          );
          
          if (isAboutSpecialFeatures) {
            // ✅ Format response về tính năng đặc biệt
            ragResponse = language === 'vi'
              ? '✨ **Rayal Park Hotel có những điểm đặc biệt sau:**\n\n'
              : '✨ **Rayal Park Hotel has the following special features:**\n\n';
            
            // ✅ Trả về thông tin về 6 tính năng nổi bật (hardcoded từ knowledge-base)
            if (language === 'vi') {
              ragResponse += 'Rayal Park Hotel đã triển khai nhiều tính năng mới để nâng cao trải nghiệm khách hàng. Dưới đây là **6 tính năng nổi bật nhất:**\n\n';
              
              ragResponse += '1. **Chatbot AI Thông Minh** 🤖\n';
              ragResponse += '   Trải nghiệm dịch vụ hỗ trợ 24/7 với chatbot AI thông minh. Đặt phòng, tìm hiểu dịch vụ, hoặc nhận tư vấn ngay lập tức qua chat trực tuyến. Hỗ trợ đa ngôn ngữ (Tiếng Việt & Tiếng Anh). Bạn đang sử dụng tính năng này ngay bây giờ! 😊\n\n';
              
              ragResponse += '2. **Đặt Phòng Tức Thì** ⚡\n';
              ragResponse += '   Đặt phòng ngay từ chat, không cần rời khỏi trang web. Hệ thống tự động kiểm tra phòng trống và xác nhận đặt phòng trong vài giây. Xác nhận tức thời, thanh toán linh hoạt.\n\n';
              
              ragResponse += '3. **Đồng Bộ Lịch Google** 📅\n';
              ragResponse += '   Tự động thêm lịch đặt phòng vào Google Calendar của bạn. Nhận nhắc nhở và quản lý lịch trình một cách tiện lợi. Tính năng này hoạt động tự động khi bạn đặt phòng thành công.\n\n';
              
              ragResponse += '4. **Quản Lý Booking Trực Tuyến** 💼\n';
              ragResponse += '   Xem, chỉnh sửa hoặc hủy đặt phòng của bạn mọi lúc, mọi nơi. Tải hóa đơn, xem chi tiết và quản lý tất cả booking trong một nơi. Chỉnh sửa dễ dàng, hủy phòng linh hoạt.\n\n';
              
              ragResponse += '5. **Thanh Toán Đa Phương Thức** 💳\n';
              ragResponse += '   Hỗ trợ nhiều phương thức thanh toán: thẻ tín dụng, chuyển khoản ngân hàng, hoặc thanh toán tại khách sạn. An toàn và tiện lợi. Bảo mật cao, thanh toán nhanh chóng.\n\n';
              
              ragResponse += '6. **Gợi Ý Địa Điểm Gần** 🗺️\n';
              ragResponse += '   Khám phá các địa điểm tham quan, nhà hàng, mua sắm gần khách sạn. Tìm hiểu khoảng cách và thời gian di chuyển để lên kế hoạch hoàn hảo. Thông tin chi tiết, bản đồ trực quan.\n\n';
            } else {
              ragResponse += 'Rayal Park Hotel has implemented many new features to enhance customer experience. Here are the **6 most outstanding features:**\n\n';
              
              ragResponse += '1. **Smart AI Chatbot** 🤖\n';
              ragResponse += '   Experience 24/7 support service with smart AI chatbot. Book rooms, learn about services, or get instant advice via online chat. Multilingual support (Vietnamese & English). You are using this feature right now! 😊\n\n';
              
              ragResponse += '2. **Instant Booking** ⚡\n';
              ragResponse += '   Book rooms directly from chat, no need to leave the website. System automatically checks room availability and confirms booking in seconds. Instant confirmation, flexible payment.\n\n';
              
              ragResponse += '3. **Google Calendar Sync** 📅\n';
              ragResponse += '   Automatically add booking to your Google Calendar. Receive reminders and manage schedule conveniently. This feature works automatically when you successfully book.\n\n';
              
              ragResponse += '4. **Online Booking Management** 💼\n';
              ragResponse += '   View, edit or cancel your bookings anytime, anywhere. Download invoices, view details and manage all bookings in one place. Easy editing, flexible cancellation.\n\n';
              
              ragResponse += '5. **Multi-Payment Methods** 💳\n';
              ragResponse += '   Support multiple payment methods: credit card, bank transfer, or payment at hotel. Safe and convenient. High security, fast payment.\n\n';
              
              ragResponse += '6. **Nearby Places Suggestions** 🗺️\n';
              ragResponse += '   Explore attractions, restaurants, shopping near the hotel. Learn about distance and travel time to plan perfectly. Detailed information, visual maps.\n\n';
            }
            
            ragResponse += language === 'vi'
              ? '💡 Bạn muốn tìm hiểu chi tiết về tính năng nào? Hoặc xem thêm tại [Khám Phá Ngay](explore) trên trang chủ.\n\n'
              : '💡 Would you like to know more details about any feature? Or view more at [Explore Now](explore) on the homepage.\n\n';
          } else {
            // ✅ Nếu không phải về tính năng, format document thông thường nhưng có chọn lọc
            ragResponse = language === 'vi'
              ? 'Dựa trên thông tin từ hệ thống:\n\n'
              : 'Based on information from our system:\n\n';
            
            // Lấy top document có score cao nhất
            const topDoc = relevantDocs[0];
            const docText = topDoc.text;
            
            // Tìm đoạn text liên quan đến keywords (nếu có)
            if (keywords.length > 0) {
              let relevantText = '';
              keywords.forEach(keyword => {
                const keywordIndex = docText.toLowerCase().indexOf(keyword.toLowerCase());
                if (keywordIndex !== -1) {
                  const start = Math.max(0, keywordIndex - 100);
                  const end = Math.min(docText.length, keywordIndex + 400);
                  const snippet = docText.substring(start, end);
                  if (!relevantText.includes(snippet)) {
                    relevantText += snippet + '\n\n';
                  }
                }
              });
              
              if (relevantText.length > 50) {
                ragResponse += relevantText;
              } else {
                // Fallback: dùng đầu document
                ragResponse += docText.substring(0, 600) + '...\n\n';
              }
            } else {
              // Không có keywords, dùng đầu document
              ragResponse += docText.substring(0, 600) + '...\n\n';
            }
            
            ragResponse += language === 'vi'
              ? 'Bạn có muốn tìm hiểu thêm không? Hoặc xem thêm tại [Khám Phá Ngay](explore) trên trang chủ.\n\n'
              : 'Would you like to know more? Or view more at [Explore Now](explore) on the homepage.\n\n';
          }
          
          // Thêm thông báo về quota nếu là lỗi 429
          const errorMessage = error.message || error.toString() || '';
          if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Too Many Requests')) {
            ragResponse += language === 'vi'
              ? '⚠️ Lưu ý: Hệ thống đang tạm thời giới hạn số lượng yêu cầu. Để được hỗ trợ tốt hơn, vui lòng liên hệ hotline: 0901 234 567\n\n'
              : '⚠️ Note: The system is temporarily limiting the number of requests. For better support, please contact hotline: 0901 234 567\n\n';
          }
          
          return {
            text: ragResponse.trim(),
            rooms: null,
            hasRooms: false
          };
        }
      }

      // 🚫 Không bịa danh sách phòng khi tìm theo ngày/khách mà không có dữ liệu thật
      if (isRoomSearchRequest && (!roomSearchResults || roomSearchResults.length === 0)) {
        return {
          text: `Hiện chưa tìm thấy phòng trống cho khoảng thời gian này. Vui lòng kiểm tra lại ngày hoặc chọn khoảng ngày khác, hoặc liên hệ hotline ${hotline} để được hỗ trợ.`,
          rooms: null,
          hasRooms: false
        };
      }

      // Fallback to mock nếu có lỗi và không có RAG documents
      const mockResponse = getMockAIResponse(userMessage);
      if (roomSearchResults && roomSearchResults.length > 0) {
        // Response ngắn gọn khi có phòng
        const shortResponse = isRoomSearchRequest 
          ? `Mình đã tìm được ${roomSearchResults.length} phòng phù hợp với yêu cầu của bạn! 😊`
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
// 🚫 Không bịa danh sách phòng khi tìm theo ngày/khách mà không có dữ liệu thật
if (isRoomSearchRequest && (!roomSearchResults || roomSearchResults.length === 0)) {
  const moreInfoNeeded = [];
  if (!bookingContext.checkInDate || !bookingContext.checkOutDate) {
    moreInfoNeeded.push("ngày nhận phòng", "ngày trả phòng");
  }
  if (!bookingContext.guests && !bookingContext.maxOccupancy) {
    moreInfoNeeded.push("số khách");
  }

  const hotline = "0901 234 567"; // Hotline mặc định
  const missingText = moreInfoNeeded.length
    ? `Vui lòng cung cấp thêm ${moreInfoNeeded.join(", ")} để tôi kiểm tra lại.`
    : "Vui lòng kiểm tra lại ngày hoặc chọn khoảng ngày khác, hoặc liên hệ hotline.";

  return {
    text: `Hiện chưa tìm thấy phòng trống cho khoảng thời gian này. ${missingText} Hotline ${hotline}.`,
    rooms: null,
    hasRooms: false
  };
}

const mockResponse = getMockAIResponse(userMessage);
  
  // Nếu có room search results, thêm vào response
  if (roomSearchResults && roomSearchResults.length > 0) {
    let responseText = mockResponse + "\n\n";
    responseText += "📋 Mình đã tìm được các phòng phù hợp với yêu cầu của bạn:\n\n";
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
    
    
    // ✅ QUAN TRỌNG: Restore requestedView từ session (để nhớ yêu cầu view biển từ câu hỏi trước)
    if (session?.context?.requestedView) {
      context.requestedView = session.context.requestedView;
      console.log(`✅ Restored requestedView from session: ${context.requestedView}`, {
        sessionId: session.sessionId,
        hasContext: !!session.context,
        contextKeys: session.context ? Object.keys(session.context) : []
      });
    } else {
      console.log(`ℹ️ No requestedView in session to restore`, {
        hasSession: !!session,
        hasContext: !!session?.context,
        sessionContextKeys: session?.context ? Object.keys(session.context) : [],
        currentContextRequestedView: context.requestedView
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
    
    // ✅ QUAN TRỌNG: Parse bookingIntent TRƯỚC khi restore selectedRoom
    // Để biết có phải select_room action không, tránh restore phòng cũ
    const bookingIntent = parseBookingIntent(message.trim(), context);
    
    // ✅ QUAN TRỌNG: Đảm bảo selectedRoom được restore từ session
    // ✅ KHÔNG restore nếu action === 'select_room' (để tránh override phòng mới chọn)
    if (session?.context?.selectedRoom && bookingIntent?.action !== 'select_room') {
      context.selectedRoom = session.context.selectedRoom;
      console.log(`📋 Restored selectedRoom: ${context.selectedRoom.name} (${context.selectedRoom.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm)`);
      
      // ✅ Nếu đã có selectedRoom, restore vào bookingContext luôn
      if (!bookingContext.roomId) {
        bookingContext.roomId = context.selectedRoom._id;
        bookingContext.roomName = context.selectedRoom.name;
        bookingContext.roomPrice = context.selectedRoom.pricePerNight;
        console.log(`✅ Restored selectedRoom to bookingContext: ${context.selectedRoom.name}`);
      }
    } else if (bookingIntent?.action === 'select_room') {
      console.log('ℹ️ Skipping selectedRoom restore - select_room action detected, will update after room selection');
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
    
    // ✅ Parse explore intent (lịch sử, chủ, tính năng, địa điểm)
    // ✅ NOTE: bookingIntent đã được parse ở trên (trước khi restore selectedRoom)
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
    
    // ✅ QUAN TRỌNG: Chỉ restore selectedRoom cũ nếu KHÔNG có select_room action
    // Nếu có select_room action, sẽ được xử lý ở dưới và override lại
    if ((context.selectedRoom || session?.context?.selectedRoom) && bookingIntent.action !== 'select_room') {
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
          let selectedRoom = context.lastRoomSearchResults[selectedRoomIndex];
        
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
          
          // ✅ DEFENSIVE: Kiểm tra _id trước khi sử dụng
          // Nếu selectedRoom từ lastRoomSearchResults thiếu _id, tìm lại từ database
          if (!selectedRoom._id) {
            console.warn('⚠️ selectedRoom._id is undefined, trying to find room from database by name');
            try {
              const Room = (await import('../Models/RoomModel.js')).default;
              const foundRoom = await Room.findOne({ name: selectedRoom.name }).lean();
              if (foundRoom && foundRoom._id) {
                // ✅ Merge dữ liệu từ database vào selectedRoom
                selectedRoom = { ...selectedRoom, ...foundRoom };
                console.log('✅ Found room from database:', {
                  name: selectedRoom.name,
                  roomId: selectedRoom._id
                });
              } else {
                console.error('❌ Cannot find room in database:', selectedRoom.name);
                // Không thể tiếp tục nếu không có _id
                return;
              }
            } catch (findError) {
              console.error('❌ Error finding room from database:', findError);
              return;
            }
          }
          
          // ✅ VALIDATION: Kiểm tra lại availability trước khi chọn phòng
          if (bookingContext.checkInDate && bookingContext.checkOutDate && selectedRoom._id) {
            const isStillAvailable = await checkRoomAvailability(
              selectedRoom._id,
              bookingContext.checkInDate,
              bookingContext.checkOutDate
            );
            
            if (!isStillAvailable) {
              // Phòng đã bị book bởi người khác, thông báo và gợi ý phòng khác
              console.warn(`⚠️ Room ${selectedRoom.name} is no longer available for selected dates`);
              const selectedRoomId = selectedRoom._id.toString ? selectedRoom._id.toString() : String(selectedRoom._id);
              context.roomNoLongerAvailable = {
                roomName: selectedRoom.name,
                roomId: selectedRoomId,
                checkIn: bookingContext.checkInDate,
                checkOut: bookingContext.checkOutDate
              };
              
              // Xóa phòng không còn trống khỏi lastRoomSearchResults
              context.lastRoomSearchResults = context.lastRoomSearchResults.filter(r => {
                if (!r || !r._id) return true;
                const rId = r._id.toString ? r._id.toString() : String(r._id);
                return rId !== selectedRoomId;
              });
              
              // Nếu còn phòng khác, gợi ý lại
              if (context.lastRoomSearchResults.length > 0) {
                context.shouldSuggestAlternativeRooms = true;
              }
              
              // Không set selectedRoom, để AI biết và trả lời user
              return; // Dừng xử lý, để AI trả lời user
            }
          }
          
          // ✅ Đảm bảo _id tồn tại trước khi sử dụng
          const selectedRoomId = selectedRoom._id.toString ? selectedRoom._id.toString() : String(selectedRoom._id);
          
          bookingContext.roomId = selectedRoomId;
          bookingContext.roomName = selectedRoom.name;
          bookingContext.roomPrice = selectedRoom.pricePerNight;
          bookingContext.roomQuantity = bookingIntent.roomQuantity || 1;
          
          // ✅ Lưu thông tin phòng đã chọn vào context để AI biết
          // ✅ SINGLE SOURCE OF TRUTH: context.selectedRoom
          const previousSelectedRoom = context.selectedRoom ? {
            _id: context.selectedRoom._id,
            name: context.selectedRoom.name
          } : null;
          
          context.selectedRoom = {
            _id: selectedRoomId,
            id: selectedRoomId, // ✅ Thêm id để tương thích
            name: selectedRoom.name,
            pricePerNight: selectedRoom.pricePerNight,
            roomType: selectedRoom.roomType,
            maxOccupancy: selectedRoom.maxOccupancy,
            view: selectedRoom.view || 'N/A',
            image: selectedRoom.image || selectedRoom.thumbnailUrl || null,
            thumbnailUrl: selectedRoom.thumbnailUrl || selectedRoom.image || null,
            amenities: Array.isArray(selectedRoom.amenities) ? selectedRoom.amenities : []
          };
          
          // ✅ DEFENSIVE LOGGING: Log việc cập nhật selectedRoom
          console.log('🔄 UPDATING selectedRoom (select_room action):', {
            action: 'select_room',
            roomNumber: bookingIntent.roomNumber,
            previousRoom: previousSelectedRoom,
            newRoom: {
              _id: context.selectedRoom._id,
              name: context.selectedRoom.name,
              roomType: context.selectedRoom.roomType
            },
            source: 'lastRoomSearchResults',
            index: selectedRoomIndex
          });
          
          // ✅ QUAN TRỌNG: Lưu selectedRoom vào session NGAY LẬP TỨC
          if (session) {
            if (!session.context) session.context = {};
            session.context.selectedRoom = context.selectedRoom;
            session.context.bookingContext = bookingContext;
            session.markModified('context');
            await session.save();
            console.log(`✅ Saved selectedRoom to session (select_room): ${context.selectedRoom.name}`, {
              roomId: context.selectedRoom._id,
              bookingContextRoomId: bookingContext.roomId,
              sessionSaved: true
            });
            
            // ✅ QUAN TRỌNG: Verify saved data bằng cách reload session
            const verifySession = await ChatSession.findOne({ sessionId: currentSessionId });
            console.log(`✅ Verified saved selectedRoom in session:`, {
              hasSelectedRoom: !!verifySession?.context?.selectedRoom,
              selectedRoomName: verifySession?.context?.selectedRoom?.name,
              selectedRoomId: verifySession?.context?.selectedRoom?._id,
              matchesContext: verifySession?.context?.selectedRoom?._id === context.selectedRoom._id,
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
      // ✅ QUAN TRỌNG: KHÔNG lưu nếu chỉ có 1 phòng và user đang chọn phòng từ list (để giữ list ban đầu)
      const isSelectingRoom = bookingIntent?.action === 'select_room';
      const hasExistingRoomList = session.context?.lastRoomSearchResults && session.context.lastRoomSearchResults.length > 1;
      const isSingleRoomInContext = context.lastRoomSearchResults && context.lastRoomSearchResults.length === 1;

      if (context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
        // ✅ Chỉ lưu nếu:
        //   - Không phải là chọn phòng từ list
        //   - Hoặc là list phòng mới (nhiều hơn 1 phòng)
        //   - Hoặc chưa có list phòng ban đầu trong session
        if (!isSelectingRoom || !hasExistingRoomList || !isSingleRoomInContext) {
          // Có dữ liệu mới trong context, lưu vào session
          session.context.lastRoomSearchResults = context.lastRoomSearchResults;
          console.log('💾 Saving lastRoomSearchResults to session (before bookingContext save):', {
            count: context.lastRoomSearchResults.length,
            rooms: context.lastRoomSearchResults.map(r => ({ id: r._id, name: r.name }))
          });
        } else {
          // ✅ Giữ nguyên list phòng ban đầu, không cập nhật
          console.log('ℹ️ Skipping lastRoomSearchResults save - user is selecting room from existing list, keeping original list', {
            isSelectingRoom,
            hasExistingRoomList,
            existingListCount: session.context.lastRoomSearchResults.length,
            isSingleRoomInContext,
            contextListCount: context.lastRoomSearchResults.length
          });
          // ✅ Restore list ban đầu vào context để đảm bảo có đủ phòng để chọn
          if (session.context.lastRoomSearchResults && session.context.lastRoomSearchResults.length > 1) {
            context.lastRoomSearchResults = session.context.lastRoomSearchResults;
            console.log('✅ Restored original lastRoomSearchResults from session to context:', {
              count: context.lastRoomSearchResults.length
            });
          }
        }
      } else if (session.context.lastRoomSearchResults && !context.lastRoomSearchResults) {
        // Context không có nhưng session có, restore lại vào context để không mất dữ liệu
        context.lastRoomSearchResults = session.context.lastRoomSearchResults;
        console.log('✅ Restored lastRoomSearchResults from session (during save):', {
          count: context.lastRoomSearchResults.length
        });
      }
      // Nếu cả context và session đều có, giữ lại từ context (dữ liệu mới hơn) - TRỪ KHI đang chọn phòng từ list
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

    // ⚠️ TRƯỚC ĐÂY: Nếu đã có đủ thông tin (phòng, ngày, số khách, giá, thông tin cá nhân)
    // thì tự động set bookingContext.confirmBooking = true để auto tạo booking.
    // → Điều này dẫn tới việc phòng bị giữ chỗ (booking pending) dù khách CHƯA nói "chốt"/"đặt".
    // ❌ ĐÃ TẮT: Giờ CHỈ khi user thực sự xác nhận (intent 'confirm_booking') mới được set confirmBooking.
    
    // ✅ Nếu user xác nhận đặt phòng và có đủ thông tin, tạo booking trực tiếp
    // ❌ ĐÃ VÔ HIỆU HÓA: Không tạo booking trong chat nữa
    // Booking chỉ được tạo khi user submit form trên FE (nhấn "Đặt phòng / Thanh toán")
    // Điều này tránh lỗi "phòng đã được đặt" khi user chưa thực sự hoàn tất thanh toán
    if (bookingContext.confirmBooking && bookingContext.roomId && 
        bookingContext.checkInDate && bookingContext.checkOutDate && 
        bookingContext.totalPrice) {
      console.log('ℹ️ Booking confirmed in chat, nhưng KHÔNG tạo booking trong DB. FE sẽ xử lý khi user submit form.');
      
      // Chỉ tạo booking link để user click vào form FE
      const hasPersonalInfo = bookingContext.fullName && bookingContext.email && bookingContext.phone;
      if (hasPersonalInfo) {
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
        console.log('✅ Created booking link (no DB booking yet):', bookingLink);
      } else {
        bookingContext.needPersonalInfo = true;
        console.log('⚠️ Need personal info to create booking link');
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
    // ✅ QUAN TRỌNG: KHÔNG cập nhật lastRoomSearchResults nếu:
    //   1. User đang chọn phòng từ list đã có (action === 'select_room')
    //   2. Đã có list phòng ban đầu trong session (nhiều hơn 1 phòng)
    //   3. Response chỉ có 1 phòng (có thể là phòng đã chọn, không phải list mới)
    if (rooms && rooms.length > 0 && session) {
      if (!session.context) session.context = {};
      
      // ✅ Kiểm tra xem có phải là chọn phòng từ list không
      const isSelectingRoom = bookingIntent?.action === 'select_room';
      const hasExistingRoomList = session.context?.lastRoomSearchResults && session.context.lastRoomSearchResults.length > 1;
      const isSingleRoomResponse = rooms.length === 1;
      
      // ✅ Kiểm tra xem có phải là amenities response không (response chỉ có 1 phòng và phòng đó là phòng đã chọn)
      // Nếu response chỉ có 1 phòng VÀ có selectedRoom VÀ phòng đó match với selectedRoom → có thể là amenities response
      const selectedRoomId = context.selectedRoom?._id || context.selectedRoom?.id;
      const isAmenitiesResponse = isSingleRoomResponse && 
                                  selectedRoomId && 
                                  hasExistingRoomList &&
                                  !isSelectingRoom &&
                                  rooms[0]?._id?.toString() === selectedRoomId.toString();
      
      // ✅ Chỉ cập nhật lastRoomSearchResults nếu:
      //   - KHÔNG phải amenities response (nếu hỏi amenities, giữ nguyên list ban đầu)
      //   - VÀ (không phải là chọn phòng từ list HOẶC không có list ban đầu HOẶC response có nhiều phòng)
      // ✅ QUAN TRỌNG: Nếu user hỏi amenities, KHÔNG cập nhật lastRoomSearchResults để giữ nguyên list 6 phòng
      if (!isAmenitiesResponse && (!isSelectingRoom || !hasExistingRoomList || !isSingleRoomResponse)) {
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
        
        // ✅ QUAN TRỌNG: Nếu có select_room action và lastRoomSearchResults đã được cập nhật, trigger lại logic select_room
        if (bookingIntent?.action === 'select_room' && bookingIntent.roomNumber && 
            context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
          const selectedRoomIndex = bookingIntent.roomNumber - 1;
          if (selectedRoomIndex >= 0 && selectedRoomIndex < context.lastRoomSearchResults.length) {
            const selectedRoom = context.lastRoomSearchResults[selectedRoomIndex];
            console.log(`🔄 Re-triggering select_room after pattern-based update:`, {
              roomNumber: bookingIntent.roomNumber,
              selectedRoomName: selectedRoom.name,
              selectedRoomId: selectedRoom._id
            });
            
            // Cập nhật context.selectedRoom và bookingContext
            context.selectedRoom = {
              _id: selectedRoom._id.toString(),
              id: selectedRoom._id.toString(),
              name: selectedRoom.name,
              pricePerNight: selectedRoom.pricePerNight,
              roomType: selectedRoom.roomType,
              maxOccupancy: selectedRoom.maxOccupancy,
              view: selectedRoom.view || 'N/A',
              image: selectedRoom.image || selectedRoom.thumbnailUrl || null,
              thumbnailUrl: selectedRoom.thumbnailUrl || selectedRoom.image || null,
              amenities: Array.isArray(selectedRoom.amenities) ? selectedRoom.amenities : []
            };
            
            bookingContext.roomId = selectedRoom._id.toString();
            bookingContext.roomName = selectedRoom.name;
            bookingContext.roomPrice = selectedRoom.pricePerNight;
            
            // Lưu vào session
            if (session) {
              session.context.selectedRoom = context.selectedRoom;
              session.context.bookingContext = bookingContext;
              session.markModified('context');
              await session.save();
              console.log(`✅ Re-saved selectedRoom after pattern-based update: ${context.selectedRoom.name}`);
            }
            
            // Cập nhật roomsData để hiển thị card phòng đã chọn
            roomsData = [{
              id: selectedRoom._id.toString(),
              name: selectedRoom.name,
              roomType: selectedRoom.roomType || 'Standard',
              pricePerNight: selectedRoom.pricePerNight || 0,
              maxOccupancy: selectedRoom.maxOccupancy || 2,
              view: selectedRoom.view || 'N/A',
              image: selectedRoom.image || selectedRoom.thumbnailUrl || '',
              amenities: Array.isArray(selectedRoom.amenities) ? selectedRoom.amenities : []
            }];
            hasRooms = true;
          }
        }
      } else {
        // ✅ Giữ nguyên list phòng ban đầu, không cập nhật
        const skipReason = isAmenitiesResponse ? 'amenities response' : 
                          (isSelectingRoom ? 'selecting room from existing list' : 'other');
        console.log(`ℹ️ Skipping lastRoomSearchResults update - ${skipReason}, keeping original list`, {
          isSelectingRoom,
          isAmenitiesResponse,
          hasExistingRoomList,
          existingListCount: session.context.lastRoomSearchResults.length,
          isSingleRoomResponse,
          newRoomsCount: rooms.length,
          selectedRoomId: selectedRoomId?.toString(),
          responseRoomId: rooms[0]?._id?.toString()
        });
        // ✅ Đảm bảo context.lastRoomSearchResults vẫn có giá trị từ session
        if (!context.lastRoomSearchResults && session.context.lastRoomSearchResults) {
          context.lastRoomSearchResults = session.context.lastRoomSearchResults;
        }
      }
    } else if (rooms && rooms.length > 0 && !session) {
      console.warn('⚠️ Cannot save lastRoomSearchResults: no session available');
    } else if (!rooms || rooms.length === 0) {
      console.log('ℹ️ No rooms from AI response to save as lastRoomSearchResults');
    }
    
    // ✅ Hàm loại bỏ markdown links và các format đặc biệt khỏi text (vì frontend không render markdown và đã có room cards với buttons)
    const removeMarkdownLinks = (text) => {
      if (!text) return text;
      
      // ✅ QUAN TRỌNG: Loại bỏ các format kỹ thuật nội bộ (roomDetailLink / bookingLink object),
      // nhưng VẪN GIỮ LẠI nội dung hiển thị cho người dùng (label link).
      let cleaned = text
        // Loại bỏ các marker nội bộ dạng "[roomDetailLink: {...}]" / "[bookingLink: {...}]"
        .replace(/\[roomDetailLink:\s*\{[^}]+\}\]/g, '')
        .replace(/\[bookingLink:\s*\{[^}]+\}\]/g, '')
        .replace(/\[paymentLink:\s*\{[^}]+\}\]/g, '')
        .replace(/\[.*?Link:\s*\{[^}]+\}\]/g, '')
        // Loại bỏ các đoạn mô tả object thuần kỹ thuật
        .replace(/roomDetailLink\s*:\s*\{[^}]*\}/gi, '')
        .replace(/bookingLink\s*:\s*\{[^}]*\}/gi, '')
        .replace(/paymentLink\s*:\s*\{[^}]*\}/gi, '')
        .replace(/\*\*roomDetailLink\*\*[^\\n]*/gi, '')
        .replace(/\*\*bookingLink\*\*[^\\n]*/gi, '')
        .replace(/\*\*paymentLink\*\*[^\\n]*/gi, '');
      
      // ✅ Loại bỏ các code blocks (ví dụ: ```json ... ```)
      cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
      
      // ✅ Chuyển markdown links KHÔNG QUAN TRỌNG thành text thường, 
      // nhưng GIỮ NGUYÊN các link đặc biệt để FE xử lý:
      //   - [text](explore)
      //   - [text](booking:...)
      //   - [text](payment:...)
      cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
        const trimmedUrl = url.trim();
        // Giữ nguyên các link đặc biệt cho FE (ChatMessageItem) xử lý thành nút bấm
        if (
          trimmedUrl === 'explore' ||
          trimmedUrl.startsWith('booking:') ||
          trimmedUrl.startsWith('payment:')
        ) {
          return match;
        }
        // Các link markdown khác: chỉ hiển thị text
        return linkText;
      })
        // Dọn bớt các câu giới thiệu link quá kỹ thuật
        .replace(/✅\s*Tôi đã chuẩn bị các link sau cho bạn:\s*/g, '')
        .replace(/✅\s*I've prepared the following links for you:\s*/g, '')
        .replace(/✅\s*I've prepared the booking link for you:\s*/g, '')
        .replace(/✅\s*Tôi đã chuẩn bị link đặt phòng cho bạn:\s*/g, '')
        .replace(/\n\n\n+/g, '\n\n')   // Loại bỏ nhiều dòng trống liên tiếp
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
      
      // Loại bỏ các dòng chỉ chứa emoji hoặc whitespace
      cleaned = cleaned
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
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
      const linkText = context.language === 'en' 
       ? `\n\n✅ Booking created successfully! Booking ID: ${bookingContext.bookingId}\n\n👉 Open your booking form here: [View booking link](booking:${bookingFormLink})`
      : `\n\n✅ Đã tạo đơn đặt phòng thành công! Mã đặt phòng: ${bookingContext.bookingId}\n\n👉 Mở lại form đặt phòng (đã điền sẵn) tại đây: [Xem link đặt phòng](booking:${bookingFormLink})`;
      finalResponseText = responseText + linkText;
    } else if (bookingLink || bookingContext.roomDetailLink) {
      // ✅ Ưu tiên chỉ hiển thị 1 link đặt phòng
      let linkText;
      if (bookingLink) {
        // FE parse theo format [text](booking:URL)
        const bookingTextLink = `booking:${bookingLink}`;
        linkText = context.language === 'en'
          ? `\n\n✅ I've prepared your booking link:\n📝 [View booking link](${bookingTextLink})`
          : `\n\n✅ Tôi đã chuẩn bị link đặt phòng cho bạn:\n📝 [Xem link đặt phòng](${bookingTextLink})`;
      } else {
        // Fallback: chỉ có link xem chi tiết phòng
        linkText = context.language === 'en'
          ? `\n\n🔍 You can view room details here:\n🔍 [View Room Details](${bookingContext.roomDetailLink})`
          : `\n\n🔍 Bạn có thể xem chi tiết phòng tại đây:\n🔍 [Xem chi tiết phòng](${bookingContext.roomDetailLink})`;
      }
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
          ? `\n\n✅ I've prepared your booking link:\n📝 [View booking link](${quickBookingLink})\n\nYou can fill in any missing information (dates, personal details) on the booking form.`
          : `\n\n✅ Tôi đã chuẩn bị link đặt phòng cho bạn:\n📝 [Xem link đặt phòng](${quickBookingLink})\n\nBạn có thể điền các thông tin còn thiếu (ngày, thông tin cá nhân) trên form đặt phòng.`;
      finalResponseText = responseText + linkText;
        
        // ✅ Lưu booking link vào biến để trả về response
        if (!bookingLink) {
          bookingLink = quickBookingLink;
        }
        // ✅ Cũng lưu roomDetailLink vào bookingContext để có thể sử dụng lại
        if (!bookingContext.roomDetailLink) {
          bookingContext.roomDetailLink = quickRoomDetailLink;
        }
        console.log('✅ Created links for selected room:', {
          bookingLink: bookingLink,
          roomDetailLink: quickRoomDetailLink,
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
      
      // ✅ QUAN TRỌNG: Lưu requestedView vào session để nhớ yêu cầu view biển
      if (context.requestedView) {
        session.context.requestedView = context.requestedView;
        console.log(`💾 Saving requestedView to session: ${context.requestedView}`);
      } else if (context.requestedView === null && session.context.requestedView) {
        // Nếu context.requestedView là null (đã reset), xóa khỏi session
        delete session.context.requestedView;
        console.log(`💾 Removed requestedView from session (was reset)`);
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
        let matchingRoom = rooms.find(r => {
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
          
          // ✅ DEFENSIVE: Kiểm tra _id trước khi sử dụng
          if (!matchingRoom._id) {
            console.warn('⚠️ matchingRoom._id is undefined, trying to find room from database by name');
            // Thử tìm lại từ database
            try {
              const Room = (await import('../Models/RoomModel.js')).default;
              const foundRoom = await Room.findOne({ name: matchingRoom.name }).lean();
              if (foundRoom && foundRoom._id) {
                // ✅ Merge dữ liệu từ database vào matchingRoom
                matchingRoom = { ...matchingRoom, ...foundRoom };
              } else {
                console.error('❌ Cannot find room in database:', matchingRoom.name);
                // Bỏ qua nếu không tìm thấy
                matchingRoom = null;
              }
            } catch (findError) {
              console.error('❌ Error finding room from database:', findError);
              matchingRoom = null;
            }
          }
          
          // ✅ Chỉ tạo roomsData nếu matchingRoom hợp lệ và có _id
          if (matchingRoom && matchingRoom._id) {
            const roomId = matchingRoom._id.toString ? matchingRoom._id.toString() : String(matchingRoom._id);
            roomsData = [{
              id: roomId,
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
            console.warn('⚠️ Cannot create roomsData: matchingRoom is invalid or missing _id');
          }
        } else {
          // Nếu không tìm thấy phòng khớp, lấy tất cả (fallback)
          console.warn('⚠️ No matching room found for bookingContext.roomName, using all rooms:', {
            bookingRoomName: bookingContext.roomName,
            availableRooms: rooms.map(r => r.name)
          });
        roomsData = rooms
          .map(room => {
            const roomId = room?._id || room?.id || room?.roomId;
            if (!roomId) return null;
            return {
              id: roomId.toString(),
              name: room.name,
              roomType: room.roomType,
              pricePerNight: room.pricePerNight,
              maxOccupancy: room.maxOccupancy,
              view: room.view,
              image: room.image,
              amenities: room.amenities || [],
              detailLink: createRoomDetailLink(roomId)
            };
          })
          .filter(Boolean);
          hasRooms = true;
        }
      } else {
        // Không có bookingContext.roomName, lấy tất cả phòng
      roomsData = rooms
        .map(room => {
          const roomId = room?._id || room?.id || room?.roomId;
          if (!roomId) return null;
          return {
            id: roomId.toString(),
            name: room.name,
            roomType: room.roomType,
            pricePerNight: room.pricePerNight,
            maxOccupancy: room.maxOccupancy,
            view: room.view,
            image: room.image,
            amenities: room.amenities || [],
            detailLink: createRoomDetailLink(roomId)
          };
        })
        .filter(Boolean);
        hasRooms = true;
      }
    }
    
    // ✅ NOTE: Logic thêm phòng đã chọn vào roomsData đã được di chuyển xuống SAU phần fallback tìm room từ database
    // để đảm bảo bookingContext.roomId đã có giá trị trước khi thêm vào roomsData
    
    // ✅ QUAN TRỌNG: Restore selectedRoom vào bookingContext một lần nữa (sau khi AI response và reload session)
    // ✅ QUAN TRỌNG: KHÔNG restore nếu vừa có select_room action (để giữ phòng mới chọn)
    if (!context.selectedRoom && session?.context?.selectedRoom) {
      // ✅ Chỉ restore nếu KHÔNG có select_room action (tránh override phòng mới chọn)
      if (bookingIntent?.action !== 'select_room') {
        context.selectedRoom = session.context.selectedRoom;
        console.log(`✅ Restored selectedRoom from session (after AI response & reload): ${context.selectedRoom.name}`, {
          roomId: context.selectedRoom._id,
          price: context.selectedRoom.pricePerNight,
          reason: 'no_select_room_action'
        });
      } else {
        console.log('ℹ️ Skipping selectedRoom restore - select_room action detected, keeping newly selected room');
      }
    }
    
    // ✅ QUAN TRỌNG: LUÔN gán selectedRoom vào bookingContext nếu có
    // ✅ QUAN TRỌNG: Ưu tiên context.selectedRoom (mới nhất) hơn session.context.selectedRoom
    // ✅ QUAN TRỌNG: KHÔNG override bookingContext.roomId nếu vừa có select_room action (để giữ phòng mới chọn)
    const isSelectingRoom = bookingIntent?.action === 'select_room';
    
    if (context.selectedRoom || session?.context?.selectedRoom) {
      // ✅ SINGLE SOURCE OF TRUTH: Ưu tiên context.selectedRoom (đã được cập nhật bởi select_room)
      const selectedRoomToUse = context.selectedRoom || session.context.selectedRoom;
      
      // ✅ DEFENSIVE LOGGING: Log việc restore selectedRoom
      console.log('🔍 Restoring selectedRoom to bookingContext:', {
        hasContextSelectedRoom: !!context.selectedRoom,
        contextSelectedRoomId: context.selectedRoom?._id,
        contextSelectedRoomName: context.selectedRoom?.name,
        hasSessionSelectedRoom: !!session?.context?.selectedRoom,
        sessionSelectedRoomId: session?.context?.selectedRoom?._id,
        sessionSelectedRoomName: session?.context?.selectedRoom?.name,
        usingContext: !!context.selectedRoom,
        bookingIntentAction: bookingIntent?.action,
        isSelectingRoom: isSelectingRoom,
        currentBookingContextRoomId: bookingContext.roomId,
        willUse: selectedRoomToUse.name,
        willOverride: !isSelectingRoom || !bookingContext.roomId
      });
      
      // ✅ QUAN TRỌNG: Chỉ gán nếu KHÔNG đang chọn phòng mới HOẶC bookingContext chưa có roomId
      // Nếu đang chọn phòng mới và bookingContext đã có roomId, giữ nguyên (phòng mới đã được set bởi select_room logic)
      if (!isSelectingRoom || !bookingContext.roomId) {
        bookingContext.roomId = selectedRoomToUse._id;
        bookingContext.roomName = selectedRoomToUse.name;
        bookingContext.roomPrice = selectedRoomToUse.pricePerNight;
        bookingContext.roomQuantity = bookingContext.roomQuantity || 1;
        
        console.log(`✅ Restored selectedRoom to bookingContext (after AI response & reload): ${selectedRoomToUse.name}`, {
          roomId: bookingContext.roomId,
          selectedRoomId: selectedRoomToUse._id,
          bookingContextRoomId: bookingContext.roomId,
          hasContextSelectedRoom: !!context.selectedRoom,
          source: context.selectedRoom ? 'context' : 'session',
          reason: isSelectingRoom ? 'select_room_action_but_no_roomId' : 'normal_restore'
        });
      } else {
        console.log('ℹ️ Skipping bookingContext.roomId override - select_room action detected and roomId already set:', {
          currentRoomId: bookingContext.roomId,
          currentRoomName: bookingContext.roomName,
          wouldUseRoomId: selectedRoomToUse._id,
          wouldUseRoomName: selectedRoomToUse.name
        });
      }
      
      // ✅ Đảm bảo context.selectedRoom cũng được set (nếu chưa có)
      if (!context.selectedRoom) {
        context.selectedRoom = selectedRoomToUse;
      }
    }
    
    // ✅ QUAN TRỌNG: Restore bookingContext từ session (merge để không mất dữ liệu)
    // ✅ QUAN TRỌNG: KHÔNG restore roomId/roomName từ session nếu đang có select_room action (để giữ phòng mới chọn)
    if (session?.context?.bookingContext) {
      // Merge bookingContext từ session vào bookingContext hiện tại
      const isSelectingRoom = bookingIntent?.action === 'select_room';
      
      bookingContext = {
        ...session.context.bookingContext,
        ...bookingContext, // Ưu tiên dữ liệu mới hơn
        // ✅ QUAN TRỌNG: Chỉ restore roomId/roomName từ session nếu KHÔNG đang chọn phòng mới
        // Nếu đang chọn phòng mới, giữ nguyên roomId/roomName từ bookingContext (đã được cập nhật bởi select_room)
        roomId: isSelectingRoom 
          ? (bookingContext.roomId || session.context.bookingContext.roomId)
          : (bookingContext.roomId || session.context.bookingContext.roomId),
        roomName: isSelectingRoom
          ? (bookingContext.roomName || session.context.bookingContext.roomName)
          : (bookingContext.roomName || session.context.bookingContext.roomName),
        roomPrice: isSelectingRoom
          ? (bookingContext.roomPrice || session.context.bookingContext.roomPrice)
          : (bookingContext.roomPrice || session.context.bookingContext.roomPrice)
      };
      
      console.log(`✅ Restored bookingContext from session (after AI response & reload):`, {
        roomId: bookingContext.roomId,
        roomName: bookingContext.roomName,
        email: bookingContext.email,
        phone: bookingContext.phone,
        isSelectingRoom: isSelectingRoom,
        bookingIntentAction: bookingIntent?.action
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
      
      // ✅ QUAN TRỌNG: Chỉ thêm phòng đã chọn vào roomsData khi user đang hỏi về đặt phòng
      // KHÔNG hiển thị card khi user hỏi về lịch sử, dịch vụ, địa điểm, chính sách...
      const isBookingRelatedQuery = bookingIntent?.action && 
        ['search_room', 'select_room', 'confirm_room_selection', 'book_room', 'check_availability'].includes(bookingIntent.action);
      const isExploringOtherTopics = context.exploreContext?.topic && 
        ['history', 'services', 'nearby', 'policy', 'owner', 'about'].includes(context.exploreContext.topic);
      
      // Chỉ hiển thị card phòng khi: có phòng đã chọn VÀ (đang hỏi về booking HOẶC không đang explore topic khác)
      const shouldShowRoomCard = hasSelectedRoom && bookingContext && bookingContext.roomId && 
        (isBookingRelatedQuery || (!isExploringOtherTopics && !context.exploreContext?.topic));
      
      if (shouldShowRoomCard) {
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
    
    // ✅ CHỈ tạo bookingLink khi:
    // - User đã chốt đặt (confirm_booking), HOẶC
    // - User chốt phòng (confirm_room_selection) và đã có ngày nhận/trả phòng, HOẶC
    // - Đã có đầy đủ thông tin cá nhân (auto-booking)
    const hasDatesForBooking = bookingContext.checkInDate && bookingContext.checkOutDate;
    const hasFullPersonalInfo = bookingContext.fullName && bookingContext.email && bookingContext.phone;
    
    const shouldCreateBookingLink = 
      bookingIntent?.action === 'confirm_booking' ||
      (bookingIntent?.action === 'confirm_room_selection' && hasDatesForBooking) ||
      (hasDatesForBooking && hasFullPersonalInfo);
    
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

    // ✅ Nếu đã có finalBookingLink, tinh chỉnh nội dung text trước khi thêm link
    // (ÁP DỤNG CHO CÁC TRƯỜNG HỢP KHÁC confirm_room_selection)
    if (finalBookingLink && typeof finalResponseText === 'string' && bookingIntent?.action !== 'confirm_room_selection') {
      const bookingTextLink = `booking:${finalBookingLink}`;
      
      // 1) Xóa dòng "Xem chi tiết phòng" (hoặc "1. Xem chi tiết phòng") vì FE đã có card + button riêng
      finalResponseText = finalResponseText.replace(/^\s*(\d+\.\s*)?Xem chi tiết phòng\s*$/gmu, '');
      
      // 2) Biến "Đặt phòng ngay" thành link clickable dùng cùng URL với "Xem link đặt phòng"
      finalResponseText = finalResponseText.replace(/Đặt phòng ngay/g, `[Đặt phòng ngay](${bookingTextLink})`);
      
      // 3) Nếu trong finalResponseText CHƯA có link đặt phòng rõ ràng, tự động thêm đoạn ngắn phía dưới
      if (
        !finalResponseText.includes('[Xem link đặt phòng]') &&
        !finalResponseText.includes('[View booking link]')
      ) {
        const extraBookingText = context.language === 'en'
          ? `\n\n✅ You can open your booking form here:\n📝 [View booking link](${bookingTextLink})`
          : `\n\n✅ Bạn có thể mở form đặt phòng tại đây:\n📝 [Xem link đặt phòng](${bookingTextLink})`;
        finalResponseText += extraBookingText;
        console.log('✅ Appended finalBookingLink to response text (fallback).');
      }
    }
    
    // ✅ TEMPLATE RIÊNG khi khách nói "chốt phòng này" (confirm_room_selection)
    // Hiển thị tóm tắt chi tiết đặt phòng + 1 link đặt phòng để khách tự điền thông tin cá nhân
    if (
      bookingIntent?.action === 'confirm_room_selection' &&
      finalBookingLink &&
      bookingContext.roomId &&
      bookingContext.checkInDate &&
      bookingContext.checkOutDate &&
      bookingContext.totalPrice &&
      (context.selectedRoom || bookingContext.roomName)
    ) {
      const bookingTextLink = `booking:${finalBookingLink}`;
      const selectedRoom = context.selectedRoom || {};
      const roomName = bookingContext.roomName || selectedRoom.name || 'Phòng đã chọn';
      const view = selectedRoom.view || 'N/A';
      const roomType = selectedRoom.roomType || 'N/A';
      const capacity = selectedRoom.maxOccupancy || bookingContext.guests || bookingContext.maxOccupancy || 'N/A';
      const pricePerNight = bookingContext.roomPrice || selectedRoom.pricePerNight || 0;
      const totalPrice = bookingContext.totalPrice || 0;
      const nights = bookingContext.nights || (() => {
        const checkIn = new Date(bookingContext.checkInDate);
        const checkOut = new Date(bookingContext.checkOutDate);
        return Math.max(1, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
      })();
      
      const checkInDate = new Date(bookingContext.checkInDate);
      const checkOutDate = new Date(bookingContext.checkOutDate);
      const checkInStr = checkInDate.toLocaleDateString('vi-VN');
      const checkOutStr = checkOutDate.toLocaleDateString('vi-VN');
      
      const pricePerNightText = pricePerNight
        ? `${pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm`
        : 'Đang cập nhật';
      const totalPriceText = totalPrice
        ? `${totalPrice.toLocaleString('vi-VN')} VNĐ`
        : 'Đang cập nhật';
      
      finalResponseText =
        `Tuyệt vời! Chúng tôi đã ghi nhận yêu cầu đặt phòng của quý khách.\n` +
        `Quý khách đã chọn **${roomName}**.\n\n` +
        `**Chi tiết đặt phòng của bạn:**\n` +
        `| Mục | Chi tiết |\n` +
        `| :--- | :--- |\n` +
        `| **Tên phòng** | ${roomName} |\n` +
        `| **View** | ${view} |\n` +
        `| **Loại phòng** | ${roomType} |\n` +
        `| **Sức chứa** | Tối đa ${capacity} người |\n` +
        `| **Ngày nhận phòng** | ${checkInStr} |\n` +
        `| **Ngày trả phòng** | ${checkOutStr} (${nights} đêm) |\n` +
        `| **Giá phòng** | ${pricePerNightText} |\n` +
        `| **Tổng tiền** | **${totalPriceText}** |\n\n` +
        `Để hoàn tất việc đặt phòng và điền thông tin cá nhân (Họ tên, Email, SĐT).\n` +
        `Sau khi điền đầy đủ thông tin vào link **Đặt phòng ngay**, hệ thống sẽ gửi xác nhận booking qua email cho quý khách.\n\n` +
        `📝 [Xem link đặt phòng](${bookingTextLink})`;
      
      console.log('✅ Applied custom confirm_room_selection template with booking link.');
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
    
    // ✅ Nếu roomsData trống nhưng trong session/context có lastRoomSearchResults, dùng làm fallback để hiển thị card
    if ((!roomsData || roomsData.length === 0) && context.lastRoomSearchResults && context.lastRoomSearchResults.length > 0) {
      roomsData = context.lastRoomSearchResults.map((r, idx) => ({
        id: r._id?.toString?.() || r.id || r._id || `room-${idx + 1}`,
        name: r.name,
        roomType: r.roomType,
        pricePerNight: r.pricePerNight ?? 0,
        maxOccupancy: r.maxOccupancy,
        view: r.view,
        image: r.image || r.thumbnailUrl || null,
        thumbnailUrl: r.thumbnailUrl || r.image || null,
        amenities: Array.isArray(r.amenities) ? r.amenities : []
      }));
      hasRooms = true;
      console.log('✅ Fallback to lastRoomSearchResults for roomsData:', {
        count: roomsData.length,
        names: roomsData.map(r => r.name)
      });

      // ✅ Nếu có ngày check-in/out, lọc lại phòng theo availability để tránh hiển thị phòng hết chỗ
      const bookingCtx = context.bookingContext || {};
      if (bookingCtx.checkInDate && bookingCtx.checkOutDate) {
        try {
          const availabilityCriteria = {
            checkInDate: new Date(bookingCtx.checkInDate),
            checkOutDate: new Date(bookingCtx.checkOutDate),
            maxOccupancy: bookingCtx.guests || bookingCtx.maxOccupancy || null,
            isAvailable: true,
            status: 'active'
          };
          const availableRooms = await searchRooms(availabilityCriteria);
          const availableIds = new Set(
            availableRooms.map(r => r._id?.toString?.() || r.id || r._id)
          );
          const before = roomsData.length;
          roomsData = roomsData.filter(r => availableIds.has(r.id?.toString ? r.id.toString() : String(r.id)));
          hasRooms = roomsData.length > 0;
          console.log('✅ Filtered fallback rooms by availability:', {
            before,
            after: roomsData.length,
            kept: roomsData.map(r => r.name)
          });
        } catch (availErr) {
          console.error('❌ Error filtering fallback rooms by availability:', availErr);
        }
      }
    }

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
    
    // ✅ Nếu user vừa chọn phòng, ưu tiên thông điệp xác nhận chọn phòng (không lặp lại tìm phòng)
    if (bookingIntent?.action === 'select_room' && context.selectedRoom) {
      const hasDates =
        context.bookingContext &&
        context.bookingContext.checkInDate &&
        context.bookingContext.checkOutDate;
      const hasAllPersonalInfo =
        context.bookingContext &&
        context.bookingContext.fullName &&
        context.bookingContext.email &&
        context.bookingContext.phone;

      if (context.language === 'en') {
        if (hasDates && hasAllPersonalInfo) {
          finalResponseText = `You selected **${context.selectedRoom.name}**.\nI've kept your personal information from the previous step and updated it for this room.`;
          if (finalBookingLink) {
            const bookingTextLink = `booking:${finalBookingLink}`;
            finalResponseText += `\n\n✅ You can open your booking form here:\n📝 [View booking link](${bookingTextLink})`;
          }
        } else {
          finalResponseText = `You selected **${context.selectedRoom.name}**. \nJust click the \"Book now\" button on the room card. \nTo help you complete the booking faster, please share your **full name, email, and phone number** and our staff will assist you.`;
        }
      } else {
        if (hasDates && hasAllPersonalInfo) {
          finalResponseText = `Bạn đã chọn **${context.selectedRoom.name}**, phòng đã sẵn sàng 😊\nMình đã giữ lại thông tin cá nhân bạn cung cấp trước đó và áp dụng cho phòng này.`;
          if (finalBookingLink) {
            const bookingTextLink = `booking:${finalBookingLink}`;
            finalResponseText += `\n\n✅ Bạn có thể mở form đặt phòng tại đây:\n📝 [Xem link đặt phòng](${bookingTextLink})`;
          }
        } else {
          finalResponseText = hasDates
            ? `Bạn đã chọn **${context.selectedRoom.name}**, phòng đã sẵn sàng 😊
Bạn chỉ cần nhấn nút \"Đặt phòng ngay\" trên thẻ phòng.
Nếu muốn mình hỗ trợ giữ phòng và hoàn tất đặt chỗ nhanh hơn, hãy gửi giúp mình **Họ và tên, email, số điện thoại** nhé.`
            : `Bạn đã chọn **${context.selectedRoom.name}** 😊
Để mình kiểm tra và giữ phòng cho bạn, vui lòng cho mình **ngày nhận – ngày trả** và **số khách**, sau đó gửi thêm **Họ và tên, email, số điện thoại** để mình tạo link đặt phòng và hỗ trợ bạn hoàn tất nhé.`;
        }
      }

      if (finalRoomsData && finalRoomsData.length > 0) {
        // Giữ lại card đã có (đã được filter về phòng đang xem ở trên)
        hasRooms = true;
      } else {
        // Fallback: hiển thị card phòng đang chọn 
        finalRoomsData = [context.selectedRoom];
        hasRooms = true;
      }
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