import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Tên dịch vụ
  category: { 
    type: String, 
    required: true,
    default: 'other'
  },
  description: String,
  price: { type: Number, default: 0 }, // Giá cơ bản
  priceUnit: { type: String, default: 'VND' }, // Đơn vị: VND, USD, per_hour, per_kg
  pricingOptions: [{
    name: String, // Ví dụ: "Xe 4 chỗ", "Xe 7 chỗ"
    price: Number
  }],
  isFree: { type: Boolean, default: false }, // Miễn phí cho khách lưu trú
  operatingHours: {
    open: String, // "06:00"
    close: String, // "22:00"
    is24Hours: { type: Boolean, default: false }
  },
  requiresBooking: { type: Boolean, default: false }, // Cần đặt trước
  advanceBookingHours: Number, // Số giờ cần đặt trước
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Index để tìm kiếm nhanh
serviceSchema.index({ category: 1 });
serviceSchema.index({ isActive: 1 });

const Service = mongoose.model("Service", serviceSchema);
export default Service;

