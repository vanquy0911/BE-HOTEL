// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

// Load biến môi trường từ .env TRƯỚC KHI import các modules khác
dotenv.config();

import connectDB from "./config/configdb.js";
import userRoutes from "./routes/userRoutes.js";
import roomRoutes from "./routes/roomRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import passport from "./config/passport.js";

// Khởi tạo app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:5173"],  // hỗ trợ cả 2 port
  credentials: true,               // cho phép gửi cookie/token
}));

app.use(express.json({ limit: '50mb' })); // xử lý JSON từ body với giới hạn 50MB
app.use(express.urlencoded({ limit: '50mb', extended: true })); // xử lý form data

// Passport middleware
app.use(passport.initialize());

// Routes
app.use("/api/rooms", roomRoutes);
app.use("/api/users", userRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/auth", authRoutes);  

// Kết nối MongoDB và chạy server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Kết nối MongoDB thất bại:", error.message);
  });
