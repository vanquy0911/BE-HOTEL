import asyncHandler from "express-async-handler";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";
import Room from "../Models/RoomModel.js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

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
          model: "gemini-pro",
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

NHIỆM VỤ CỦA BẠN:
- Tư vấn khách hàng về dịch vụ khách sạn một cách thân thiện, chuyên nghiệp
- Trả lời các câu hỏi về giá phòng, đặt phòng, dịch vụ
- Hướng dẫn khách hàng sử dụng website
- Luôn lịch sự, nhiệt tình và hữu ích

THÔNG TIN KHÁCH SẠN:
- Tên: Rayal Park Hotel
- Địa chỉ: 123 Đường ABC, Quận 1, TP.HCM, Việt Nam
- Hotline: 0901 234 567
- Email: info@rayalpark.com
- Facebook: facebook.com/rayalparkhotel

GIÁ PHÒNG:
- Phòng Đơn: 1.500.000 - 2.000.000 VNĐ/đêm
- Phòng Đôi: 2.500.000 - 3.500.000 VNĐ/đêm
- Phòng VIP: 4.000.000 - 5.000.000 VNĐ/đêm
- Suite: 6.000.000+ VNĐ/đêm

DỊCH VỤ:
- WiFi miễn phí tốc độ cao
- Dịch vụ phòng 24/7
- Nhà hàng đẳng cấp
- Spa & Wellness
- Hội nghị & Sự kiện
- Đưa đón sân bay
- Bể bơi ngoài trời
- Gym & Fitness

CHÍNH SÁCH HỦY PHÒNG:
- Hủy trước 48 giờ: Miễn phí
- Hủy trong vòng 24-48 giờ: Phí 30% giá phòng
- Hủy trong vòng 24 giờ: Phí 50% giá phòng
- Không hủy (No-show): Phí 100% giá phòng

QUY TẮC:
- Trả lời bằng tiếng Việt (hoặc ngôn ngữ khách hỏi)
- Giữ thái độ thân thiện, chuyên nghiệp
- Nếu không biết câu trả lời, hướng dẫn khách liên hệ hotline
- Luôn kết thúc bằng cách hỏi xem còn cần hỗ trợ gì không
- Sử dụng emoji một cách hợp lý để tạo cảm giác thân thiện

Hãy trả lời câu hỏi của khách hàng một cách tự nhiên và hữu ích.`;

// Mock AI response function (fallback khi không có Gemini API)
const getMockAIResponse = (userMessage) => {
  
  const lowerMessage = userMessage.toLowerCase();
  
  // Knowledge base về khách sạn
  if (lowerMessage.includes("giá") || lowerMessage.includes("price") || lowerMessage.includes("cost")) {
    return "Chào bạn! Giá phòng tại Rayal Park Hotel dao động từ 1.500.000 VNĐ đến 5.000.000 VNĐ mỗi đêm tùy theo loại phòng:\n\n" +
           "• Phòng Đơn: 1.500.000 - 2.000.000 VNĐ/đêm\n" +
           "• Phòng Đôi: 2.500.000 - 3.500.000 VNĐ/đêm\n" +
           "• Phòng VIP: 4.000.000 - 5.000.000 VNĐ/đêm\n\n" +
           "Giá có thể thay đổi theo mùa và các chương trình khuyến mãi. Bạn có muốn tôi kiểm tra phòng trống cho ngày bạn muốn đặt không?";
  }
  
  if (lowerMessage.includes("phòng trống") || lowerMessage.includes("available") || lowerMessage.includes("trống")) {
    return "Tôi sẽ kiểm tra phòng trống cho bạn. Bạn vui lòng cho tôi biết:\n\n" +
           "• Ngày nhận phòng (check-in)\n" +
           "• Ngày trả phòng (check-out)\n" +
           "• Số lượng khách\n\n" +
           "Hoặc bạn có thể truy cập trang 'Xem Phòng' để xem tất cả các phòng có sẵn và đặt trực tuyến.";
  }
  
  if (lowerMessage.includes("hủy") || lowerMessage.includes("cancel") || lowerMessage.includes("chính sách")) {
    return "Chính sách hủy phòng tại Rayal Park Hotel:\n\n" +
           "• Hủy trước 48 giờ: Miễn phí\n" +
           "• Hủy trong vòng 24-48 giờ: Phí 30% giá phòng\n" +
           "• Hủy trong vòng 24 giờ: Phí 50% giá phòng\n" +
           "• Không hủy (No-show): Phí 100% giá phòng\n\n" +
           "Bạn có thể hủy đặt phòng trực tiếp trên website trong phần 'Đặt Phòng Của Tôi' hoặc liên hệ trực tiếp qua số điện thoại: 0901 234 567";
  }
  
  if (lowerMessage.includes("dịch vụ") || lowerMessage.includes("service") || lowerMessage.includes("tiện ích")) {
    return "Rayal Park Hotel cung cấp các dịch vụ sau:\n\n" +
           "✅ WiFi miễn phí tốc độ cao\n" +
           "✅ Dịch vụ phòng 24/7\n" +
           "✅ Nhà hàng đẳng cấp\n" +
           "✅ Spa & Wellness\n" +
           "✅ Hội nghị & Sự kiện\n" +
           "✅ Đưa đón sân bay\n" +
           "✅ Bể bơi ngoài trời\n" +
           "✅ Gym & Fitness\n\n" +
           "Bạn muốn biết thêm chi tiết về dịch vụ nào?";
  }
  
  if (lowerMessage.includes("đặt phòng") || lowerMessage.includes("booking") || lowerMessage.includes("reserve")) {
    return "Để đặt phòng, bạn có thể:\n\n" +
           "1️⃣ Truy cập trang 'Đặt Phòng' trên website\n" +
           "2️⃣ Chọn ngày nhận phòng và trả phòng\n" +
           "3️⃣ Chọn loại phòng phù hợp\n" +
           "4️⃣ Điền thông tin và thanh toán\n\n" +
           "Hoặc bạn có thể gọi trực tiếp đến số: 0901 234 567 để được hỗ trợ đặt phòng nhanh chóng.";
  }
  
  if (lowerMessage.includes("chào") || lowerMessage.includes("hello") || lowerMessage.includes("xin chào") || lowerMessage.includes("hi")) {
    return "Xin chào! Tôi là trợ lý ảo của Rayal Park Hotel. Tôi có thể giúp bạn:\n\n" +
           "• Tư vấn về giá phòng và loại phòng\n" +
           "• Kiểm tra phòng trống\n" +
           "• Hướng dẫn đặt phòng\n" +
           "• Thông tin về dịch vụ khách sạn\n" +
           "• Chính sách hủy phòng\n\n" +
           "Bạn cần hỗ trợ gì? 😊";
  }
  
  // Default response
  return "Cảm ơn bạn đã liên hệ! Tôi có thể giúp bạn về:\n\n" +
         "• Thông tin giá phòng và đặt phòng\n" +
         "• Dịch vụ khách sạn\n" +
         "• Chính sách hủy phòng\n" +
         "• Câu hỏi thường gặp\n\n" +
         "Nếu câu hỏi của bạn phức tạp hơn, vui lòng liên hệ trực tiếp:\n" +
         "📞 Hotline: 0901 234 567\n" +
         "✉️ Email: info@rayalpark.com\n" +
         "💬 Facebook: facebook.com/rayalparkhotel";
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

// AI Response function với Gemini API và Room Search
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
    lowerMessage.includes("cho") && (lowerMessage.includes("người") || lowerMessage.match(/\d+\s*người/)) ||
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
      // Build conversation history cho context
      let prompt = SYSTEM_PROMPT + "\n\n";
      
      // Thêm thông tin phòng tìm được nếu có
      if (roomSearchResults && roomSearchResults.length > 0) {
        prompt += "THÔNG TIN PHÒNG TÌM ĐƯỢC:\n";
        roomSearchResults.forEach((room, index) => {
          prompt += `${index + 1}. ${room.name} - ${room.roomType}\n`;
          prompt += `   Giá: ${room.pricePerNight.toLocaleString('vi-VN')} VNĐ/đêm\n`;
          prompt += `   Số người: ${room.maxOccupancy}\n`;
          prompt += `   View: ${room.view || 'N/A'}\n`;
          prompt += `   ID: ${room._id}\n\n`;
        });
        prompt += "Bạn cần giới thiệu các phòng này cho khách và hướng dẫn họ đặt phòng. ";
        prompt += "Nếu khách muốn đặt phòng, hãy cho biết ID phòng để họ có thể click vào link đặt phòng.\n\n";
      } else if (isRoomSearchRequest && roomSearchResults && roomSearchResults.length === 0) {
        prompt += "LƯU Ý: Không tìm thấy phòng nào phù hợp với yêu cầu. Hãy thông báo cho khách và đề xuất các phòng khác hoặc liên hệ trực tiếp.\n\n";
      }
      
      // Thêm lịch sử hội thoại nếu có
      if (conversationHistory.length > 0) {
        prompt += "Lịch sử hội thoại:\n";
        conversationHistory.slice(-6).forEach(msg => {
          prompt += `${msg.sender === 'user' ? 'Khách hàng' : 'Bạn'}: ${msg.message}\n`;
        });
        prompt += "\n";
      }
      
      prompt += `Khách hàng: ${userMessage}\nBạn:`;
      
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
      return {
        text: mockResponse,
        rooms: roomSearchResults || null,
        hasRooms: roomSearchResults && roomSearchResults.length > 0
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
    
    const sessionId = generateSessionId();
    
    const session = await ChatSession.create({
      sessionId,
      userId: (req.user && req.user._id) ? req.user._id : null,
      context: {}
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
    const { message, sessionId } = req.body;
    
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
    // QUAN TRỌNG: Reload session để đảm bảo có data mới nhất (đặc biệt là chatType)
    let session = await ChatSession.findOne({ sessionId: currentSessionId });
    const context = session?.context || {};
    
    // Kiểm tra nếu session đang ở human mode
    // Nếu là human mode, cho phép cả admin và user gửi tin nhắn (không chặn)
    // Nếu là bot mode và user là admin, thì chặn admin chat với bot
    // QUAN TRỌNG: Chỉ block admin khi chatType là 'bot' hoặc chưa được set (mặc định là bot)
    // KHÔNG block admin khi chatType là 'human'
    const isHumanMode = session && session.chatType === 'human';
    
    // Debug log để kiểm tra
    if (req.user && req.user.role === "admin") {
      console.log('🔍 chatWithAI - Admin check:', {
        email: req.user.email,
        sessionId: currentSessionId,
        chatType: session?.chatType || 'undefined',
        isHumanMode: isHumanMode
      });
    }
    
    if (!isHumanMode && req.user && req.user.role === "admin") {
      // Chỉ chặn admin khi đang chat với bot (không phải human mode)
      console.log('🚫 chatWithAI - Blocked admin from chatting with bot:', req.user.email);
      return res.status(403).json({
        success: false,
        message: "Admin không thể chat với bot. Vui lòng sử dụng Admin Chat để quản lý tin nhắn từ khách hàng."
      });
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

