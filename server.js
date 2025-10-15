// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/configdb.js";
import userRoutes from "./routes/userRoutes.js";
import roomRoutes from "./routes/roomRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";

// Load biến môi trường từ .env
dotenv.config();

// Khởi tạo app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: "http://localhost:5173",  // domain frontend
  credentials: true,               // cho phép gửi cookie/token
}));

app.use(express.json()); // xử lý JSON từ body

// Routes
app.use("/api/rooms", roomRoutes);
app.use("/api/users", userRoutes);
app.use("/api/bookings", bookingRoutes);
// app.use("/auth", authRoutes);  

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
