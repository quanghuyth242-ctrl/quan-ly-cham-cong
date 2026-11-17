import express from "express";
import * as EmployeeController from "../controllers/EmployeeController.js";

const router = express.Router();

router.get("/", EmployeeController.index);
router.post("/", EmployeeController.create);
router.post("/:id/update", EmployeeController.update);

export default router;
