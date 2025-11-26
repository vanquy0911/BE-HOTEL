import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Người dùng là bắt buộc"],
    },
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: [true, "Phòng là bắt buộc"],
    },
    roomQuantity: {
      type: Number,
      default: 0,
      // min: [1, "Phải đặt ít nhất 1 phòng"]
    },
    checkInDate: {
      type: Date,
      required: [true, "Ngày nhận phòng là bắt buộc"],
    },
    checkOutDate: {
      type: Date,
      required: [true, "Ngày trả phòng là bắt buộc"],
    },
    totalPrice: {
      type: Number,
      required: [true, "Tổng giá là bắt buộc"],
    },
    promotion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Promotion"
    },
    discountAmount: { 
      type: Number, 
      default: 0 
    }, // Số tiền được giảm
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending",
    },
    note: {
      type: String,
      default: "",
    },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;