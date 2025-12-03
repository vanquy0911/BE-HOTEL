import asyncHandler from "express-async-handler";
import Room from "../Models/RoomModel.js";
import Location from "../Models/LocationModel.js";
import Booking from "../Models/BookingModel.js";

// Tạo phòng mới (hỗ trợ upload ảnh) (phía admin)
export const createRoom = asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Create room request body:', req.body);
    
    const { 
      name, 
      roomNumber,
      roomType, 
      bedType,
      maxOccupancy,
      size,
      pricePerNight, 
      fee,
      description,
      view,
      available,
      isAvailable,
      amenities,
      image
    } = req.body;

    // Validation
    if (!name || !roomNumber || !roomType || !bedType || !maxOccupancy || !size || !pricePerNight) {
      return res.status(400).json({ 
        message: "Thiếu thông tin bắt buộc",
        required: ["name", "roomNumber", "roomType", "bedType", "maxOccupancy", "size", "pricePerNight"]
      });
    }

    // Kiểm tra số phòng đã tồn tại chưa
    const existingRoom = await Room.findOne({ roomNumber });
    if (existingRoom) {
      return res.status(400).json({ message: "Số phòng đã tồn tại!" });
    }

    // Tạo location mặc định nếu chưa có
    let defaultLocation;
    try {
      defaultLocation = await Location.findOne();
      if (!defaultLocation) {
        // Tạo location mặc định
        defaultLocation = new Location({
          address: "123 Đường ABC, Quận 1",
          province: "TP. Hồ Chí Minh", 
          city: "TP. Hồ Chí Minh",
          nearbyPlaces: ["Trung tâm thành phố", "Sân bay"],
          coordinates: { lat: 10.8231, lng: 106.6297 }
        });
        await defaultLocation.save();
        console.log('✅ Created default location:', defaultLocation._id);
      }
    } catch (locationError) {
      console.error('❌ Location error:', locationError);
      return res.status(500).json({ message: "Lỗi tạo location mặc định" });
    }

    // Tạo phòng mới
    const newRoom = new Room({
      name,
      roomNumber,
      roomType,
      bedType,
      maxOccupancy,
      size,
      pricePerNight,
      fee: fee || 0,
      description: description || '',
      view: view || '',
      available: available !== undefined ? available : true,
      isAvailable: isAvailable || 1,
      amenities: amenities || [],
      image: image || 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=500&h=300&fit=crop',
      location: defaultLocation._id
    });

    await newRoom.save();
    console.log('✅ Room created successfully:', newRoom._id);
    
    res.status(201).json({ 
      success: true,
      message: "Tạo phòng thành công!", 
      room: newRoom 
    });
  } catch (error) {
    console.error('❌ Create room error:', error);
    res.status(400).json({ 
      success: false,
      message: "Tạo phòng thất bại", 
      error: error.message 
    });
  }
});

// Lấy danh sách tất cả phòng (có thể lọc theo location, loại phòng, và tình trạng trống)
export const getAllRooms = asyncHandler(async (req, res) => {
  try {
    const { locationId, roomType, isAvailable } = req.query;

    let filter = {};

    if (locationId) filter.locationId = locationId;
    if (roomType) filter.roomType = roomType;
    if (isAvailable === "true") filter.isAvailable = { $gt: 0 };

    const rooms = await Room.find(filter).populate("location", "address province city");
    
    res.json({
      success: true,
      data: rooms,
      count: rooms.length
    });
  } catch (error) {
    console.error("Error in getAllRooms:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy danh sách phòng",
      error: error.message
    });
  }
});

// Lấy chi tiết phòng theo ID
export const getRoomById = asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy phòng!");
  }
  res.json(room);
});

// Cập nhật thông tin phòng
export const updateRoom = asyncHandler(async (req, res) => {
  const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy phòng!");
  }
  res.json({ message: "Cập nhật thành công", room });
});

// Xóa phòng
export const deleteRoom = asyncHandler(async (req, res) => {
  const room = await Room.findByIdAndDelete(req.params.id);
  if (!room) {
    res.status(404);
    throw new Error("Không tìm thấy phòng!");
  }
  res.json({ message: "Xóa phòng thành công!" });
});

// ✅ Tìm kiếm phòng với filter theo ngày (check availability)
// @route   GET /api/rooms/search
export const searchRooms = asyncHandler(async (req, res) => {
  try {
    const { 
      checkInDate, 
      checkOutDate, 
      maxOccupancy, 
      roomType, 
      view,
      minPrice,
      maxPrice
    } = req.query;

    // Validate dates nếu có
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

    // Build filter
    let filter = {
      available: true,
      isAvailable: { $gt: 0 }
    };

    // Filter theo số người
    if (maxOccupancy) {
      const maxOccupancyNum = parseInt(maxOccupancy);
      const maxOccupancyLimit = maxOccupancyNum + 2;
      filter.maxOccupancy = { 
        $gte: maxOccupancyNum,
        $lte: maxOccupancyLimit
      };
    }

    // Filter theo loại phòng
    if (roomType) {
      filter.roomType = roomType;
    }

    // Filter theo view
    if (view) {
      filter.view = { $regex: view, $options: "i" };
    }

    // Filter theo giá
    if (minPrice || maxPrice) {
      filter.pricePerNight = {};
      if (minPrice) filter.pricePerNight.$gte = parseFloat(minPrice);
      if (maxPrice) filter.pricePerNight.$lte = parseFloat(maxPrice);
    }

    // Lấy tất cả phòng phù hợp
    let rooms = await Room.find(filter)
      .populate("location", "address province city")
      .lean();

    // Ưu tiên phòng có maxOccupancy chính xác với yêu cầu
    if (maxOccupancy) {
      const maxOccupancyNum = parseInt(maxOccupancy);
      const exactMatchRooms = rooms.filter(r => r.maxOccupancy === maxOccupancyNum);
      const largerRooms = rooms.filter(r => r.maxOccupancy > maxOccupancyNum);
      largerRooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
      rooms = [...exactMatchRooms, ...largerRooms];
    } else {
      rooms.sort((a, b) => a.maxOccupancy - b.maxOccupancy);
    }

    // ✅ Check availability nếu có dates
    if (checkInDate && checkOutDate) {
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      checkIn.setHours(0, 0, 0, 0);
      checkOut.setHours(0, 0, 0, 0);

      const availableRooms = [];
      
      for (const room of rooms) {
        // Kiểm tra booking overlap
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

        if (!overlappingBooking) {
          availableRooms.push(room);
        }
      }

      rooms = availableRooms;
    }

    res.json({
      success: true,
      data: rooms,
      count: rooms.length,
      filters: {
        checkInDate: checkInDate || null,
        checkOutDate: checkOutDate || null,
        maxOccupancy: maxOccupancy || null,
        roomType: roomType || null,
        view: view || null
      }
    });
  } catch (error) {
    console.error("Error in searchRooms:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi tìm kiếm phòng",
      error: error.message
    });
  }
}); 