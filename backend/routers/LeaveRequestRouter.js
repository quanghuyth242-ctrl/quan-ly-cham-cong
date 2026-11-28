import express from "express";
import * as LeaveRequestController from "../controllers/LeaveRequestController.js";

const router = express.Router();

router.get("/", LeaveRequestController.index);
router.get("/:id", LeaveRequestController.detail);
router.post("/explanation", LeaveRequestController.createExplanation);
router.post("/business-trip", LeaveRequestController.createBusinessTrip);
router.post("/overtime", LeaveRequestController.createOvertime);
router.post("/:id/approve", (req, res) => {
    req.params.decision = "approve";
    return LeaveRequestController.reviewRequest(req, res);
});
router.post("/:id/reject", (req, res) => {
    req.params.decision = "reject";
    return LeaveRequestController.reviewRequest(req, res);
});

export default router;
