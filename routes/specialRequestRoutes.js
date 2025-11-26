import express from "express";
import {
  getSpecialRequests,
  createSpecialRequest,
  approveRequest,
  rejectRequest
} from "../Controller/specialRequestController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", verifyToken, getSpecialRequests);
router.post("/", verifyToken, createSpecialRequest);
router.put("/:id/approve", verifyToken, isAdmin, approveRequest);
router.put("/:id/reject", verifyToken, isAdmin, rejectRequest);

export default router;

