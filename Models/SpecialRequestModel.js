import mongoose from "mongoose";

const specialRequestSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true
  },
  requestType: {
    type: String,
    enum: ['early_checkin', 'late_checkout', 'extra_bed', 'crib', 'wheelchair', 'connecting_rooms', 'high_floor', 'low_floor', 'non_smoking', 'halal_food', 'vegetarian', 'decoration', 'other'],
    required: true
  },
  description: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'fulfilled'],
    default: 'pending'
  },
  fee: { type: Number, default: 0 }, // Phí (nếu có)
  notes: String, // Ghi chú từ nhân viên
  handledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  handledAt: Date
}, { timestamps: true });

specialRequestSchema.index({ booking: 1 });
specialRequestSchema.index({ status: 1 });

const SpecialRequest = mongoose.model("SpecialRequest", specialRequestSchema);
export default SpecialRequest;




