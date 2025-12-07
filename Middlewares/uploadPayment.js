import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cấu hình nơi lưu trữ và đổi tên file
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "uploads/payments"); // Thư mục lưu ảnh bill chuyển khoản
  },
  filename(req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    cb(null, `receipt-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// Lọc file chỉ cho phép ảnh
const fileFilter = (req, file, cb) => {
  const fileTypes = /jpg|jpeg|png|gif|webp/;
  const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = fileTypes.test(file.mimetype);
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh (jpg, jpeg, png, gif, webp)!"), false);
  }
};

const uploadPaymentReceipt = multer({ 
  storage, 
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

export default uploadPaymentReceipt;

