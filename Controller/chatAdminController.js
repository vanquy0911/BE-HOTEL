import asyncHandler from "express-async-handler";
import { ChatMessage, ChatSession } from "../Models/ChatModel.js";

// @route   GET /api/chat/admin/pending
// @desc    Lấy danh sách sessions (có thể filter theo status)
// @access  Private (Admin only)
export const getPendingChats = asyncHandler(async (req, res) => {
  try {
    // Lấy filter từ query params (mặc định hiển thị tất cả human chats)
    const { status, platform } = req.query;
    let statusFilter = { $in: ["active", "waiting", "resolved"] }; // Hiển thị tất cả
    
    if (status === 'pending') {
      statusFilter = { $in: ["active", "waiting"] };
    } else if (status === 'resolved') {
      statusFilter = "resolved";
    }
    
    // Xử lý platform filter - nếu filter là telegram nhưng model chưa có trong enum, 
    // thì dùng context.platform hoặc không filter
    let queryFilter = {
      chatType: "human",
      status: statusFilter
    };
    
    if (platform) {
      if (platform === 'web') {
        queryFilter.platform = 'web';
      } else if (platform === 'telegram') {
        // Tìm theo context.platform hoặc platform = 'telegram' (nếu có)
        // Sử dụng $or riêng để tránh conflict với queryFilter
        queryFilter = {
          ...queryFilter,
          $or: [
            { platform: 'telegram' },
            { 'context.platform': 'telegram' }
          ]
        };
      }
      // Nếu platform = 'all' hoặc không có, không thêm filter
    }

    console.log('🔍 [getPendingChats] Query filter:', JSON.stringify(queryFilter, null, 2));
    const pendingSessions = await ChatSession.find(queryFilter)
      .populate("userId", "fullName email")
      .populate("assignedTo", "fullName email")
      .sort({ transferredAt: -1, createdAt: -1 })
      .lean();
    
    console.log(`✅ [getPendingChats] Found ${pendingSessions.length} sessions`);

    // Lấy tin nhắn cuối cùng của mỗi session
    const sessionsWithLastMessage = await Promise.all(
      pendingSessions.map(async (session) => {
        const lastMessage = await ChatMessage.findOne({
          sessionId: session.sessionId
        })
          .sort({ timestamp: -1 })
          .lean();

        // Đếm số tin nhắn chưa đọc (từ user sau khi transfer)
        const transferredTime = session.transferredAt || session.createdAt;
        const unreadCount = await ChatMessage.countDocuments({
          sessionId: session.sessionId,
          sender: "user",
          timestamp: { $gt: transferredTime }
        });

        return {
          ...session,
          lastMessage: lastMessage?.message || "",
          lastMessageTime: lastMessage?.timestamp || session.createdAt,
          unreadCount
        };
      })
    );

    res.status(200).json({
      success: true,
      data: sessionsWithLastMessage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách chat",
      error: error.message
    });
  }
});

// @route   GET /api/chat/admin/sessions/:sessionId
// @desc    Lấy chi tiết một session (messages)
// @access  Private (Admin only)
export const getSessionDetails = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await ChatSession.findOne({ sessionId })
      .populate("userId", "fullName email")
      .populate("assignedTo", "fullName email")
      .lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    const messages = await ChatMessage.find({ sessionId })
      .sort({ timestamp: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        session,
        platform: session.platform, 
        context: session.context,
        messages
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy chi tiết session",
      error: error.message
    });
  }
});

// @route   POST /api/chat/admin/assign
// @desc    Gán session cho admin
// @access  Private (Admin only)
export const assignSession = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.body;
    const adminId = req.user._id;

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    session.assignedTo = adminId;
    session.status = "active";
    await session.save();

    res.status(200).json({
      success: true,
      message: "Đã gán session cho bạn",
      data: session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi gán session",
      error: error.message
    });
  }
});

// @route   POST /api/chat/admin/reply
// @desc    Admin trả lời tin nhắn
// @access  Private (Admin only)
export const adminReply = asyncHandler(async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    console.log('📤 [adminReply] Request:', { sessionId, messageLength: message?.length });

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tin nhắn không được để trống"
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
      console.error('❌ [adminReply] Session not found:', sessionId);
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    console.log('✅ [adminReply] Session found:', session.sessionId, 'Status:', session.status);

    // Lưu tin nhắn của admin
    const adminMessage = await ChatMessage.create({
      sessionId,
      userId: session.userId,
      message: message.trim(),
      sender: "admin"
    });

    console.log('✅ [adminReply] Message created:', adminMessage._id);

    // Cập nhật session
    session.messages.push(adminMessage._id);
    session.status = "active";
    await session.save();

    console.log('✅ [adminReply] Session updated successfully');

    res.status(200).json({
      success: true,
      data: {
        message: adminMessage,
        session
      }
    });
  } catch (error) {
    console.error('❌ [adminReply] Error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi tin nhắn",
      error: error.message
    });
  }
});

// @route   POST /api/chat/admin/resolve
// @desc    Đánh dấu session đã xử lý xong
// @access  Private (Admin only)
export const resolveSession = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.body;

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    session.status = "resolved";
    await session.save();

    res.status(200).json({
      success: true,
      message: "Đã đánh dấu session đã xử lý",
      data: session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi đánh dấu session",
      error: error.message
    });
  }
});

// @route   GET /api/chat/admin/stats
// @desc    Thống kê chat
// @access  Private (Admin only)
export const getChatStats = asyncHandler(async (req, res) => {
  try {
    const totalSessions = await ChatSession.countDocuments();
    const pendingSessions = await ChatSession.countDocuments({
      chatType: "human",
      status: { $in: ["active", "waiting"] }
    });
    const resolvedSessions = await ChatSession.countDocuments({
      status: "resolved"
    });
    const botSessions = await ChatSession.countDocuments({
      chatType: "bot"
    });

    res.status(200).json({
      success: true,
      data: {
        total: totalSessions,
        pending: pendingSessions,
        resolved: resolvedSessions,
        bot: botSessions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy thống kê",
      error: error.message
    });
  }
});

// @route   GET /api/chat/admin/unread-count
// @desc    Lấy số tin nhắn chưa đọc cho admin (dùng cho ChatWidget notification)
// @access  Private (Admin only)
export const getUnreadCount = asyncHandler(async (req, res) => {
  try {
    // Lấy tất cả sessions đang chờ hoặc active
    const pendingSessions = await ChatSession.find({
      chatType: "human",
      status: { $in: ["active", "waiting"] }
    }).select("sessionId transferredAt createdAt").lean();

    if (pendingSessions.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          unreadCount: 0,
          pendingSessions: 0
        }
      });
    }

    // Đếm tổng số tin nhắn chưa đọc từ user (sau khi transfer)
    // Sử dụng aggregation để tối ưu performance
    const sessionIds = pendingSessions.map(s => s.sessionId);
    
    // Đếm messages từ user trong các sessions này
    // (không cần filter theo transferredTime vì chỉ cần đếm messages từ user trong human chats)
    const totalUnread = await ChatMessage.countDocuments({
      sessionId: { $in: sessionIds },
      sender: "user"
    });

    res.status(200).json({
      success: true,
      data: {
        unreadCount: totalUnread,
        pendingSessions: pendingSessions.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy số tin nhắn chưa đọc",
      error: error.message
    });
  }
});

// @route   DELETE /api/chat/admin/sessions/:sessionId
// @desc    Xóa session và tất cả messages
// @access  Private (Admin only)
export const deleteSession = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await ChatSession.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy session"
      });
    }

    // Xóa tất cả messages của session
    await ChatMessage.deleteMany({ sessionId });
    
    // Xóa session
    await ChatSession.deleteOne({ sessionId });

    res.status(200).json({
      success: true,
      message: "Đã xóa session thành công"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa session",
      error: error.message
    });
  }
});

