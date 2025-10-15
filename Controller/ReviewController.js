import asyncHandler from "express-async-handler";
import Review from "../Models/ReviewsModel.js";
import Room from "../Models/RoomModel.js";

// 📝 Thêm đánh giá cho phòng
export const createReview = asyncHandler(async (req, res) => {
  const { roomId, rating, comment } = req.body;
  const userId = req.user._id;

  // 1️⃣ Kiểm tra đã đánh giá chưa
  const alreadyReviewed = await Review.exists({ room: roomId, user: userId });
  if (alreadyReviewed) {
    res.status(400);
    throw new Error("Bạn đã đánh giá phòng này rồi.");
  }

  // 2️⃣ Tạo review mới
  const review = await Review.create({
    room: roomId,
    user: userId,
    rating,
    comment
  });

  // 3️⃣ Tính lại điểm trung bình & số lượng đánh giá
  const stats = await Review.aggregate([
    { $match: { room: review.room } },
    {
      $group: {
        _id: "$room",
        avgRating: { $avg: "$rating" },
        numReviews: { $sum: 1 }
      }
    }
  ]);

  if (stats.length) {
    await Room.findByIdAndUpdate(roomId, {
      avgRating: stats[0].avgRating,
      numReviews: stats[0].numReviews
    });
  }

  res.status(201).json({
    message: "Đánh giá thành công",
    review
  });
});

// 📌 Lấy danh sách đánh giá theo room
export const getReviewsByRoom = asyncHandler(async (req, res) => {
  const { roomId } = req.params;

  const reviews = await Review.find({ room: roomId })
    .populate("user", "fullName avatar")
    .sort({ createdAt: -1 });

  res.status(200).json(reviews);
});
