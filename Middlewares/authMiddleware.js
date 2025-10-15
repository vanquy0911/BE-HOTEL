import jwt from "jsonwebtoken";
import User from "../Models/UserModel.js";

// ✅ Middleware kiểm tra đăng nhập
export const verifyToken = async (req, res, next) => {
  // Kiểm tra xem token có trong header không
    try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Không có token!" });
    }
// Lấy token từ header
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
// Kiểm tra token hợp lệ
    const user = await User.findById(decoded._id).select("-password");
    if (!user) return res.status(401).json({ message: "Token không hợp lệ!" });

    req.user = user; // 👈 Gán user vào request
    next();
  } catch (err) {
    res.status(401).json({ message: "Token hết hạn hoặc lỗi!", error: err.message });
  }
};

// ✅ Middleware kiểm tra quyền admin
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ message: "Không có quyền truy cập" });
  }
};
