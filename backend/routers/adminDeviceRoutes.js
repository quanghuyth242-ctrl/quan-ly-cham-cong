import express from "express";
import * as AttendanceDeviceController from "../controllers/attendanceDeviceController.js";

const router = express.Router();

router.get("/", AttendanceDeviceController.index);
router.post("/", AttendanceDeviceController.create);

export default router;
