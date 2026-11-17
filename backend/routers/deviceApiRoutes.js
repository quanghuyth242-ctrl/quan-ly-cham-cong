import express from "express";
import * as AttendanceDeviceController from "../controllers/attendanceDeviceController.js";

const router = express.Router();

router.post("/:deviceCode/heartbeat", AttendanceDeviceController.heartbeat);

export default router;
