import asyncHandler from "express-async-handler";
import Promotion from "../Models/PromotionModel.js";

const normalizeStartOfDayUTC = (dateInput) => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const normalizeEndOfDayUTC = (dateInput) => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(23, 59, 59, 999);
  return date;
};

// GET /api/promotions - Lấy tất cả khuyến mãi (public)
export const getAllPromotions = asyncHandler(async (req, res) => {
  const { roomType } = req.query;
  const now = new Date();
  const todayStartUTC = normalizeStartOfDayUTC(now);
  const todayEndUTC = normalizeEndOfDayUTC(now);
  
  // Base query cho promotions active (theo ngày, bỏ qua giờ để tránh timezone)
  const query = {
    isActive: true,
    isPublic: true,
    startDate: { $lte: todayEndUTC },
    endDate: { $gte: todayStartUTC }
  };
  
  // Nếu có roomType, filter promotions áp dụng cho roomType đó
  // (promotions không có giới hạn roomType hoặc có roomType trong danh sách)
  if (roomType) {
    const cleanRoomType = String(roomType).split(':')[0].trim().toLowerCase();
    query.$or = [
      { applicableRoomTypes: { $exists: false } }, // Không có giới hạn roomType
      { applicableRoomTypes: { $size: 0 } }, // Mảng rỗng = áp dụng cho tất cả
      { applicableRoomTypes: { $regex: new RegExp(cleanRoomType, 'i') } } // Có roomType trong danh sách
    ];
  }
  
  const promotions = await Promotion.find(query).sort({ startDate: -1 });
  
  res.json(promotions);
});

// GET /api/promotions/admin - Lấy tất cả khuyến mãi (Admin - không filter)
export const getAllPromotionsAdmin = asyncHandler(async (req, res) => {
  const promotions = await Promotion.find({}).sort({ createdAt: -1 });
  res.json({ data: promotions });
});

// GET /api/promotions/validate/:code - Validate mã giảm giá
export const validatePromotionCode = asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { bookingAmount, nights, roomType } = req.query;
  
  const promotion = await Promotion.findOne({ 
    code: code.toUpperCase(),
    isActive: true 
  });
  
  if (!promotion) {
    return res.status(404).json({ valid: false, message: "Mã giảm giá không tồn tại" });
  }
  
  const now = new Date();
  // So sánh theo ngày UTC để tránh vấn đề timezone
  const todayUTC = normalizeStartOfDayUTC(now);
  
  // Lấy ngày bắt đầu và kết thúc theo UTC
  const startDateUTC = normalizeStartOfDayUTC(promotion.startDate);
  const endDateUTC = normalizeEndOfDayUTC(promotion.endDate);
  
  // So sánh: promotion còn hiệu lực nếu today >= startDate và today <= endDate
  if (todayUTC < startDateUTC || todayUTC > endDateUTC) {
    console.log("[Promotion][validate] Hết hạn", {
      code: promotion.code,
      todayUTC,
      startDateUTC,
      endDateUTC,
      rawStartDate: promotion.startDate,
      rawEndDate: promotion.endDate
    });
    return res.status(400).json({ valid: false, message: "Mã giảm giá đã hết hạn" });
  }
  
  if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
    return res.status(400).json({ valid: false, message: "Mã giảm giá đã hết lượt sử dụng" });
  }
  
  if (bookingAmount && promotion.minBookingAmount > parseFloat(bookingAmount)) {
    return res.status(400).json({ 
      valid: false, 
      message: `Đơn hàng tối thiểu ${promotion.minBookingAmount.toLocaleString('vi-VN')} VNĐ` 
    });
  }
  
  if (nights && promotion.minNights > parseInt(nights)) {
    return res.status(400).json({ 
      valid: false, 
      message: `Cần đặt tối thiểu ${promotion.minNights} đêm` 
    });
  }
  
  // Kiểm tra roomType nếu có
  if (roomType) {
    // Nếu promotion có giới hạn roomType và roomType không nằm trong danh sách
    if (promotion.applicableRoomTypes && 
        Array.isArray(promotion.applicableRoomTypes) && 
        promotion.applicableRoomTypes.length > 0) {
      // Loại bỏ phần ":1" hoặc bất kỳ suffix nào sau dấu ":" (xử lý trường hợp "standard:1")
      const cleanRoomType = roomType.split(':')[0].trim().toLowerCase();
      const normalizedApplicableTypes = promotion.applicableRoomTypes.map((type) => 
        String(type).toLowerCase().trim()
      );
      
      if (!normalizedApplicableTypes.includes(cleanRoomType)) {
        return res.status(400).json({ 
          valid: false, 
          message: "Mã giảm giá không áp dụng cho loại phòng này" 
        });
      }
    }
  }
  
  // Tính discount
  let discountAmount = 0;
  const bookingAmountNum = parseFloat(bookingAmount) || 0;
  if (promotion.discountType === 'percentage') {
    discountAmount = (bookingAmountNum * promotion.discountValue) / 100;
  } else if (promotion.discountType === 'fixed_amount') {
    discountAmount = promotion.discountValue;
  }
  
  res.json({
    valid: true,
    promotion: {
      id: promotion._id,
      code: promotion.code,
      name: promotion.name,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      discountAmount: discountAmount
    }
  });
});

// POST /api/promotions - Tạo khuyến mãi mới (Admin)
export const createPromotion = asyncHandler(async (req, res) => {
  // Map từ frontend format sang backend format
  const normalizedStart = normalizeStartOfDayUTC(req.body.startDate);
  const normalizedEnd = normalizeEndOfDayUTC(req.body.endDate);

  if (!normalizedStart || !normalizedEnd) {
    return res.status(400).json({ message: "Ngày bắt đầu/kết thúc không hợp lệ" });
  }

  const promotionData = {
    code: req.body.code?.toUpperCase(),
    name: req.body.name,
    description: req.body.description,
    discountType: req.body.discountType === 'fixed' ? 'fixed_amount' : req.body.discountType,
    discountValue: req.body.discountValue,
    minBookingAmount: req.body.minPurchaseAmount || req.body.minBookingAmount || 0,
    minNights: req.body.minNights || 0,
    applicableRoomTypes: req.body.applicableRoomTypes || [],
    startDate: normalizedStart,
    endDate: normalizedEnd,
    usageLimit: req.body.usageLimit || null,
    usageCount: 0,
    maxUsagePerUser: req.body.maxUsagePerUser || 1,
    isActive: req.body.isActive !== false,
    isPublic: req.body.isPublic !== false
  };
  
  const promotion = new Promotion(promotionData);
  await promotion.save();
  res.status(201).json({ data: promotion });
});

// PUT /api/promotions/:id - Cập nhật khuyến mãi (Admin)
export const updatePromotion = asyncHandler(async (req, res) => {
  // Map từ frontend format sang backend format
  const updateData = {};
  if (req.body.code !== undefined) updateData.code = req.body.code.toUpperCase();
  if (req.body.name !== undefined) updateData.name = req.body.name;
  if (req.body.description !== undefined) updateData.description = req.body.description;
  if (req.body.discountType !== undefined) {
    updateData.discountType = req.body.discountType === 'fixed' ? 'fixed_amount' : req.body.discountType;
  }
  if (req.body.discountValue !== undefined) updateData.discountValue = req.body.discountValue;
  if (req.body.minPurchaseAmount !== undefined || req.body.minBookingAmount !== undefined) {
    updateData.minBookingAmount = req.body.minPurchaseAmount || req.body.minBookingAmount || 0;
  }
  if (req.body.minNights !== undefined) updateData.minNights = req.body.minNights;
  if (req.body.applicableRoomTypes !== undefined) updateData.applicableRoomTypes = req.body.applicableRoomTypes;
  if (req.body.startDate !== undefined) {
    const normalizedStart = normalizeStartOfDayUTC(req.body.startDate);
    if (!normalizedStart) {
      return res.status(400).json({ message: "Ngày bắt đầu không hợp lệ" });
    }
    updateData.startDate = normalizedStart;
  }
  if (req.body.endDate !== undefined) {
    const normalizedEnd = normalizeEndOfDayUTC(req.body.endDate);
    if (!normalizedEnd) {
      return res.status(400).json({ message: "Ngày kết thúc không hợp lệ" });
    }
    updateData.endDate = normalizedEnd;
  }
  if (req.body.usageLimit !== undefined) updateData.usageLimit = req.body.usageLimit || null;
  if (req.body.maxUsagePerUser !== undefined) updateData.maxUsagePerUser = req.body.maxUsagePerUser;
  if (req.body.isActive !== undefined) updateData.isActive = req.body.isActive;
  if (req.body.isPublic !== undefined) updateData.isPublic = req.body.isPublic;
  
  const promotion = await Promotion.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  );
  if (!promotion) {
    return res.status(404).json({ message: "Khuyến mãi không tồn tại" });
  }
  res.json({ data: promotion });
});

// POST /api/promotions/:id/use - Sử dụng mã giảm giá
export const usePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    return res.status(404).json({ message: "Khuyến mãi không tồn tại" });
  }
  
  promotion.usageCount += 1;
  await promotion.save();
  
  res.json({ message: "Đã sử dụng mã giảm giá", usageCount: promotion.usageCount });
});

