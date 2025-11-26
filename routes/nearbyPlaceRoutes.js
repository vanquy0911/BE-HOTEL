import express from "express";
import {
  getNearbyPlaces,
  createNearbyPlace,
  updateNearbyPlace,
  deleteNearbyPlace
} from "../Controller/nearbyPlaceController.js";
import { verifyToken, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getNearbyPlaces);
router.post("/", verifyToken, isAdmin, createNearbyPlace);
router.put("/:id", verifyToken, isAdmin, updateNearbyPlace);
router.delete("/:id", verifyToken, isAdmin, deleteNearbyPlace);

export default router;

