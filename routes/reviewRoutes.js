import express from "express";
import { createReview, getReviewsByRoom } from "../Controllers/RviewController.js";
import { protect, verifyToken } from "../Middlewares/authMiddleware.js";

const router = express.Router();

// POST /api/reviews - thêm đánh giá
router.post("/", verifyToken, createReview);

// GET /api/reviews/:roomId - lấy đánh giá theo phòng
router.get("/:roomId", getReviewsByRoom);

export default router;
