import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Booking from "../Models/BookingModel.js";
import Room from "../Models/RoomModel.js";

// Hàm tạo đơn đặt phòng mới
// @route   POST /api/bookings
export const createBooking = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Create booking request body:', req.body);
    
    const { userId, roomId, checkInDate, checkOutDate, totalPrice, note } = req.body;

    // Validation
    if (!userId || !checkInDate || !checkOutDate || !totalPrice) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc",
        required: ["userId", "checkInDate", "checkOutDate", "totalPrice"]
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    // Validate dates
    if (checkIn >= checkOut) {
      return res.status(400).json({
        success: false,
        message: "Ngày check-out phải sau ngày check-in"
      });
    }

    // Get room - if roomId is "first-available", get first available room
    let room;
    if (roomId === 'first-available') {
      room = await Room.findOne({ available: true });
      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Không có phòng trống"
        });
      }
    } else {
      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        return res.status(400).json({
          success: false,
          message: "Room ID không hợp lệ. Vui lòng chọn phòng từ danh sách."
        });
      }
      room = await Room.findById(roomId);
      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy phòng"
        });
      }
    }

    console.log('🏨 Selected room:', room.name, room._id);

    // Kiểm tra xem phòng đã được đặt trong khoảng thời gian này chưa
    const overlappingBooking = await Booking.findOne({
      room: room._id,
      status: { $in: ['pending', 'confirmed'] },
      $or: [
        {
          checkInDate: { $lt: checkOut },
          checkOutDate: { $gt: checkIn },
        },
      ],
    });

    if (overlappingBooking) {
      return res.status(400).json({
        success: false,
        message: "Phòng đã được đặt trong khoảng thời gian này"
      });
    }

    // Tạo booking mới
    const newBooking = await Booking.create({
      user: userId,
      room: room._id,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      totalPrice,
      note: note || '',
      status: 'pending'
    });

    console.log('✅ Booking created:', newBooking._id);

    res.status(201).json({
      success: true,
      message: "Đặt phòng thành công!",
      booking: newBooking
    });

  } catch (error) {
    console.error('❌ Create booking error:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tạo booking",
      error: error.message
    });
  }
});

// Hàm lấy tất cả đơn đặt phòng
// @route   GET /api/bookings
export const getAllBookings = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Getting all bookings...');
    const bookings = await Booking.find()
      .populate("user", "fullName email phone")
      .populate("room", "name roomNumber roomType pricePerNight image")
      .sort({ createdAt: -1 });
    
    console.log('✅ Found bookings:', bookings.length);
    res.status(200).json({
      success: true,
      data: bookings,
      count: bookings.length
    });
  } catch (error) {
    console.error('❌ Error getting bookings:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách đặt phòng",
      error: error.message
    });
  }
});

// Hàm lấy đơn đặt phòng theo ID
// @route   GET /api/bookings/:id
export const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate("user room", "-password");

  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy đơn đặt phòng");
  }

  res.status(200).json(booking);
});


// Hàm huỷ đặt phòng
// @route   DELETE /api/bookings/:id
export const cancelBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.id;

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy đặt phòng.");
  }

  const room = await Room.findById(booking.room);
  if (!room) {
    res.status(404);
    throw new Error("Phòng không tồn tại.");
  }

  // Tăng lại số lượng phòng
  room.availableRooms += 1;
  room.isAvailable = true;
  await room.save();

  // Xoá đơn đặt
  await Booking.findByIdAndDelete(bookingId);

  res.status(200).json({
    message: "Đã huỷ đặt phòng thành công.",
    roomUpdated: room.name,
    currentAvailableRooms: room.availableRooms,
  });
});


// Hàm xác nhận đơn đặt phòng (admin)
// @route   PUT /api/bookings/confirm/:id
export const confirmBooking = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    res.status(403);
    throw new Error("Chỉ admin được xác nhận đơn đặt phòng.");
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy đơn đặt phòng.");
  }

  booking.status = "confirmed";
  await booking.save();

  // Cập nhật trạng thái phòng
  await Room.findByIdAndUpdate(booking.room, { isAvailable: false });

  res.json({ message: "Đã xác nhận đơn đặt phòng", booking });
});
