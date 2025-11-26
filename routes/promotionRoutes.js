import express from "express";
import {
  getAllPromotions,
  getAllPromotionsAdmin,
  validatePromotionCode,
  createPromotion,
  updatePromotion,
  usePromotion
} from "../Controller/promotionController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getAllPromotions);
router.get("/admin", verifyToken, isAdmin, getAllPromotionsAdmin);
router.get("/validate/:code", validatePromotionCode);
router.post("/", verifyToken, isAdmin, createPromotion);
router.put("/:id", verifyToken, isAdmin, updatePromotion);
router.post("/:id/use", usePromotion);

export default router;

