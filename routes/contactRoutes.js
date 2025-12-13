import express from "express";
import {
  getContactInfo,
  updateContactInfo
} from "../Controller/contactInfoController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";
import { getHotelConfig } from "../utils/hotelConfig.js";

const router = express.Router();

router.get("/", getContactInfo);
router.put("/", verifyToken, isAdmin, updateContactInfo);

// Public: trả về hotel config (cache 5 phút trong loader)
router.get("/config/hotel", async (req, res) => {
  try {
    const info = await getHotelConfig();
    return res.json({ data: info });
  } catch (error) {
    console.error("Error fetching hotel config:", error.message);
    return res.status(500).json({ message: "Failed to load hotel config" });
  }
});

export default router;

