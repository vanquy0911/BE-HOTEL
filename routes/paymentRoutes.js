import express from "express";
import {
  createPayment,
  getAllPayments,
  getPaymentById,
  confirmPayment,
  cancelPayment,
  refundPayment,
  getPaymentStats,
  createVnpayPayment,
  vnpayCallback,
  updateReceiptImage
} from "../Controller/paymentController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";
import uploadPaymentReceipt from "../Middlewares/uploadPayment.js";

const router = express.Router();

// @route   POST /api/payments
// @desc    Tạo thanh toán mới (có thể kèm ảnh bill chuyển khoản)
// @access  Private
router.post("/", verifyToken, uploadPaymentReceipt.single('receiptImage'), createPayment);

// @route   GET /api/payments
// @desc    Lấy tất cả thanh toán (Admin)
// @access  Private/Admin
router.get("/", verifyToken, isAdmin, getAllPayments);

// @route   GET /api/payments/stats
// @desc    Lấy thống kê thanh toán
// @access  Private/Admin
router.get("/stats", verifyToken, isAdmin, getPaymentStats);

// @route   GET /api/payments/:id
// @desc    Lấy thanh toán theo ID
// @access  Private
router.get("/:id", verifyToken, getPaymentById);

// @route   PUT /api/payments/:id/confirm
// @desc    Xác nhận thanh toán (Admin)
// @access  Private/Admin
router.put("/:id/confirm", verifyToken, isAdmin, confirmPayment);

// @route   PUT /api/payments/:id/cancel
// @desc    Hủy thanh toán
// @access  Private
router.put("/:id/cancel", verifyToken, cancelPayment);

// @route   PUT /api/payments/:id/receipt-image
// @desc    Cập nhật ảnh bill chuyển khoản
// @access  Private
router.put("/:id/receipt-image", verifyToken, uploadPaymentReceipt.single('receiptImage'), updateReceiptImage);

// @route   PUT /api/payments/:id/refund
// @desc    Hoàn tiền (Admin)
// @access  Private/Admin
router.put("/:id/refund", verifyToken, isAdmin, refundPayment);

// VNPay routes
// @route   POST /api/payments/vnpay/create
// @desc    Tạo URL thanh toán VNPay
// @access  Private
router.post("/vnpay/create", verifyToken, createVnpayPayment);

// @route   GET /api/payments/vnpay/callback
// @desc    VNPay callback
// @access  Public
router.get("/vnpay/callback", vnpayCallback);

export default router;
