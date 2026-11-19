import express from "express";

import {
    renderFacePage,
    getFaceEmployees,
    getFaceEmployeeDetail,
    registerFaceProfile,
    updateFaceProfile,
    removeFaceProfile
} from "../controllers/FaceController.js";

const router = express.Router();

// Dữ liệu khuôn mặt không nên bị lưu cache ở trình duyệt/proxy.
router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// Hiển thị giao diện
router.get("/", renderFacePage);

// API lấy dữ liệu nhân viên
router.get("/data", getFaceEmployees);

// API đăng ký khuôn mặt
router.post("/:employeeId/register", registerFaceProfile);

// API cập nhật khuôn mặt
router.put("/:employeeId", updateFaceProfile);

// API lấy chi tiết nhân viên
router.get("/:employeeId", getFaceEmployeeDetail);

// API xóa hồ sơ khuôn mặt
router.delete("/:employeeId", removeFaceProfile);

export default router;