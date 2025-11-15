import e from "express";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: function() {
      return this.provider === 'local'; // Chỉ required khi đăng ký local
    }
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: function() {
      return this.provider === 'local'; // Chỉ required khi đăng ký local
    }
  },
  password: {
    type: String,
    required: function() {
      return this.provider === 'local'; // Chỉ required khi đăng ký local
    }
  },
  // OAuth fields
  googleId: {
    type: String,
    sparse: true, // Cho phép null nhưng unique nếu có
    unique: true
  },
  facebookId: {
    type: String,
    sparse: true, // Cho phép null nhưng unique nếu có
    unique: true
  },
  provider: {
    type: String,
    enum: ['local', 'google', 'facebook'],
    default: 'local'
  },
  avatar: {
    type: String,
    default: null
  },
  role: {
    type: String,
    default: "user", // user, admin
    enum: ["user", "admin"]
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date
}, {
  timestamps: true
});

const User = mongoose.model("User", userSchema);
export default User