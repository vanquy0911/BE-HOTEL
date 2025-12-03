import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Booking from "../Models/BookingModel.js";
import Room from "../Models/RoomModel.js";
import Promotion from "../Models/PromotionModel.js";
import User from "../Models/UserModel.js";
import googleCalendarService from "../services/googleCalendarService.js";
import googleSheetsService from "../services/googleSheetsService.js";

// Hàm tạo đơn đặt phòng mới
// @route   POST /api/bookings
export const createBooking = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Create booking request body:', req.body);
    
    const { userId, roomId, checkInDate, checkOutDate, totalPrice, note, promotionId, discountAmount } = req.body;

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

    // ✅ SỬ DỤNG TRANSACTION để tránh race condition
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Kiểm tra xem phòng đã được đặt trong khoảng thời gian này chưa (với lock)
      const overlappingBooking = await Booking.findOne({
        room: room._id,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
          {
            checkInDate: { $lt: checkOut },
            checkOutDate: { $gt: checkIn },
          },
        ],
      }).session(session); // Sử dụng session để lock

      if (overlappingBooking) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Phòng đã được đặt trong khoảng thời gian này"
        });
      }

      // Validate promotion if provided
      let promotion = null;
      if (promotionId) {
        promotion = await Promotion.findById(promotionId).session(session);
        if (!promotion) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Mã khuyến mãi không tồn tại"
          });
        }
        
        // Check if promotion is still valid (so sánh theo ngày UTC để tránh vấn đề timezone)
        const now = new Date();
        const todayUTC = new Date(Date.UTC(
          now.getUTCFullYear(), 
          now.getUTCMonth(), 
          now.getUTCDate()
        ));
        
        const promotionStartDate = new Date(promotion.startDate);
        const startDateUTC = new Date(Date.UTC(
          promotionStartDate.getUTCFullYear(),
          promotionStartDate.getUTCMonth(),
          promotionStartDate.getUTCDate()
        ));
        
        const promotionEndDate = new Date(promotion.endDate);
        const endDateUTC = new Date(Date.UTC(
          promotionEndDate.getUTCFullYear(),
          promotionEndDate.getUTCMonth(),
          promotionEndDate.getUTCDate()
        ));
        
        if (!promotion.isActive || todayUTC < startDateUTC || todayUTC > endDateUTC) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Mã khuyến mãi không còn hiệu lực"
          });
        }
        
        if (promotion.usageLimit && promotion.usageCount >= promotion.usageLimit) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Mã khuyến mãi đã hết lượt sử dụng"
          });
        }
      }

      // Tạo booking mới (trong transaction)
      const newBooking = await Booking.create([{
        user: userId,
        room: room._id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        totalPrice,
        note: note || '',
        status: 'pending',
        promotion: promotionId || null,
        discountAmount: discountAmount || 0
      }], { session });

      const booking = newBooking[0];

      // Tăng usageCount của promotion nếu có (trong transaction)
      if (promotionId && promotion) {
        await Promotion.findByIdAndUpdate(
          promotionId,
          { $inc: { usageCount: 1 } },
          { session }
        );
        console.log('✅ Promotion usage count updated:', promotionId);
      }

      // Commit transaction
      await session.commitTransaction();
      console.log('✅ Booking created with transaction:', booking._id);

      // Tiếp tục với Google Sheets (ngoài transaction)
      const finalBooking = booking;

      // ✅ BƯỚC 2: Thêm vào Google Calendar (chỉ khi status = 'confirmed')
      // Note: Calendar event sẽ được tạo khi booking được confirm, không phải khi tạo
      // Nếu muốn tạo ngay khi pending, có thể uncomment phần này:
      /*
      if (finalBooking.status === 'confirmed') {
        try {
          const user = await User.findById(userId);
          const calendarEvent = await googleCalendarService.createBookingEvent({
            roomName: room.name,
            customerName: user?.fullName || 'Khách vãng lai',
            checkIn: checkIn,
            checkOut: checkOut,
            bookingId: finalBooking._id.toString(),
            roomNumber: room.roomNumber,
            totalPrice: totalPrice,
            guests: finalBooking.roomQuantity || 1
          });
          
          if (calendarEvent) {
            // Lưu eventId vào booking để có thể xóa sau này
            finalBooking.calendarEventId = calendarEvent.id;
            await finalBooking.save();
          }
        } catch (error) {
          console.error('❌ Google Calendar error (non-blocking):', error.message);
        }
      }
      */

      // ✅ BƯỚC 3: Thêm vào Google Sheets
      try {
        const user = await User.findById(userId);
        const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
        
        await googleSheetsService.addBookingRow({
          bookingId: finalBooking._id.toString(),
          customerName: user?.fullName || 'Khách vãng lai',
          email: user?.email || '',
          phone: user?.phone || '',
          roomName: room.name,
          roomNumber: room.roomNumber,
          checkIn: checkIn,
          checkOut: checkOut,
          nights: nights,
          guests: finalBooking.roomQuantity || 1,
          totalPrice: totalPrice,
          status: finalBooking.status,
          note: note || ''
        });
      } catch (error) {
        console.error('❌ Google Sheets error (non-blocking):', error.message);
      }

      res.status(201).json({
        success: true,
        message: "Đặt phòng thành công!",
        booking: finalBooking
      });
    } catch (error) {
      // Rollback transaction nếu có lỗi
      await session.abortTransaction();
      console.error('❌ Error in booking transaction:', error);
      throw error;
    } finally {
      // Đóng session
      session.endSession();
    }

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
  try {
    const booking = await Booking.findById(req.params.id).populate("user room", "-password");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt phòng"
      });
    }

    // Check if user has permission to view this booking
    const userId = req.user?.id || req.user?._id;
    const bookingUserId = booking.user?._id?.toString() || booking.user?.toString();
    
    if (req.user?.role !== 'admin' && bookingUserId !== userId?.toString()) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xem đơn đặt phòng này"
      });
    }

    res.status(200).json({
      success: true,
      booking: booking
    });
  } catch (error) {
    console.error('❌ Error getting booking by ID:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy thông tin đặt phòng",
      error: error.message
    });
  }
});

// Hàm lấy đơn đặt phòng của user hiện tại
// @route   GET /api/bookings/my-bookings
export const getMyBookings = asyncHandler(async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Người dùng chưa đăng nhập"
      });
    }

    const bookings = await Booking.find({ user: userId })
      .populate("user", "fullName email phone")
      .populate("room", "name roomNumber roomType pricePerNight image")
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: bookings,
      count: bookings.length
    });
  } catch (error) {
    console.error('❌ Error getting user bookings:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách đặt phòng",
      error: error.message
    });
  }
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

  // ✅ Xóa Google Calendar event nếu có
  if (booking.calendarEventId) {
    try {
      await googleCalendarService.deleteBookingEvent(booking.calendarEventId);
    } catch (error) {
      console.error('❌ Google Calendar delete error (non-blocking):', error.message);
    }
  }

  // ✅ Cập nhật status trong Google Sheets thành 'cancelled' trước khi xóa
  try {
    const user = await User.findById(booking.user);
    const nights = Math.ceil(
      (new Date(booking.checkOutDate).getTime() - new Date(booking.checkInDate).getTime()) / 
      (1000 * 60 * 60 * 24)
    );
    
    await googleSheetsService.updateBookingRow(bookingId, {
      bookingId: bookingId,
      customerName: user?.fullName || 'Khách vãng lai',
      email: user?.email || '',
      phone: user?.phone || '',
      roomName: room.name,
      roomNumber: room.roomNumber || '',
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      nights: nights,
      guests: booking.roomQuantity || 1,
      totalPrice: booking.totalPrice,
      status: 'cancelled',
      note: booking.note || '',
      createdAt: booking.createdAt
    });
  } catch (error) {
    console.error('❌ Google Sheets update error (non-blocking):', error.message);
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


// Hàm cập nhật đơn đặt phòng
// @route   PUT /api/bookings/:id
export const updateBooking = asyncHandler(async (req, res) => {
  try {
    const bookingId = req.params.id;
    const userId = req.user?.id || req.user?._id;
    
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn đặt phòng"
      });
    }

    // Check if user has permission to update this booking
    const bookingUserId = booking.user?.toString();
    if (req.user?.role !== 'admin' && bookingUserId !== userId?.toString()) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền chỉnh sửa đơn đặt phòng này"
      });
    }

    // Only allow updating certain fields
    const { 
      checkInDate, 
      checkOutDate, 
      guestsPerRoom, 
      roomQuantity, 
      note, 
      promotionId, 
      discountAmount, 
      totalPrice,
      // Customer information fields
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      country
    } = req.body;

    // Validate dates if provided
    if (checkInDate && checkOutDate) {
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      
      if (checkIn >= checkOut) {
        return res.status(400).json({
          success: false,
          message: "Ngày check-out phải sau ngày check-in"
        });
      }
    }

    // Update booking fields
    if (checkInDate) booking.checkInDate = new Date(checkInDate);
    if (checkOutDate) booking.checkOutDate = new Date(checkOutDate);
    if (roomQuantity !== undefined) booking.roomQuantity = roomQuantity;
    if (note !== undefined) booking.note = note;
    if (promotionId !== undefined) booking.promotion = promotionId;
    if (discountAmount !== undefined) booking.discountAmount = discountAmount;
    if (totalPrice !== undefined) booking.totalPrice = totalPrice;

    // Update user information if provided
    if (firstName || lastName || email || phone) {
      const user = await User.findById(booking.user);
      if (user) {
        if (firstName || lastName) {
          // Update fullName
          const newFirstName = firstName || user.fullName?.split(' ').slice(0, -1).join(' ') || '';
          const newLastName = lastName || user.fullName?.split(' ').slice(-1)[0] || '';
          user.fullName = `${newFirstName} ${newLastName}`.trim();
        }
        if (email) user.email = email;
        if (phone) user.phone = phone;
        
        await user.save();
        console.log('✅ User information updated:', user._id);
      }
    }

    // Recalculate totalPrice if dates or roomQuantity changed
    if (checkInDate || checkOutDate || roomQuantity !== undefined) {
      const nights = Math.ceil(
        (new Date(booking.checkOutDate).getTime() - new Date(booking.checkInDate).getTime()) / 
        (1000 * 60 * 60 * 24)
      );
      
      // Get room price
      const room = await Room.findById(booking.room);
      if (room) {
        const basePrice = room.pricePerNight || 1500000;
        const subtotal = basePrice * nights * (booking.roomQuantity || 1);
        const tax = subtotal * 0.1;
        booking.totalPrice = Math.max(0, subtotal + tax - (booking.discountAmount || 0));
      }
    }

    await booking.save();

    // Populate before returning
    await booking.populate("user room", "-password");

    // ✅ Cập nhật Google Calendar event nếu có
    if (booking.calendarEventId && (checkInDate || checkOutDate)) {
      try {
        const user = await User.findById(booking.user);
        await googleCalendarService.updateBookingEvent(booking.calendarEventId, {
          roomName: booking.room?.name || 'N/A',
          customerName: user?.fullName || 'Khách vãng lai',
          checkIn: booking.checkInDate,
          checkOut: booking.checkOutDate,
          bookingId: booking._id.toString(),
          roomNumber: booking.room?.roomNumber || '',
          totalPrice: booking.totalPrice,
          guests: booking.roomQuantity || 1
        });
      } catch (error) {
        console.error('❌ Google Calendar update error (non-blocking):', error.message);
      }
    }

    // ✅ Cập nhật Google Sheets
    try {
      const user = await User.findById(booking.user);
      const nights = Math.ceil(
        (new Date(booking.checkOutDate).getTime() - new Date(booking.checkInDate).getTime()) / 
        (1000 * 60 * 60 * 24)
      );
      
      await googleSheetsService.updateBookingRow(booking._id.toString(), {
        bookingId: booking._id.toString(),
        customerName: user?.fullName || 'Khách vãng lai',
        email: user?.email || '',
        phone: user?.phone || '',
        roomName: booking.room?.name || '',
        roomNumber: booking.room?.roomNumber || '',
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
        nights: nights,
        guests: booking.roomQuantity || 1,
        totalPrice: booking.totalPrice,
        status: booking.status,
        note: booking.note || '',
        createdAt: booking.createdAt
      });
    } catch (error) {
      console.error('❌ Google Sheets update error (non-blocking):', error.message);
    }

    res.status(200).json({
      success: true,
      message: "Cập nhật đơn đặt phòng thành công",
      booking: booking
    });
  } catch (error) {
    console.error('❌ Error updating booking:', error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật đơn đặt phòng",
      error: error.message
    });
  }
});

// Hàm xác nhận đơn đặt phòng (admin)
// @route   PUT /api/bookings/confirm/:id
export const confirmBooking = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    res.status(403);
    throw new Error("Chỉ admin được xác nhận đơn đặt phòng.");
  }

  const booking = await Booking.findById(req.params.id)
    .populate("user", "fullName email phone")
    .populate("room", "name roomNumber");
  
  if (!booking) {
    res.status(404);
    throw new Error("Không tìm thấy đơn đặt phòng.");
  }

  booking.status = "confirmed";
  await booking.save();

  // Cập nhật trạng thái phòng
  await Room.findByIdAndUpdate(booking.room, { isAvailable: false });

  // ✅ BƯỚC 2: Thêm vào Google Calendar khi booking được confirm
  try {
    const calendarEvent = await googleCalendarService.createBookingEvent({
      roomName: booking.room?.name || 'N/A',
      customerName: booking.user?.fullName || 'Khách vãng lai',
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      bookingId: booking._id.toString(),
      roomNumber: booking.room?.roomNumber || '',
      totalPrice: booking.totalPrice,
      guests: booking.roomQuantity || 1
    });
    
    if (calendarEvent) {
      // Lưu eventId vào booking để có thể xóa sau này
      booking.calendarEventId = calendarEvent.id;
      await booking.save();
      console.log('✅ Calendar event created and saved to booking');
    }
  } catch (error) {
    console.error('❌ Google Calendar error (non-blocking):', error.message);
  }

  // ✅ Cập nhật status trong Google Sheets
  try {
    const user = booking.user;
    const room = booking.room;
    const nights = Math.ceil(
      (new Date(booking.checkOutDate).getTime() - new Date(booking.checkInDate).getTime()) / 
      (1000 * 60 * 60 * 24)
    );
    
    await googleSheetsService.updateBookingRow(booking._id.toString(), {
      bookingId: booking._id.toString(),
      customerName: user?.fullName || 'Khách vãng lai',
      email: user?.email || '',
      phone: user?.phone || '',
      roomName: room?.name || '',
      roomNumber: room?.roomNumber || '',
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      nights: nights,
      guests: booking.roomQuantity || 1,
      totalPrice: booking.totalPrice,
      status: 'confirmed',
      note: booking.note || '',
      createdAt: booking.createdAt
    });
  } catch (error) {
    console.error('❌ Google Sheets update error (non-blocking):', error.message);
  }

  res.json({ message: "Đã xác nhận đơn đặt phòng", booking });
});
