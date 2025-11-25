import asyncHandler from "express-async-handler";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";
import Room from "../Models/RoomModel.js";
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

// Function để parse yêu cầu tìm phòng từ câu hỏi
const parseRoomSearchRequest = (userMessage) => {
  const lowerMessage = userMessage.toLowerCase();
  const criteria = {
    maxOccupancy: null,
    view: null,
    roomType: null,
    priceRange: null
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

  return criteria;
};

// Function để tìm phòng theo tiêu chí
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

    const rooms = await Room.find(filter)
      .populate("location", "address province city")
      .limit(5) // Giới hạn 5 phòng
      .lean();

    return rooms;
  } catch (error) {
    console.error("Error searching rooms:", error);
    return [];
  }
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
  
  // Kiểm tra xem có phải yêu cầu tìm phòng không
  const isRoomSearchRequest = 
    lowerMessage.includes("đặt phòng") ||
    lowerMessage.includes("tìm phòng") ||
    lowerMessage.includes("phòng trống") ||
    lowerMessage.includes("phòng nào") ||
    lowerMessage.includes("có phòng") ||
    (lowerMessage.includes("cho") && (lowerMessage.includes("người") || lowerMessage.match(/\d+\s*người/))) ||
    lowerMessage.includes("view") || lowerMessage.includes("biển") || lowerMessage.includes("núi");

  let roomSearchResults = null;
  let searchCriteria = null;

  // Nếu là yêu cầu tìm phòng, tìm phòng trước
  if (isRoomSearchRequest) {
    searchCriteria = parseRoomSearchRequest(userMessage);
    roomSearchResults = await searchRooms(searchCriteria);
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
        
        // Thêm thông tin phòng tìm được nếu có (sau RAG context)
        if (roomSearchResults && roomSearchResults.length > 0) {
          const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG TÌM ĐƯỢC' : 'ROOM INFORMATION FOUND';
          const roomGuideVi = "⚠️ QUAN TRỌNG: Khách đã hỏi về tìm phòng. Bạn PHẢI:\n" +
            "1. Bạn cần giới thiệu các thông tin phòng này cho khách như tiện ích phòng, diện tích phòng, số lượng người ở và hướng dẫn họ đặt phòng. Nếu khách muốn đặt phòng, hãy cho biết ID phòng để họ có thể click vào link đặt phòng."
            "2. Trả lời NGẮN GỌN (1-2 câu) rằng đã tìm thấy phòng\n" +
            // "3. KHÔNG giải thích dài dòng về giá phòng, dịch vụ (đã có trong danh sách phòng)\n" +
            // "4. KHÔNG lặp lại thông tin đã có trong danh sách phòng\n" +
            "5. Chỉ nói: 'Tôi đã tìm thấy X phòng phù hợp' và để khách xem danh sách phòng bên dưới";
          const roomGuideEn = "⚠️ IMPORTANT: Customer asked about finding rooms. You MUST:\n" +
            "1. You need to introduce the room information to the customer like room amenities, room area, number of people and guide them to book. If the customer wants to book, please provide the room ID so they can click on the booking link.\n" +
            "2. Respond BRIEFLY (1-2 sentences) that rooms were found\n" +
            // "3. DO NOT explain in detail about prices, services (already in room list)\n" +
            // "4. DO NOT repeat information already in the room list\n" +
            "5. Just say: 'I found X suitable rooms' and let customer see the room list below";
          const roomGuide = language === 'vi' ? roomGuideVi : roomGuideEn;
          
          prompt += `\n\n${roomInfoLabel}:\n`;
          roomSearchResults.forEach((room, index) => {
            prompt += `${index + 1}. ${room.name} - ${room.roomType}\n`;
            prompt += `   ${language === 'vi' ? 'Giá' : 'Price'}: ${room.pricePerNight.toLocaleString('vi-VN')} VND/night\n`;
            prompt += `   ${language === 'vi' ? 'Số người' : 'Max occupancy'}: ${room.maxOccupancy}\n`;
            prompt += `   View: ${room.view || 'N/A'}\n`;
            prompt += `   ID: ${room._id}\n\n`;
          });
          prompt += `${roomGuide}\n\n`;
        } else if (isRoomSearchRequest && roomSearchResults && roomSearchResults.length === 0) {
          const noRoomNoteVi = "LƯU Ý: Không tìm thấy phòng nào phù hợp với yêu cầu. Hãy thông báo cho khách và đề xuất các phòng khác hoặc liên hệ trực tiếp.";
          const noRoomNoteEn = "NOTE: No rooms found matching the request. Please inform the customer and suggest other rooms or contact directly.";
          prompt += `\n\n${language === 'vi' ? noRoomNoteVi : noRoomNoteEn}\n\n`;
        }
      } else {
        // Fallback: dùng logic cũ nếu không có RAG
        prompt = languageHeader + SYSTEM_PROMPT + "\n\n";
        
        // Thêm thông tin phòng tìm được nếu có
        if (roomSearchResults && roomSearchResults.length > 0) {
          const roomInfoLabel = language === 'vi' ? 'THÔNG TIN PHÒNG TÌM ĐƯỢC' : 'ROOM INFORMATION FOUND';
          const roomGuideVi = "⚠️ QUAN TRỌNG: Khách đã hỏi về tìm phòng. Bạn PHẢI:\n" +
            "1. Trả lời NGẮN GỌN (1-2 câu) rằng đã tìm thấy phòng\n" +
            "2. KHÔNG giải thích dài dòng về giá phòng, dịch vụ (đã có trong danh sách phòng)\n" +
            "3. KHÔNG lặp lại thông tin đã có trong danh sách phòng\n" +
            "4. Chỉ nói: 'Tôi đã tìm thấy X phòng phù hợp' và để khách xem danh sách phòng bên dưới";
          const roomGuideEn = "⚠️ IMPORTANT: Customer asked about finding rooms. You MUST:\n" +
            "1. Respond BRIEFLY (1-2 sentences) that rooms were found\n" +
            "2. DO NOT explain in detail about prices, services (already in room list)\n" +
            "3. DO NOT repeat information already in the room list\n" +
            "4. Just say: 'I found X suitable rooms' and let customer see the room list below";
          const roomGuide = language === 'vi' ? roomGuideVi : roomGuideEn;
          
          prompt += `${roomInfoLabel}:\n`;
          roomSearchResults.forEach((room, index) => {
            prompt += `${index + 1}. ${room.name} - ${room.roomType}\n`;
            prompt += `   ${language === 'vi' ? 'Giá' : 'Price'}: ${room.pricePerNight.toLocaleString('vi-VN')} VND/night\n`;
            prompt += `   ${language === 'vi' ? 'Số người' : 'Max occupancy'}: ${room.maxOccupancy}\n`;
            prompt += `   View: ${room.view || 'N/A'}\n`;
            prompt += `   ID: ${room._id}\n\n`;
          });
          prompt += `${roomGuide}\n\n`;
        } else if (isRoomSearchRequest && roomSearchResults && roomSearchResults.length === 0) {
          const noRoomNoteVi = "LƯU Ý: Không tìm thấy phòng nào phù hợp với yêu cầu. Hãy thông báo cho khách và đề xuất các phòng khác hoặc liên hệ trực tiếp.";
          const noRoomNoteEn = "NOTE: No rooms found matching the request. Please inform the customer and suggest other rooms or contact directly.";
          prompt += `${language === 'vi' ? noRoomNoteVi : noRoomNoteEn}\n\n`;
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
    
    // Lưu tin nhắn của bot (chỉ lưu text)
    const botMessage = await ChatMessage.create({
      sessionId: currentSessionId,
      userId: userId,
      message: responseText,
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
        message: responseText,
        sessionId: currentSessionId,
        rooms: roomsData,
        hasRooms: hasRooms
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