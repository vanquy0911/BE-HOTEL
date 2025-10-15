import mongoose from "mongoose";

const locationSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },      
  province: { type: String, required: true },                  
  city: { type: String, required: true },                      
  nearbyPlaces: [{ type: String }] ,                           
  coordinates: {
    lat: { type: Number, required: false }, // Tọa độ dùng cho bản đồ
    lng: { type: Number, required: false }
  },
  tags: String,

}, {
  timestamps: true,
});

const Location = mongoose.model("Location", locationSchema);
export default Location;
