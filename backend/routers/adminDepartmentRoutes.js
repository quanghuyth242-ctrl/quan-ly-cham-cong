import express from "express";
import * as DepartmentController from "../controllers/DepartmentController.js";

const router = express.Router();

router.get("/", DepartmentController.index);
router.post("/", DepartmentController.create);
router.post("/:id/update", DepartmentController.update);
router.post("/:id/delete", DepartmentController.remove);

export default router;
