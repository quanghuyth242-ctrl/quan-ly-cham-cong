import express from "express";
import * as AttendanceDeviceController from "../controllers/attendanceDeviceController.js";

const router = express.Router();

router.post("/:deviceCode/heartbeat", AttendanceDeviceController.heartbeat);
router.post("/:deviceCode/sync", AttendanceDeviceController.sync);
router.post("/:deviceCode/events", AttendanceDeviceController.syncEvents);

export default router;
