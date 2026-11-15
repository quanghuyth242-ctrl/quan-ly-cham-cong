import express from "express";
import * as WorkShiftController from "../controllers/WorkShiftController.js";

const router = express.Router();

router.get("/", WorkShiftController.index);
router.post("/create", WorkShiftController.create);
router.post("/:id/update", WorkShiftController.update);
router.post("/:id/delete", WorkShiftController.remove);
router.post("/:id/toggle-status", WorkShiftController.toggleStatus);

export default router;
