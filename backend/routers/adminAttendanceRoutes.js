
import express from "express";
import * as AttendanceController from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/reports", AttendanceController.report);
router.get("/export-csv", AttendanceController.exportCsv);
router.get("/refresh", AttendanceController.refresh);
router.get("/employee/:employeeId/history", AttendanceController.history);
router.get("/", AttendanceController.index);
router.post("/create", AttendanceController.create);
router.post("/:id/update", AttendanceController.update);

export default router;
