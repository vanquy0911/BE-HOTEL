import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true }, // Mã giảm giá
  name: { type: String, required: true }, // Tên chương trình
  description: String,
  discountType: { 
    type: String, 
    enum: ['percentage', 'fixed_amount', 'package'],
    required: true 
  },
  discountValue: { type: Number, required: true }, // % hoặc số tiền
  minBookingAmount: { type: Number, default: 0 }, // Số tiền tối thiểu
  minNights: { type: Number, default: 0 }, // Số đêm tối thiểu
  applicableRoomTypes: [{ type: String }], // ['đơn', 'đôi', 'VIP', 'suite']
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  usageLimit: { type: Number, default: null }, // Giới hạn số lần sử dụng (null = không giới hạn)
  usageCount: { type: Number, default: 0 }, // Số lần đã sử dụng
  maxUsagePerUser: { type: Number, default: 1 }, // Số lần tối đa mỗi user
  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true } // Có hiển thị công khai không
}, { timestamps: true });

promotionSchema.index({ code: 1 });
promotionSchema.index({ startDate: 1, endDate: 1 });
promotionSchema.index({ isActive: 1, isPublic: 1 });

const Promotion = mongoose.model("Promotion", promotionSchema);
export default Promotion;

