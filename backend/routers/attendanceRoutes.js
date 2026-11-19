import express from "express";

import {
    renderAttendancePage,
    getAttendanceData,
    faceAttendance,
    manualAttendance
} from "../controllers/attendanceController.js";
import * as AdminAttendanceController from "../controllers/attendanceController.js";
import { requireAdmin, requireAdminApi } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Dữ liệu chấm công không nên bị lưu cache ở trình duyệt/proxy.
router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// Hiển thị giao diện bảng chấm công
router.get("/", requireAdmin, renderAttendancePage);

// API bảng chấm công theo ngày
router.get("/data", requireAdminApi, getAttendanceData);

// API chấm công bằng khuôn mặt
router.post("/face", requireAdminApi, faceAttendance);

// API chấm công thủ công (phương thức dự phòng)
router.post("/manual", requireAdminApi, manualAttendance);

// Các tính năng quản lý chấm công từ nhánh main
router.get("/reports", requireAdmin, AdminAttendanceController.report);
router.get("/export-csv", requireAdmin, AdminAttendanceController.exportCsv);
router.get("/refresh", requireAdmin, AdminAttendanceController.refresh);
router.get("/employee/:employeeId/history", requireAdmin, AdminAttendanceController.history);
router.post("/create", requireAdmin, AdminAttendanceController.create);
router.post("/:id/update", requireAdmin, AdminAttendanceController.update);

export default router;
