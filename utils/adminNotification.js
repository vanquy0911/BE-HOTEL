import dotenv from "dotenv";
import sendEmail from "./sendemail.js";

// Đảm bảo env được load (phòng trường hợp file này chạy trước nơi khác gọi dotenv.config)
dotenv.config();

/**
 * Gửi email thông báo nội bộ cho admin khi có sự kiện quan trọng:
 * - Đặt phòng mới
 * - Hủy đặt phòng
 * - Thanh toán được xác nhận
 */
export const sendAdminNotification = async (subject, html, text = "") => {
  if (!process.env.ADMIN_EMAIL) {
    console.warn("⚠️ ADMIN_EMAIL is not set. Skipping admin notification email.");
    return;
  }

  try {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject,
      text,
      html,
    });
    console.log("✅ Admin notification email sent:", subject);
  } catch (error) {
    console.error("❌ Failed to send admin notification email:", error.message);
  }
};

export default sendAdminNotification;




