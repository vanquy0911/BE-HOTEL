import User from "../Models/UserModel.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import crypto from "crypto";
import sendEmail from "../utils/sendemail.js";

// @route   GET /api/users/me
// @desc    Get current user profile
// @access  Private
export const getCurrentUser = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        provider: user.provider,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching user profile"
    });
  }
});

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

  console.log('🔍 Login attempt:', { email, password: password ? '***' : 'empty' });

  const user = await User.findOne({ email });
  if (!user) {
    console.log('❌ User not found:', email);
    res.status(400);
    throw new Error("Tài khoản không tồn tại!");
  }

  console.log('👤 User found:', { email: user.email, role: user.role, passwordHash: user.password.substring(0, 20) + '...' });

  const isMatch = await bcrypt.compare(password, user.password);
  console.log('🔐 Password match:', isMatch);
  
  if (!isMatch) {
    console.log('❌ Password mismatch for:', email);
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
  const { fullName, email, phone } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Người dùng không tồn tại!");
  }

  user.fullName = fullName || user.fullName;
  user.email = email || user.email;
  user.phone = phone || user.phone;

  await user.save();
  res.status(200).json({ message: "Cập nhật thành công!", user });
});

// Hàm đổi mật khẩu
// @route   PUT /api/users/change-password
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user._id; // Lấy từ middleware verifyToken

  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("Người dùng không tồn tại!");
  }

  // Kiểm tra mật khẩu hiện tại
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    res.status(400);
    throw new Error("Mật khẩu hiện tại không đúng!");
  }

  // Cập nhật mật khẩu mới
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  res.status(200).json({ message: "Đổi mật khẩu thành công!" });
});

// Lấy danh sách tất cả người dùng (admin)
// @route   GET /api/users
export const getAllUsers = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Getting all users...');
    const users = await User.find().select("-password");
    console.log('✅ Found users:', users.length);
    res.status(200).json(users);
  } catch (error) {
    console.error('❌ Error getting users:', error);
    res.status(500).json({ message: "Lỗi khi lấy danh sách người dùng." });
  }
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
    console.log('🔍 Forgot password request received:', req.body);
    const { email } = req.body;

    if (!email) {
      console.log('❌ No email provided');
      return res.status(400).json({ message: "Email là bắt buộc." });
    }

    // Kiểm tra người dùng tồn tại
    console.log('🔍 Looking for user with email:', email);
    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(404).json({ message: "Email không tồn tại trong hệ thống." });
    }

    console.log('✅ User found:', user.email, user.fullName);

    // Tạo token reset
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Lưu token và thời gian hết hạn vào user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 phút
    await user.save();
    console.log('✅ Reset token saved to user');

    // Tạo URL reset
    const resetUrl = `http://localhost:5000/api/users/reset-password/${resetToken}`;
    console.log('🔗 Reset URL created:', resetUrl);

    // Kiểm tra cấu hình email
    console.log('🔍 Email config check:');
    console.log('  EMAIL_USER:', process.env.EMAIL_USER ? 'Set' : 'NOT SET');
    console.log('  EMAIL_PASS:', process.env.EMAIL_PASS ? 'Set' : 'NOT SET');

    // Gửi email
    console.log('📧 Attempting to send email...');
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

    console.log('✅ Email sent successfully');
    res.status(200).json({ message: "Email khôi phục mật khẩu đã được gửi!" });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: "Lỗi khi gửi email khôi phục mật khẩu.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
