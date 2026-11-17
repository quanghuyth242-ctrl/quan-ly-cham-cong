import express from "express";
import * as EmployeeController from "../controllers/EmployeeController.js";

const router = express.Router();

router.get("/", EmployeeController.index);

export default router;
