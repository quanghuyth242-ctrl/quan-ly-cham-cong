import express from "express";
import * as EmployeeController from "../controllers/EmployeeController.js";

const router = express.Router();

router.get("/", EmployeeController.index);
router.get("/refresh", EmployeeController.refresh);
router.get("/:id", EmployeeController.profile);
router.post("/", EmployeeController.create);
router.post("/:id/update", EmployeeController.update);
router.post("/:id/toggle-status", EmployeeController.toggleStatus);
router.post("/:id/delete", EmployeeController.remove);

export default router;
