import express from "express";
import { chatWithAI, getChatHistory, createSession, transferToHuman, linkSessionToUser } from "../Controller/chatController.js";
import { 
  getPendingChats, 
  getSessionDetails, 
  assignSession, 
  adminReply, 
  resolveSession,
  deleteSession,
  getChatStats,
  getUnreadCount
} from "../Controller/chatAdminController.js";
import { verifyToken, isAdmin, optionalVerifyToken } from "../Middlewares/authMiddleware.js";

const router = express.Router();

// Public routes (sử dụng optionalVerifyToken để parse user nếu có token)
router.post("/session", optionalVerifyToken, createSession);
router.post("/", optionalVerifyToken, chatWithAI);
router.post("/transfer-to-human", optionalVerifyToken, transferToHuman);
router.post("/link-session", optionalVerifyToken, linkSessionToUser); // Link session với user đã đăng nhập
router.get("/history/:sessionId", optionalVerifyToken, getChatHistory); // Public - không cần auth để user có thể xem lịch sử

// Admin routes
router.get("/admin/pending", verifyToken, isAdmin, getPendingChats);
router.get("/admin/sessions/:sessionId", verifyToken, isAdmin, getSessionDetails);
router.post("/admin/assign", verifyToken, isAdmin, assignSession);
router.post("/admin/reply", verifyToken, isAdmin, adminReply);
router.post("/admin/resolve", verifyToken, isAdmin, resolveSession);
router.delete("/admin/sessions/:sessionId", verifyToken, isAdmin, deleteSession);
router.get("/admin/stats", verifyToken, isAdmin, getChatStats);
router.get("/admin/unread-count", verifyToken, isAdmin, getUnreadCount); // Notification cho ChatWidget

export default router;

