import mongoose from "mongoose";

const nearbyPlaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: {
    type: String,
    enum: ['attraction', 'restaurant', 'shopping', 'hospital', 'bank', 'atm', 'post_office', 'other'],
    required: true
  },
  description: String,
  address: String,
  distance: { type: String, required: true }, // "500m", "1.2km"
  walkingTime: String, // "5 phút đi bộ"
  drivingTime: String, // "10 phút xe"
  coordinates: {
    lat: Number,
    lng: Number
  },
  phone: String,
  website: String,
  rating: Number, // 1-5
  image: String,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

nearbyPlaceSchema.index({ category: 1 });
nearbyPlaceSchema.index({ isActive: 1 });

const NearbyPlace = mongoose.model("NearbyPlace", nearbyPlaceSchema);
export default NearbyPlace;

