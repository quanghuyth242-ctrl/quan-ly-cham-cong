import express from "express";
import * as AttendanceDeviceController from "../controllers/attendanceDeviceController.js";

const router = express.Router();

router.get("/refresh", AttendanceDeviceController.refresh);
router.get("/", AttendanceDeviceController.index);
router.post("/", AttendanceDeviceController.create);
router.post("/:id/update", AttendanceDeviceController.update);
router.post("/:id/delete", AttendanceDeviceController.remove);

export default router;
