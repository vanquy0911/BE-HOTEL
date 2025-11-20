import e from "express";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },
  // address: {
  //   type: String,
  //   required: true
  // },
  password: {
    type: String,
    required: true
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