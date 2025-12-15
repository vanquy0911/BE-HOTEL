import asyncHandler from "express-async-handler";
import NearbyPlace from "../Models/NearbyPlaceModel.js";

// GET /api/nearby-places - Lấy địa điểm xung quanh
export const getNearbyPlaces = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const filter = { isActive: true };
  if (category) filter.category = category;
  
  const places = await NearbyPlace.find(filter).sort({ distance: 1 });
  res.json({ data: places });
});

// POST /api/nearby-places - Tạo địa điểm mới (Admin)
export const createNearbyPlace = asyncHandler(async (req, res) => {
  const place = new NearbyPlace(req.body);
  await place.save();
  res.status(201).json(place);
});

// PUT /api/nearby-places/:id - Cập nhật địa điểm (Admin)
export const updateNearbyPlace = asyncHandler(async (req, res) => {
  const place = await NearbyPlace.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );
  if (!place) {
    return res.status(404).json({ message: "Địa điểm không tồn tại" });
  }
  res.json(place);
});

// DELETE /api/nearby-places/:id - Xóa địa điểm (Admin)
export const deleteNearbyPlace = asyncHandler(async (req, res) => {
  const place = await NearbyPlace.findByIdAndDelete(req.params.id);
  if (!place) {
    return res.status(404).json({ message: "Địa điểm không tồn tại" });
  }
  res.json({ message: "Đã xóa địa điểm" });
});




