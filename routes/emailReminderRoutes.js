// routes/emailReminderRoutes.js
import express from "express";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";
import emailReminderService from "../services/emailReminderService.js";

const router = express.Router();

// @desc    Chạy tất cả email nhắc nhở (Admin only - để test)
// @route   POST /api/email-reminders/run-all
// @access  Private/Admin
router.post("/run-all", verifyToken, isAdmin, async (req, res) => {
  try {
    const results = await emailReminderService.runAllReminders();
    res.json({
      success: true,
      message: "Email reminders đã được gửi",
      results
    });
  } catch (error) {
    console.error('❌ Error running email reminders:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi chạy email reminders",
      error: error.message
    });
  }
});

// @desc    Gửi email nhắc nhở check-in (Admin only - để test)
// @route   POST /api/email-reminders/check-in
// @access  Private/Admin
router.post("/check-in", verifyToken, isAdmin, async (req, res) => {
  try {
    const results = await emailReminderService.sendCheckInReminders();
    res.json({
      success: true,
      message: "Check-in reminders đã được gửi",
      results
    });
  } catch (error) {
    console.error('❌ Error sending check-in reminders:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi check-in reminders",
      error: error.message
    });
  }
});

// @desc    Gửi email cảm ơn sau checkout (Admin only - để test)
// @route   POST /api/email-reminders/thank-you
// @access  Private/Admin
router.post("/thank-you", verifyToken, isAdmin, async (req, res) => {
  try {
    const results = await emailReminderService.sendThankYouAfterCheckout();
    res.json({
      success: true,
      message: "Thank you emails đã được gửi",
      results
    });
  } catch (error) {
    console.error('❌ Error sending thank you emails:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi thank you emails",
      error: error.message
    });
  }
});

// @desc    Gửi email nhắc nhở thanh toán (Admin only - để test)
// @route   POST /api/email-reminders/payment
// @access  Private/Admin
router.post("/payment", verifyToken, isAdmin, async (req, res) => {
  try {
    const results = await emailReminderService.sendPaymentReminders();
    res.json({
      success: true,
      message: "Payment reminders đã được gửi",
      results
    });
  } catch (error) {
    console.error('❌ Error sending payment reminders:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi gửi payment reminders",
      error: error.message
    });
  }
});

export default router;

