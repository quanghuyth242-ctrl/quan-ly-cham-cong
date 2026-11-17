
import express from "express";
import * as AttendanceController from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/reports", AttendanceController.report);
router.get("/refresh", AttendanceController.refresh);
router.get("/", AttendanceController.index);
router.post("/create", AttendanceController.create);
router.post("/:id/update", AttendanceController.update);

export default router;
