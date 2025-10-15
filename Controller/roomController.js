import asyncHandler from "express-async-handler";
import Room from "../Models/RoomModel.js";
// import Location from "../Models/LocationModel.js";

// Tạo phòng mới (hỗ trợ upload ảnh) (phía admin)
export const createRoom = async (req, res) => {
  try {
    const { name, roomType, price, locationId, capacity, description } = req.body;

    // Kiểm tra có file ảnh không
    let imagePath = "";
    if (req.file) {
      // Lưu đường dẫn tương đối để frontend truy cập
      imagePath = `/uploads/${req.file.filename}`;
    }

    // Tạo phòng mới
    const newRoom = new Room({
      name,
      roomType,
      price,
      location,
      capacity,
      description,
      image: imagePath, // Trường lưu đường dẫn ảnh
    });

    await newRoom.save();
    res.status(201).json({ message: "Tạo phòng thành công!", room: newRoom });
  } catch (error) {
    res.status(400).json({ message: "Tạo phòng thất bại", error: error.message });
  }
};

// Lấy danh sách tất cả phòng (có thể lọc theo location, loại phòng, và tình trạng trống)
export const getAllRooms = asyncHandler(async (req, res) => {
  const { locationId, roomType, isAvailable } = req.query;

  let filter = {};

  if (locationId) filter.locationId = locationId;
  if (roomType) filter.roomType = roomType;
  if (isAvailable === "true") filter.isAvailable = { $gt: 0 };

  const rooms = await Room.find(filter).populate("locationId", "name province city");
  res.json(rooms);
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