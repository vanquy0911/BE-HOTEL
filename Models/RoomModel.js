import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  roomNumber: { type: String, required: true, unique: true }, // Số phòng
  bedType: { type: String, enum: ['đơn', 'đôi', 'king', 'queen'], required: true }, // Loại giường
  maxOccupancy: { type: Number, required: true }, // Số người tối đa có thể ở
  roomType: { type: String, enum: ['đơn', 'đôi', 'VIP', 'suite'], required: true },// Loại phòng
  size: { type: Number, required: true }, // Diện tích phòng tính bằng mét vuông
  // floor: { type: Number, required: true }, // Tầng của phòng
  pricePerNight: { type: Number, required: true },// Giá mỗi đêm
  fee: { type: Number, default: 0 }, // Phí dịch vụ, nếu có
  descriptionfee: String, // Mô tả về phí dịch vụ
  isAvailable: { type: Number, default: 1 }, // Trạng thái phòng có sẵn hay không
  image: {type: String, required: true}, // URL hoặc đường dẫn đến hình ảnh phòng
  description: String,
  view: String, // Hướng nhìn của phòng (biển, núi, thành phố...)
  available: { type: Boolean, default: true },
  amenities: [String], // tiện nghi như wifi, tivi...

  location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Location",
      required: true
    },
  
  reviews: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review" // trỏ đến model Review
    }
  ],

  averageRating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 }

}, { timestamps: true });

const Room = mongoose.model("Room", roomSchema);
export default Room;
// Export the Room model