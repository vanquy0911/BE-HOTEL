import mongoose from "mongoose";

const contactInfoSchema = new mongoose.Schema({
  hotelName: { type: String, required: true },
  address: { type: String, required: true },
  province: String,
  city: String,
  postalCode: String,
  coordinates: {
    lat: Number,
    lng: Number
  },
  phone: {
    main: { type: String, required: true },
    international: String,
    extensions: [{
      department: String,
      extension: String
    }]
  },
  email: {
    booking: String,
    info: String,
    support: String
  },
  socialMedia: {
    website: String,
    facebook: String,
    instagram: String,
    twitter: String,
    linkedin: String,
    zalo: String
  },
  businessHours: {
    open: String,
    close: String
  },
  directions: {
    fromAirport: {
      tanSonNhat: { distance: String, duration: String, price: Number },
      longThanh: { distance: String, duration: String, price: Number }
    },
    fromTrainStation: { distance: String, duration: String },
    fromBusStation: { distance: String, duration: String }
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const ContactInfo = mongoose.model("ContactInfo", contactInfoSchema);
export default ContactInfo;

