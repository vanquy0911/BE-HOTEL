import User from "../Models/UserModel.js";
import jwt from "jsonwebtoken";

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn: "30d",
  });
};

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
// @access  Public
export const googleCallback = async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`);
    }

    const { id, displayName, emails, photos } = req.user;
    const email = emails && emails[0] ? emails[0].value : null;
    const avatar = photos && photos[0] ? photos[0].value : null;

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_email`);
    }

    // Tìm user theo googleId hoặc email
    let user = await User.findOne({
      $or: [
        { googleId: id },
        { email: email }
      ]
    });

    if (user) {
      // User đã tồn tại - cập nhật thông tin nếu cần
      if (!user.googleId) {
        user.googleId = id;
        user.provider = 'google';
      }
      if (avatar && !user.avatar) {
        user.avatar = avatar;
      }
      if (!user.fullName && displayName) {
        user.fullName = displayName;
      }
      await user.save();
    } else {
      // Tạo user mới
      user = await User.create({
        fullName: displayName || email.split('@')[0],
        email: email,
        googleId: id,
        provider: 'google',
        avatar: avatar,
        phone: '', // OAuth user không có phone, có thể để trống hoặc yêu cầu sau
        password: '', // OAuth user không có password
        role: 'user'
      });
    }

    // Tạo JWT token
    const token = generateToken(user._id);

    // Redirect về frontend với token
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?token=${token}&success=true`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_error`);
  }
};

// @route   GET /api/auth/facebook
// @desc    Initiate Facebook OAuth login
// @access  Public
// Note: This is handled by passport middleware in routes

// @route   GET /api/auth/facebook/callback
// @desc    Facebook OAuth callback
// @access  Public
export const facebookCallback = async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`);
    }

    const { id, displayName, emails, photos } = req.user;
    const email = emails && emails[0] ? emails[0].value : null;
    const avatar = photos && photos[0] ? photos[0].value : null;

    if (!email) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_email`);
    }

    // Tìm user theo facebookId hoặc email
    let user = await User.findOne({
      $or: [
        { facebookId: id },
        { email: email }
      ]
    });

    if (user) {
      // User đã tồn tại - cập nhật thông tin nếu cần
      if (!user.facebookId) {
        user.facebookId = id;
        user.provider = 'facebook';
      }
      if (avatar && !user.avatar) {
        user.avatar = avatar;
      }
      if (!user.fullName && displayName) {
        user.fullName = displayName;
      }
      await user.save();
    } else {
      // Tạo user mới
      user = await User.create({
        fullName: displayName || email.split('@')[0],
        email: email,
        facebookId: id,
        provider: 'facebook',
        avatar: avatar,
        phone: '', // OAuth user không có phone
        password: '', // OAuth user không có password
        role: 'user'
      });
    }

    // Tạo JWT token
    const token = generateToken(user._id);

    // Redirect về frontend với token
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?token=${token}&success=true`);
  } catch (error) {
    console.error('Facebook OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_error`);
  }
};

