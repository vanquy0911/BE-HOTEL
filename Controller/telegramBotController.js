import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { ChatMessage, ChatSession } from '../Models/ChatModel.js';
import { getAIResponse, generateSessionId } from './chatController.js';
import mongoose from 'mongoose';
dotenv.config();
let isMongoConnected = false;

// Khởi tạo Telegram Bot (có thể bật/tắt qua ENV để tránh lỗi 409 khi chạy nhiều instance)
const token = process.env.TELEGRAM_BOT_TOKEN;
const enableTelegram = process.env.ENABLE_TELEGRAM_BOT === 'true';
let bot = null;

if (token && enableTelegram) {
  // Sử dụng polling mode (dev). Khi deploy nhiều instance, nên tắt hoặc chuyển webhook.
  bot = new TelegramBot(token, { 
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10
      }
    }
  });
  console.log('✅ Telegram Bot initialized successfully (polling).');
} else {
  console.log('ℹ️  Telegram bot disabled. Set ENABLE_TELEGRAM_BOT=true and TELEGRAM_BOT_TOKEN to enable.');
}

const checkMongoConnection = () => {
    return mongoose.connection.readyState === 1;
  };

// Helper function để generate session ID cho Telegram user
const generateTelegramSessionId = (telegramUserId) => {
  return `telegram_${telegramUserId}_${Date.now()}`;
};

// Lấy hoặc tạo session cho Telegram user
const getOrCreateTelegramSession = async (telegramUserId, username, firstName, lastName) => {
  try {
    // Tìm session gần nhất của user này (trong vòng 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let session = await ChatSession.findOne({
      'context.telegramUserId': telegramUserId,
      createdAt: { $gte: oneDayAgo }
    }).sort({ createdAt: -1 });

    if (!session) {
      // Tạo session mới
      const sessionId = generateTelegramSessionId(telegramUserId);
      session = await ChatSession.create({
        sessionId,
        userId: null, // Telegram user chưa link với account website
        context: {
          telegramUserId,
          telegramUsername: username,
          telegramFirstName: firstName,
          telegramLastName: lastName,
          platform: 'telegram'
        },
        platform: 'telegram',
        chatType: 'bot',
        status: 'active'
      });
      console.log(`✅ Created new Telegram session: ${sessionId} for user: ${username || telegramUserId}`);
    } else {
      // Cập nhật thông tin user nếu có thay đổi
      if (session.context.telegramUsername !== username) {
        session.context.telegramUsername = username;
        session.context.telegramFirstName = firstName;
        session.context.telegramLastName = lastName;
        await session.save();
      }
    }

    return session;
  } catch (error) {
    console.error('❌ Error getting/creating Telegram session:', error);
    throw error;
  }
};

// Format phòng để hiển thị trên Telegram (Markdown)
// Format phòng để hiển thị trên Telegram (Markdown)
// Format phòng để hiển thị trên Telegram (plain text, không dùng Markdown)
const formatRoomsForTelegram = (rooms) => {
    if (!rooms || rooms.length === 0) return null;
  
    let message = '\n\n🏨 Các phòng phù hợp:\n\n';
    rooms.forEach((room, index) => {
      message += `${index + 1}. ${room.name || 'N/A'} - ${room.roomType || 'N/A'}\n`;
      message += `   💰 Giá: ${room.pricePerNight?.toLocaleString('vi-VN') || 'N/A'} VNĐ/đêm\n`;
      message += `   👥 Số người: ${room.maxOccupancy || 'N/A'}\n`;
      message += `   🌅 View: ${room.view || 'N/A'}\n`;
      if (room.amenities && room.amenities.length > 0) {
        message += `   ✨ Tiện nghi: ${room.amenities.slice(0, 3).join(', ')}\n`;
      }
      message += `   🆔 ID: ${room._id}\n\n`;
    });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const isPublicUrl = frontendUrl && !frontendUrl.includes('localhost') && !frontendUrl.includes('127.0.0.1');
    
    message += `💡 Để đặt phòng:\n`;
    if (isPublicUrl) {
      message += `• Truy cập: ${frontendUrl}/rooms\n`;
    }
    message += `• Hoặc liên hệ hotline: 0901 234 567`;
  
    return message;
  };

// Escape Markdown special characters
const escapeMarkdown = (text) => {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
};

// Xử lý tin nhắn từ Telegram
// Xử lý tin nhắn từ Telegram
const handleTelegramMessage = async (msg) => {
    try {
      const chatId = msg.chat.id;
      const telegramUserId = msg.from.id;
      const username = msg.from.username || null;
      const firstName = msg.from.first_name || '';
      const lastName = msg.from.last_name || '';
      const userMessage = msg.text;
  
      console.log(`📨 Received message from Telegram user ${telegramUserId}: ${userMessage}`);
  
      // Bỏ qua tin nhắn không phải text (sticker, photo, etc.)
      if (!userMessage) {
        await bot.sendMessage(chatId, 
          'Xin lỗi, tôi chỉ có thể xử lý tin nhắn văn bản. Vui lòng gửi tin nhắn bằng chữ để tôi có thể hỗ trợ bạn tốt hơn. 😊'
        );
        return;
      }
  
      // Lấy hoặc tạo session
      console.log('🔍 Getting or creating session...');
      const session = await getOrCreateTelegramSession(telegramUserId, username, firstName, lastName);
      console.log(`✅ Session found/created: ${session.sessionId}`);
  
      // Lấy lịch sử hội thoại (giới hạn 10 tin nhắn gần nhất)
      console.log('📜 Fetching conversation history...');
      const conversationHistory = await ChatMessage.find({ sessionId: session.sessionId })
        .sort({ timestamp: 1 })
        .limit(10)
        .select("message sender")
        .lean();
      console.log(`✅ Found ${conversationHistory.length} previous messages`);
  
      // Lưu tin nhắn của user
      console.log('💾 Saving user message...');
      const userMessageDoc = await ChatMessage.create({
        sessionId: session.sessionId,
        userId: session.userId,
        message: userMessage.trim(),
        sender: "user"
      });
      console.log('✅ User message saved');
  
      // Gửi typing indicator
      await bot.sendChatAction(chatId, 'typing');
  
      // Lấy phản hồi từ AI (tái sử dụng logic từ chatController)
      console.log('🤖 Getting AI response...');
      let aiResponse;
      try {
        aiResponse = await getAIResponse(
          userMessage.trim(), 
          session.context, 
          conversationHistory
        );
        console.log('✅ AI response received');
      } catch (aiError) {
        console.error('❌ Error getting AI response:', aiError);
        throw aiError;
      }
  
      // Extract text và rooms từ response
      const responseText = typeof aiResponse === 'string' ? aiResponse : aiResponse.text;
      const rooms = typeof aiResponse === 'object' && aiResponse.rooms ? aiResponse.rooms : null;
      const hasRooms = typeof aiResponse === 'object' && aiResponse.hasRooms ? aiResponse.hasRooms : false;
  
      console.log(`📝 Response text length: ${responseText?.length || 0}`);
      console.log(`🏨 Has rooms: ${hasRooms}`);
  
      // Lưu tin nhắn của bot
      console.log('💾 Saving bot message...');
      const botMessageDoc = await ChatMessage.create({
        sessionId: session.sessionId,
        userId: session.userId,
        message: responseText,
        sender: "bot"
      });
      console.log('✅ Bot message saved');
  
      // Cập nhật session với messages
      session.messages.push(userMessageDoc._id, botMessageDoc._id);
      await session.save();
  
      // Format message - responseText đã có đầy đủ thông tin phòng từ Gemini
      // ✅ FIX: Không thêm formatRoomsForTelegram nữa vì responseText đã có thông tin phòng
      // Nếu thêm sẽ bị lặp lại 2 lần
            let finalMessage = responseText;
      
            // Tạo inline keyboard - chỉ thêm button nếu URL là public (không phải localhost)
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const keyboard = {
              inline_keyboard: []
            };
      
            // Chỉ thêm button "Truy cập Website" nếu URL không phải localhost
            // ✅ FIX: Xóa button "Liên hệ Hotline" vì Telegram không hỗ trợ tel: protocol
            const isPublicUrl = frontendUrl && !frontendUrl.includes('localhost') && !frontendUrl.includes('127.0.0.1');
            
            if (isPublicUrl) {
              keyboard.inline_keyboard.push([
                { 
                  text: '🌐 Truy cập Website', 
                  url: frontendUrl 
                }
              ]);
            }
            // ✅ FIX: Xóa else block vì không còn button nào để thêm cho localhost
      
            // Thêm nút chuyển sang nhân viên nếu chưa ở human mode
            if (session.chatType === 'bot') {
              keyboard.inline_keyboard.push([
                { 
                  text: '👤 Chuyển sang nhân viên', 
                  callback_data: `transfer_to_human_${session.sessionId}` 
                }
              ]);
            }
      
            // Gửi phản hồi về Telegram - KHÔNG dùng MarkdownV2, dùng plain text
            console.log('📤 Sending message to Telegram...');
            try {
              // Gửi message không dùng parse_mode để tránh lỗi Markdown
              await bot.sendMessage(chatId, finalMessage, {
                reply_markup: keyboard,
                disable_web_page_preview: false
              });
              console.log('✅ Message sent successfully');
            } catch (sendError) {
              console.error('❌ Error sending message:', sendError);
              // Thử gửi lại không có keyboard
              try {
                await bot.sendMessage(chatId, finalMessage, {
                  disable_web_page_preview: false
                });
                console.log('✅ Message sent successfully without keyboard');
              } catch (retryError) {
                console.error('❌ Error sending message without keyboard:', retryError);
                throw retryError;
              }
            }
  
    } catch (error) {
      console.error('❌ Error handling Telegram message:', error);
      console.error('❌ Error stack:', error.stack);
      
      // Log chi tiết hơn về lỗi
      if (error.name) console.error('❌ Error name:', error.name);
      if (error.message) console.error('❌ Error message:', error.message);
      if (error.code) console.error('❌ Error code:', error.code);
      
      try {
        await bot.sendMessage(msg.chat.id, 
          'Xin lỗi, đã có lỗi xảy ra khi xử lý tin nhắn của bạn. Vui lòng thử lại sau hoặc liên hệ hotline: 0901 234 567\n\n' +
          'Nếu lỗi vẫn tiếp tục, vui lòng liên hệ trực tiếp với chúng tôi.'
        );
      } catch (sendError) {
        console.error('❌ Error sending error message:', sendError);
      }
    }
  };

// Xử lý callback queries (khi user click button)
const handleCallbackQuery = async (query) => {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const telegramUserId = query.from.id;
  
      // Xử lý chuyển sang nhân viên
      if (data.startsWith('transfer_to_human_')) {
        const sessionId = data.replace('transfer_to_human_', '');
        const session = await ChatSession.findOne({ sessionId });
  
        if (session && session.chatType === 'bot') {
          session.chatType = 'human';
          session.status = 'waiting';
          session.transferredAt = new Date();
          await session.save();
  
          // Gửi tin nhắn thông báo
          const notificationMessage = await ChatMessage.create({
            sessionId: session.sessionId,
            userId: session.userId,
            message: "Đã chuyển sang chế độ chat với nhân viên. Nhân viên sẽ trả lời bạn trong thời gian sớm nhất. Xin cảm ơn!",
            sender: "bot"
          });
  
          session.messages.push(notificationMessage._id);
          await session.save();
  
          await bot.sendMessage(chatId, 
            '✅ Đã chuyển sang chế độ chat với nhân viên. Nhân viên sẽ trả lời bạn trong thời gian sớm nhất. Xin cảm ơn!'
          );
        } else {
          await bot.sendMessage(chatId, 
            '⚠️ Không thể chuyển sang nhân viên. Vui lòng thử lại sau.'
          );
        }
      }
  
      // Answer callback query để remove loading state
      await bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error('❌ Error handling callback query:', error);
      try {
        await bot.answerCallbackQuery(query.id, { 
          text: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
          show_alert: false 
        });
      } catch (answerError) {
        console.error('❌ Error answering callback query:', answerError);
      }
    }
  };

// Khởi tạo bot handlers (chỉ khi bot đã được khởi tạo)
if (bot) {
  // Xử lý tin nhắn text
  bot.on('message', (msg) => {
    // Bỏ qua các tin nhắn từ groups/channels (chỉ xử lý private messages)
    if (msg.chat.type !== 'private') {
      return;
    }

    // Xử lý commands
    if (msg.text && msg.text.startsWith('/')) {
      // Commands sẽ được xử lý riêng
      return;
    }

    // Xử lý tin nhắn thường
    if (msg.text) {
      handleTelegramMessage(msg);
    }
  });

  // Xử lý callback queries (button clicks)
  bot.on('callback_query', handleCallbackQuery);

  // Xử lý lỗi polling
  bot.on('polling_error', (error) => {
    console.error('❌ Telegram polling error:', error.message || error);
  });

  // Welcome message khi user start bot
    // Welcome message khi user start bot
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const firstName = msg.from.first_name || 'bạn';
        
        const welcomeMessage = `👋 Xin chào ${firstName}! Tôi là trợ lý ảo của Rayal Park Hotel.\n\n` +
          `Tôi có thể giúp bạn:\n` +
          `• 🏨 Tư vấn về giá phòng và loại phòng\n` +
          `• 🔍 Tìm phòng trống\n` +
          `• 📋 Hướng dẫn đặt phòng\n` +
          `• ℹ️ Thông tin về dịch vụ khách sạn\n` +
          `• ❌ Chính sách hủy phòng\n\n` +
          `Hãy gửi tin nhắn cho tôi để bắt đầu! 😊`;
    
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const isPublicUrl = frontendUrl && !frontendUrl.includes('localhost') && !frontendUrl.includes('127.0.0.1');
        
        const keyboard = {
          inline_keyboard: []
        };
        
        // ✅ FIX: Xóa button "Hotline" vì Telegram không hỗ trợ tel: protocol
        if (isPublicUrl) {
          keyboard.inline_keyboard.push([
            { text: '🌐 Truy cập Website', url: frontendUrl }
          ]);
        }
        // ✅ FIX: Xóa else block vì không còn button nào để thêm cho localhost
        
        bot.sendMessage(chatId, welcomeMessage, {
          reply_markup: keyboard
        });
      });
    
      // Help command
      bot.onText(/\/help/, (msg) => {
        const chatId = msg.chat.id;
        const helpMessage = `📖 Hướng dẫn sử dụng:\n\n` +
          `• Gửi tin nhắn bất kỳ để chat với bot\n` +
          `• Sử dụng /start để bắt đầu lại\n` +
          `• Sử dụng /help để xem hướng dẫn này\n\n` +
          `Ví dụ câu hỏi:\n` +
          `• "Tôi muốn đặt phòng cho 4 người, view biển"\n` +
          `• "Giá phòng là bao nhiêu?"\n` +
          `• "Chính sách hủy phòng như thế nào?"\n` +
          `• "Khách sạn có những dịch vụ gì?"\n\n` +
          `💡 Mẹo: Bạn có thể hỏi trực tiếp bằng tiếng Việt, bot sẽ hiểu và trả lời!`;
    
        bot.sendMessage(chatId, helpMessage);
      });

  console.log('✅ Telegram Bot handlers initialized');
}

export default bot;