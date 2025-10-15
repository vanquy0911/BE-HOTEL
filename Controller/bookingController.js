import asyncHandler from "express-async-handler";
import Booking from "../Models/BookingModel.js";
import Room from "../Models/RoomModel.js";

// Hàm tạo đơn đặt phòng mới
// @route   POST /api/bookings
export const createBooking = asyncHandler(async (req, res) => {
  const { userId, roomId, checkInDate, checkOutDate, totalPrice } = req.body;

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  // Kiểm tra xem phòng đã được đặt trong khoảng thời gian này chưa
  const overlappingBooking = await Booking.findOne({
    room: roomId,
    $or: [
      {
        checkInDate: { $lt: checkOut },
        checkOutDate: { $gt: checkIn },
      },
    ],
  });

  if (overlappingBooking) {
    res.status(400);
    throw new Error("Phòng đã được đặt trong khoảng thời gian này.");
  }

  // Tạo booking mới
  const newBooking = await Booking.create({
    user: userId,
    room: roomId,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    totalPrice,
  });

  // Cập nhật số lượng phòng còn lại
  const room = await Room.findById(roomId);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy phòng.");
  }

  room.availableRooms -= 1;
  if (room.availableRooms <= 0) {
    room.isAvailable = false;
  }
  await room.save();

  res.status(201).json({
    message: "Đặt phòng thành công!",
    booking: newBooking,
  });
});

// Hàm lấy tất cả đơn đặt phòng
// @route   GET /api/bookings
export const getAllBookings = asyncHandler(async (req, res) => {
  const bookings = await Booking.find().populate("user room", "-password");
  res.status(200).json(bookings);
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
