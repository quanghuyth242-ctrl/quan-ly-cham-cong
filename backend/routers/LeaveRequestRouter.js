import express from "express";
import * as LeaveRequestController from "../controllers/LeaveRequestController.js";

const router = express.Router();

router.get("/", LeaveRequestController.index);
router.post("/leave", LeaveRequestController.createLeave);
router.post("/explanation", LeaveRequestController.createExplanation);

export default router;
