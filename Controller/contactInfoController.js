import asyncHandler from "express-async-handler";
import ContactInfo from "../Models/ContactInfoModel.js";

// GET /api/contact - Lấy thông tin liên hệ
export const getContactInfo = asyncHandler(async (req, res) => {
  let contactInfo = await ContactInfo.findOne({ isActive: true });
  
  // Nếu chưa có, tạo mặc định
  if (!contactInfo) {
    contactInfo = new ContactInfo({
      hotelName: "Rayal Park Hotel",
      address: "123 Đường ABC, Quận 1, TP.HCM, Việt Nam",
      province: "TP. Hồ Chí Minh",
      city: "TP. Hồ Chí Minh",
      postalCode: "700000",
      coordinates: { lat: 10.7769, lng: 106.7009 },
      phone: {
        main: "0901 234 567",
        international: "+84 901 234 567"
      },
      email: {
        booking: "booking@rayalpark.com",
        info: "info@rayalpark.com"
      },
      socialMedia: {
        website: "www.rayalpark.com",
        facebook: "https://facebook.com/rayalparkhotel",
        instagram: "",
        twitter: "",
        linkedin: ""
      },
      businessHours: {
        open: "08:00",
        close: "22:00"
      }
    });
    await contactInfo.save();
  }
  
  // Map từ backend format sang frontend format
  const responseData = {
    _id: contactInfo._id,
    phone: contactInfo.phone?.main || contactInfo.phone || "",
    email: contactInfo.email?.info || contactInfo.email?.booking || contactInfo.email || "",
    address: contactInfo.address || "",
    socialMedia: {
      facebook: contactInfo.socialMedia?.facebook || "",
      instagram: contactInfo.socialMedia?.instagram || "",
      twitter: contactInfo.socialMedia?.twitter || "",
      linkedin: contactInfo.socialMedia?.linkedin || ""
    },
    businessHours: {
      open: contactInfo.businessHours?.open || "",
      close: contactInfo.businessHours?.close || ""
    },
    createdAt: contactInfo.createdAt,
    updatedAt: contactInfo.updatedAt
  };
  
  res.json({ success: true, data: responseData });
});

// PUT /api/contact - Cập nhật thông tin liên hệ (Admin)
export const updateContactInfo = asyncHandler(async (req, res) => {
  let contactInfo = await ContactInfo.findOne({ isActive: true });
  
  // Map từ frontend format sang backend format
  const updateData = {
    address: req.body.address,
    businessHours: req.body.businessHours,
    socialMedia: {
      ...contactInfo?.socialMedia,
      ...req.body.socialMedia
    }
  };
  
  // Map phone từ string sang object
  if (req.body.phone) {
    updateData.phone = {
      main: req.body.phone,
      international: contactInfo?.phone?.international || `+84 ${req.body.phone.replace(/\s/g, '')}`
    };
  }
  
  // Map email từ string sang object
  if (req.body.email) {
    updateData.email = {
      info: req.body.email,
      booking: contactInfo?.email?.booking || req.body.email
    };
  }
  
  if (!contactInfo) {
    // Tạo mới với dữ liệu mặc định
    contactInfo = new ContactInfo({
      hotelName: "Rayal Park Hotel",
      ...updateData
    });
  } else {
    // Cập nhật dữ liệu hiện có
    Object.assign(contactInfo, updateData);
  }
  
  await contactInfo.save();
  
  // Trả về format frontend expect
  const responseData = {
    _id: contactInfo._id,
    phone: contactInfo.phone?.main || contactInfo.phone || "",
    email: contactInfo.email?.info || contactInfo.email?.booking || contactInfo.email || "",
    address: contactInfo.address || "",
    socialMedia: {
      facebook: contactInfo.socialMedia?.facebook || "",
      instagram: contactInfo.socialMedia?.instagram || "",
      twitter: contactInfo.socialMedia?.twitter || "",
      linkedin: contactInfo.socialMedia?.linkedin || ""
    },
    businessHours: {
      open: contactInfo.businessHours?.open || "",
      close: contactInfo.businessHours?.close || ""
    },
    createdAt: contactInfo.createdAt,
    updatedAt: contactInfo.updatedAt
  };
  
  res.json({ success: true, data: responseData });
});

