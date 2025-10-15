import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import crypto from "crypto";
import sendEmail from "../utils/sendemail.js";

// Hàm đăng ký người dùng
// @route   POST /api/users/register
export const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, role } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400);
    throw new Error("Email đã tồn tại");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    fullName,
    email,
    phone,
    password: hashedPassword,
    role: role || "user",
  });

  res.status(201).json({ message: "Đăng ký thành công!", user });
});

// Hàm đăng nhập người dùng
// @route   POST /api/users/login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    res.status(400);
    throw new Error("Tài khoản không tồn tại!");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(401);
    throw new Error("Mật khẩu không đúng!");
  }

  const token = jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.status(200).json({
    message: "Đăng nhập thành công!",
    token,
    user: {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    },
  });
});

// Hàm lấy người dùng theo ID
// @route   GET /api/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");

  if (!user) {
    res.status(404);
    throw new Error("Người dùng không tồn tại!");
  }

  res.status(200).json(user);
});

// Hàm cập nhật thông tin người dùng
// @route   PUT /api/users/:id
export const updateUser = asyncHandler(async (req, res) => {
  const { fullName, email, password, phone } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Người dùng không tồn tại!");
  }

  user.fullName = fullName || user.fullName;
  user.email = email || user.email;
  user.phone = phone || user.phone;

  if (password) {
    user.password = await bcrypt.hash(password, 10);
  }

  await user.save();
  res.status(200).json({ message: "Cập nhật thành công!", user });
});

// Lấy danh sách tất cả người dùng (admin)
// @route   GET /api/users
export const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select("-password");
  res.status(200).json(users);
});

// Hàm xoá người dùng
// @route   DELETE /api/users/:id
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng!");
  }

  res.status(200).json({ message: "Đã xoá người dùng!" });
});

// Hàm tìm kiếm người dùng theo từ khoá
// @route   GET /api/users/search?keyword=abc
export const searchUsers = asyncHandler(async (req, res) => {
  const keyword = req.query.keyword;

  if (!keyword) {
    res.status(400);
    throw new Error("Vui lòng nhập từ khóa tìm kiếm!");
  }

  const users = await User.find({
    $or: [
      { fullName: { $regex: keyword, $options: "i" } },
      { email: { $regex: keyword, $options: "i" } },
      { phone: { $regex: keyword, $options: "i" } },
    ],
  }).select("-password");

  res.status(200).json(users);
});

// Hàm gửi mã OTP quên mật khẩu
// @route   POST /api/users/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Kiểm tra người dùng tồn tại
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Email không tồn tại trong hệ thống." });
    }

    // Tạo token reset
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Lưu token và thời gian hết hạn vào user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 phút
    await user.save();

    // Tạo URL reset
    const resetUrl = `http://localhost:5000/api/users/reset-password/${resetToken}`;

    // Gửi email
    await sendEmail({
      to: user.email,
      subject: "Khôi phục mật khẩu - HomeBooking",
      html: `
        <h2>Xin chào ${user.fullName || "bạn"}!</h2>
        <p>Bạn vừa yêu cầu khôi phục mật khẩu.</p>
        <p>Nhấn vào liên kết dưới đây để đặt lại mật khẩu:</p>
        <a href="${resetUrl}" target="_blank">${resetUrl}</a>
        <p>Liên kết này sẽ hết hạn sau 15 phút.</p>
      `
    });

    res.status(200).json({ message: "Email khôi phục mật khẩu đã được gửi!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi gửi email khôi phục mật khẩu." });
  }
};

// 🔹 Bước 2: Đặt lại mật khẩu
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    // Mã hóa token để tìm trong DB
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Tìm user có token hợp lệ và chưa hết hạn
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Token không hợp lệ hoặc đã hết hạn." });
    }

    // Cập nhật mật khẩu mới
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ message: "Đặt lại mật khẩu thành công!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Đặt lại mật khẩu thất bại." });
  }
};