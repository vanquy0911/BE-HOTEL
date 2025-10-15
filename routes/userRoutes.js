import express from "express";
import { registerUser, 
  loginUser, 
  updateUser, 
  getAllUsers, 
  getUserById, 
  searchUsers,  
  deleteUser,
  forgotPassword,
  resetPassword
} from "../Controller/userController.js";
import { verifyToken } from "../Middlewares/authMiddleware.js"; // middleware xác thực
import { isAdmin } from "../Middlewares/authMiddleware.js";     // middleware kiểm tra admin

const router = express.Router();
router.post("/register", registerUser);
router.post("/login", loginUser);
router.put("/:id", verifyToken, updateUser);
router.get("/search", verifyToken, isAdmin, searchUsers);
router.get("/", verifyToken, isAdmin, getAllUsers);
router.get("/:id", verifyToken,isAdmin, getUserById);
router.delete("/:id", verifyToken, isAdmin, deleteUser);
router.get('/', getAllUsers);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);


export default router;
