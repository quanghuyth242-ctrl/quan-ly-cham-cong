import express from "express";
import * as ShiftAssignmentController from "../controllers/ShiftAssignmentController.js";

const router = express.Router();

router.get("/", ShiftAssignmentController.index);
router.post("/create", ShiftAssignmentController.create);
router.post("/:id/update", ShiftAssignmentController.update);
router.post("/:id/cancel", ShiftAssignmentController.cancel);

export default router;
