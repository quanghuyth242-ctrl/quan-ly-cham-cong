import express from "express";
import * as ShiftAssignmentController from "../controllers/ShiftAssignmentController.js";

const router = express.Router();

router.get("/", ShiftAssignmentController.index);
router.get("/calendar-data", ShiftAssignmentController.calendarData);
router.get("/employee-calendar", ShiftAssignmentController.employeeCalendar);
router.post("/create", ShiftAssignmentController.create);
router.post("/:id/adjust", ShiftAssignmentController.adjust);
router.post("/:id/update", ShiftAssignmentController.update);
router.post("/:id/cancel", ShiftAssignmentController.cancel);

export default router;
