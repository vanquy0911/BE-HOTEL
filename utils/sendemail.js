import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();
export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    console.log('📧 SendEmail function called with:', { to, subject });
    console.log('🔍 Email config:', {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS ? '***' : 'NOT SET'
    });

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Email configuration missing: EMAIL_USER or EMAIL_PASS not set');
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Email gửi đi
        pass: process.env.EMAIL_PASS, // Mật khẩu ứng dụng
      },
    });

    console.log('✅ Transporter created');

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    };

    console.log('📤 Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const info = await transporter.sendMail(mailOptions);

    // Thông báo khi gửi thành công
    console.log(`✅ Email đã được gửi đến: ${to}`);
    console.log('📧 Email info:', info);

    return info;
  } catch (error) {
    // Thông báo khi gửi thất bại
    console.error("❌ Lỗi khi gửi email:", error.message);
    console.error("❌ Full error:", error);
    throw new Error(`Không thể gửi email: ${error.message}`);
  }
};
export default sendEmail;