import express from "express";

import {
  createRoom,
  getAllRooms,
  getRoomById,
  updateRoom,
  deleteRoom,
  searchRooms
} from "../Controller/roomController.js";
import { isAdmin, verifyToken } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.post("/add", verifyToken, isAdmin, createRoom);            // POST: thêm phòng
router.get("/search", searchRooms);                               // GET: tìm kiếm phòng với date filter (phải đặt trước /:id)
router.get("/:id", getRoomById);            // GET: xem 1 phòng theo ID
router.get("/", getAllRooms);                // GET: lấy danh sách phòng
router.put("/:id", updateRoom);             // PUT: cập nhật phòng theo ID                  
router.delete("/:id", verifyToken, isAdmin, deleteRoom);  // DELETE: xoá phòng theo ID

export default router;