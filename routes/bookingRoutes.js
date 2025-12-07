import express from "express";
import {
  createBooking,
  getAllBookings,
  getBookingById,
  getMyBookings,
  updateBooking,
  deleteBooking,
  cancelBooking,
  confirmBooking,
} from "../Controller/bookingController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

// Đặt phòng mới
router.post("/", verifyToken, createBooking);

// Lấy đơn đặt phòng của user hiện tại
router.get("/my-bookings", verifyToken, getMyBookings);

// Lấy tất cả đặt phòng (chỉ admin)
router.get("/", verifyToken, isAdmin, getAllBookings);

// Lấy chi tiết đặt phòng theo ID
router.get("/:id", verifyToken, getBookingById);

// Cập nhật đặt phòng
router.put("/:id", verifyToken, updateBooking);

// Xoá đặt phòng (chỉ admin)
router.delete("/:id", verifyToken, isAdmin, deleteBooking);

// Huỷ đặt phòng (người dùng hoặc admin)
router.put("/:id/cancel", verifyToken, cancelBooking);

// Xác nhận đặt phòng (chỉ admin)
router.put("/:id/confirm", verifyToken, isAdmin, confirmBooking);

export default router;
