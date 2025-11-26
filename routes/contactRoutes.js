import express from "express";
import {
  getContactInfo,
  updateContactInfo
} from "../Controller/contactInfoController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getContactInfo);
router.put("/", verifyToken, isAdmin, updateContactInfo);

export default router;

