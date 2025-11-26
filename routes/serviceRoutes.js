import express from "express";
import {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  deleteService
} from "../Controller/serviceController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getAllServices);
router.get("/:id", getServiceById);
router.post("/", verifyToken, isAdmin, createService);
router.put("/:id", verifyToken, isAdmin, updateService);
router.delete("/:id", verifyToken, isAdmin, deleteService);

export default router;

