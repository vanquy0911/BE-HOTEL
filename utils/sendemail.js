import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();
export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Email gửi đi
        pass: process.env.EMAIL_PASS, // Mật khẩu ứng dụng
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    };

    const info = await transporter.sendMail(mailOptions);

    // Thông báo khi gửi thành công
    console.log(`Email đã được gửi đến: ${to}`);

    return info;
  } catch (error) {
    // Thông báo khi gửi thất bại
    console.error(" Lỗi khi gửi email:", error.message);
    throw new Error("Không thể gửi email, vui lòng thử lại sau!");
  }
};
export default sendEmail;