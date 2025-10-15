import express from "express";
import {
  createBooking,
  getAllBookings,
  getBookingById,
  // deleteBooking,
  cancelBooking,
  confirmBooking,
} from "../Controller/bookingController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

// Đặt phòng mới
router.post("/", verifyToken, createBooking);

// Lấy tất cả đặt phòng (chỉ admin)
router.get("/", verifyToken, isAdmin, getAllBookings);

// Lấy chi tiết đặt phòng theo ID
router.get("/:id", verifyToken, getBookingById);

// Xoá đặt phòng (admin hoặc user đều có thể tuỳ bạn thêm điều kiện kiểm tra)
// router.delete("/:id", verifyToken, isAdmin, deleteBooking);

// Huỷ đặt phòng (người dùng hoặc admin)
router.put("/:id/cancel", verifyToken, cancelBooking);

// Xác nhận đặt phòng (chỉ admin)
router.put("/:id/confirm", verifyToken, isAdmin, confirmBooking);

export default router;
