import express from 'express';
import { 
  getDashboardStats, 
  getRevenueReport, 
  getBookingReport, 
  getRoomReport,
  getReviewReport 
} from '../Controller/reportController.js';
import { verifyToken, isAdmin } from '../Middlewares/authMiddleware.js';

const router = express.Router();

// Tất cả routes đều cần authentication và quyền admin
router.use(verifyToken);
router.use(isAdmin);

// 📊 Dashboard tổng quan - Lấy thống kê chính
// GET /api/reports/dashboard?period=month
router.get('/dashboard', getDashboardStats);

// 💰 Báo cáo doanh thu chi tiết
// GET /api/reports/revenue?period=month&startDate=2024-01-01&endDate=2024-01-31
router.get('/revenue', getRevenueReport);

// 📅 Báo cáo đặt phòng chi tiết
// GET /api/reports/bookings?period=month
router.get('/bookings', getBookingReport);

// 🏨 Báo cáo phòng chi tiết
// GET /api/reports/rooms
router.get('/rooms', getRoomReport);

// ⭐ Báo cáo đánh giá
// GET /api/reports/reviews?period=month
router.get('/reviews', getReviewReport);

export default router;
