import asyncHandler from "express-async-handler";
import SpecialRequest from "../Models/SpecialRequestModel.js";
import Booking from "../Models/BookingModel.js";

// GET /api/special-requests - Lấy tất cả yêu cầu (Admin) hoặc theo booking
export const getSpecialRequests = asyncHandler(async (req, res) => {
  const { bookingId, status } = req.query;
  const filter = {};
  if (bookingId) filter.booking = bookingId;
  if (status) filter.status = status;
  
  const requests = await SpecialRequest.find(filter)
    .populate('booking', 'checkInDate checkOutDate')
    .populate('handledBy', 'name email')
    .sort({ createdAt: -1 });
  
  res.json(requests);
});

// POST /api/special-requests - Tạo yêu cầu đặc biệt
export const createSpecialRequest = asyncHandler(async (req, res) => {
  const { booking, requestType, description, fee } = req.body;
  
  // Kiểm tra booking có tồn tại không
  const bookingExists = await Booking.findById(booking);
  if (!bookingExists) {
    return res.status(404).json({ message: "Đặt phòng không tồn tại" });
  }
  
  const request = new SpecialRequest({
    booking,
    requestType,
    description,
    fee: fee || 0
  });
  
  await request.save();
  await request.populate('booking', 'checkInDate checkOutDate');
  
  res.status(201).json(request);
});

// PUT /api/special-requests/:id/approve - Duyệt yêu cầu (Admin)
export const approveRequest = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const request = await SpecialRequest.findById(req.params.id);
  
  if (!request) {
    return res.status(404).json({ message: "Yêu cầu không tồn tại" });
  }
  
  request.status = 'approved';
  request.notes = notes;
  request.handledBy = req.user.id;
  request.handledAt = new Date();
  
  await request.save();
  res.json(request);
});

// PUT /api/special-requests/:id/reject - Từ chối yêu cầu (Admin)
export const rejectRequest = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const request = await SpecialRequest.findById(req.params.id);
  
  if (!request) {
    return res.status(404).json({ message: "Yêu cầu không tồn tại" });
  }
  
  request.status = 'rejected';
  request.notes = notes;
  request.handledBy = req.user.id;
  request.handledAt = new Date();
  
  await request.save();
  res.json(request);
});




