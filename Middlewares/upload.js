import multer from "multer";
import path from "path";

// Cấu hình nơi lưu trữ và đổi tên file
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "uploads/rooms"); // Thư mục lưu ảnh
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// Lọc file chỉ cho phép ảnh
const fileFilter = (req, file, cb) => {
  const fileTypes = /jpg|jpeg|png/;
  const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = fileTypes.test(file.mimetype);
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb("Chỉ chấp nhận file ảnh (jpg, jpeg, png)!");
  }
};

const upload = multer({ storage, fileFilter });

export default upload;
