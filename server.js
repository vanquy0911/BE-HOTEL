// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import connectDB from "./config/configdb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import userRoutes from "./routes/userRoutes.js";
import roomRoutes from "./routes/roomRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import serviceRoutes from "./routes/serviceRoutes.js";
import promotionRoutes from "./routes/promotionRoutes.js";
import specialRequestRoutes from "./routes/specialRequestRoutes.js";
import contactRoutes from "./routes/contactRoutes.js";
import nearbyPlaceRoutes from "./routes/nearbyPlaceRoutes.js";
import tourRoutes from "./routes/tourRoutes.js";
import emailReminderRoutes from "./routes/emailReminderRoutes.js";
import "./Controller/telegramBotController.js";
import googleCalendarService from "./services/googleCalendarService.js";
import googleSheetsService from "./services/googleSheetsService.js";
import emailReminderService from "./services/emailReminderService.js";
import { errorHandler, notFound } from "./Middlewares/errorHandler.js";

// Load biến môi trường từ .env
dotenv.config();

// Khởi tạo Google Services khi server start
(async () => {
  try {
    await googleCalendarService.initialize();
  } catch (error) {
    console.error('❌ Failed to initialize Google Calendar Service:', error.message);
  }
  
  try {
    await googleSheetsService.initialize();
  } catch (error) {
    console.error('❌ Failed to initialize Google Sheets Service:', error.message);
  }
})();

// Khởi tạo app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const defaultOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:3001",
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean)
  : defaultOrigins;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`⚠️ Blocked CORS origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Đảm bảo phản hồi preflight (OPTIONS) cho Express 5 (không hỗ trợ `app.options('*', ...)`)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin || allowedOrigins[0]);
    }
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '50mb' })); // xử lý JSON từ body với giới hạn 50MB
app.use(express.urlencoded({ limit: '50mb', extended: true })); // xử lý form data

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use("/api/rooms", roomRoutes);
app.use("/api/users", userRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/special-requests", specialRequestRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/nearby-places", nearbyPlaceRoutes);
app.use("/api/tours", tourRoutes);
app.use("/api/email-reminders", emailReminderRoutes);
// app.use("/auth", authRoutes);  

// Error handlers (phải đặt sau tất cả routes)
app.use(notFound);
app.use(errorHandler);

// Kết nối MongoDB và chạy server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
      
      // ✅ Khởi động Email Reminder Service
      console.log('📧 [Email Reminder] Starting email reminder service...');
      
      // Chạy ngay lập tức khi server start (để test)
      setTimeout(async () => {
        try {
          await emailReminderService.runAllReminders();
        } catch (error) {
          console.error('❌ [Email Reminder] Error running initial reminders:', error);
        }
      }, 10000); // Chờ 10 giây sau khi server start
      
      // Chạy định kỳ mỗi giờ (3600000 ms)
      setInterval(async () => {
        try {
          await emailReminderService.runAllReminders();
        } catch (error) {
          console.error('❌ [Email Reminder] Error running scheduled reminders:', error);
        }
      }, 60 * 60 * 1000); // Mỗi 1 giờ
      
      // Chạy check-in reminders mỗi ngày lúc 9:00 AM
      const scheduleDailyCheckIn = () => {
        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(9, 0, 0, 0); // 9:00 AM
        
        // Nếu đã qua 9:00 AM hôm nay, chạy vào 9:00 AM ngày mai
        if (now > nextRun) {
          nextRun.setDate(nextRun.getDate() + 1);
        }
        
        const msUntilNextRun = nextRun.getTime() - now.getTime();
        
        setTimeout(async () => {
          try {
            await emailReminderService.sendCheckInReminders();
            // Lên lịch lại cho ngày tiếp theo
            scheduleDailyCheckIn();
          } catch (error) {
            console.error('❌ [Email Reminder] Error in daily check-in reminder:', error);
            scheduleDailyCheckIn(); // Vẫn lên lịch lại dù có lỗi
          }
        }, msUntilNextRun);
        
        console.log(`📧 [Email Reminder] Next check-in reminder scheduled for: ${nextRun.toLocaleString('vi-VN')}`);
      };
      
      // Chạy thank you emails mỗi ngày lúc 6:00 PM
      const scheduleDailyThankYou = () => {
        const now = new Date();
        const nextRun = new Date();
        nextRun.setHours(18, 0, 0, 0); // 6:00 PM
        
        if (now > nextRun) {
          nextRun.setDate(nextRun.getDate() + 1);
        }
        
        const msUntilNextRun = nextRun.getTime() - now.getTime();
        
        setTimeout(async () => {
          try {
            await emailReminderService.sendThankYouAfterCheckout();
            scheduleDailyThankYou();
          } catch (error) {
            console.error('❌ [Email Reminder] Error in daily thank you email:', error);
            scheduleDailyThankYou();
          }
        }, msUntilNextRun);
        
        console.log(`📧 [Email Reminder] Next thank you email scheduled for: ${nextRun.toLocaleString('vi-VN')}`);
      };
      
      // Khởi động các scheduled jobs
      scheduleDailyCheckIn();
      scheduleDailyThankYou();
      
      console.log('✅ [Email Reminder] Email reminder service started successfully');
    });
  })
  .catch((error) => {
    console.error("❌ Kết nối MongoDB thất bại:", error.message);
  });
