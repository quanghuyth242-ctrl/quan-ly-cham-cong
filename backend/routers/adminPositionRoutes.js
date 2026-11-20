import express from "express";
import * as PositionController from "../controllers/PositionController.js";

const router = express.Router();
router.get("/", PositionController.index);
router.post("/", PositionController.create);
router.post("/:id/update", PositionController.update);
router.post("/:id/delete", PositionController.remove);
export default router;
