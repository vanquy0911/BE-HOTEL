import express from "express";
import { registerUser, 
  loginUser, 
  updateUser, 
  getAllUsers, 
  getUserById, 
  searchUsers,  
  deleteUser,
  forgotPassword,
  resetPassword,
  changePassword
} from "../Controller/userController.js";
import { verifyToken } from "../Middlewares/authMiddleware.js"; // middleware xác thực
import { isAdmin } from "../Middlewares/authMiddleware.js";     // middleware kiểm tra admin

const router = express.Router();
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.put("/change-password", verifyToken, changePassword);
router.get("/search", verifyToken, isAdmin, searchUsers);
router.get("/", verifyToken, isAdmin, getAllUsers);
router.put("/:id", verifyToken, updateUser);
router.get("/:id", verifyToken, isAdmin, getUserById);
router.delete("/:id", verifyToken, isAdmin, deleteUser);


export default router;
