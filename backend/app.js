import express from "express";
import path from "path";
import session from "express-session";
import { fileURLToPath } from "url";

import { db } from "./config/db.js";
import AuthRouter from "./routers/AuthRouter.js";
import WorkShiftRouter from "./routers/WorkShiftRouter.js";
import ShiftAssignmentRouter from "./routers/ShiftAssignmentRouter.js";
import FaceRouter from "./routers/FaceRouter.js";
import AttendanceRouter from "./routers/attendanceRoutes.js";
import LeaveRequestRouter from "./routers/LeaveRequestRouter.js";
import * as LeaveRequestController from "./controllers/LeaveRequestController.js";
import { requireAdmin, requireAdminApi, requireAuth } from "./middlewares/authMiddleware.js";
import { getOverviewData, getOverviewNotifications } from "./services/notificationService.js";
import adminDeviceRoutes from "./routers/adminDeviceRoutes.js";
import adminEmployeeRoutes from "./routers/adminEmployeeRoutes.js";
import adminDepartmentRoutes from "./routers/adminDepartmentRoutes.js";
import adminPositionRoutes from "./routers/adminPositionRoutes.js";
import { addClient } from "./services/realtimeService.js";
import deviceApiRoutes from "./routers/deviceApiRoutes.js";
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../frontend/views"));

// Thư viện và model nhận diện khuôn mặt được phục vụ cục bộ.
app.use(
    "/vendor/face-api/models",
    express.static(
        path.join(__dirname, "../node_modules/@vladmandic/face-api/model"),
        { maxAge: "7d" }
    )
);
app.use(
    "/vendor/face-api",
    express.static(
        path.join(__dirname, "../node_modules/@vladmandic/face-api/dist"),
        { maxAge: "1d" }
    )
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "../frontend/public")));

app.use(session({
    secret: "quanlychamcong_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.use("/", AuthRouter);

app.use("/admin/shifts", requireAdmin, WorkShiftRouter);

app.use("/admin/shift-assignments", requireAdmin, ShiftAssignmentRouter);

// Quản lý đơn nghỉ phép, khuôn mặt và chấm công
app.use("/admin/requests", requireAdmin, LeaveRequestRouter);
app.get("/requests/leave", requireAuth, LeaveRequestController.employeeLeaveForm);
app.post("/requests/leave", requireAuth, LeaveRequestController.createEmployeeLeave);
app.get("/requests/overtime", requireAuth, LeaveRequestController.employeeOvertimeForm);
app.post("/requests/overtime", requireAuth, LeaveRequestController.createEmployeeOvertime);
app.get("/requests/business-trip", requireAuth, LeaveRequestController.employeeBusinessTripForm);
app.post("/requests/business-trip", requireAuth, LeaveRequestController.createEmployeeBusinessTrip);
app.post("/requests/:id/respond", requireAuth, LeaveRequestController.respondToAdminRequest);
app.use("/admin/faces", requireAdmin, FaceRouter);
app.use("/admin/attendance", AttendanceRouter);

// Quản lý thiết bị và nhân sự
app.use("/admin/devices", requireAdmin, adminDeviceRoutes);
app.use("/admin/employees", requireAdmin, adminEmployeeRoutes);
app.use("/admin/departments", requireAdmin, adminDepartmentRoutes);
app.use("/admin/positions", requireAdmin, adminPositionRoutes);
app.use("/api/devices", deviceApiRoutes);

// Dữ liệu tổng quan dạng JSON + kênh realtime cho trang Tổng quan
app.get("/api/overview", requireAdminApi, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: await getOverviewData() });
});
app.get("/api/overview/stream", requireAdminApi, addClient);

app.get("/", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    try {
        const [overview, overviewData] = await Promise.all([
            getOverviewNotifications(),
            getOverviewData()
        ]);

        res.render("home", {
            user: req.session.user,
            notifications: overview.notifications,
            leaveNotifications: overview.leaveNotifications,
            attendanceNotifications: overview.attendanceNotifications,
            unreadNotificationCount: overview.unreadCount,
            overviewData
        });
    } catch (error) {
        console.error("Lỗi tải thông báo:", error);

        res.render("home", {
            user: req.session.user,
            notifications: [],
            leaveNotifications: [],
            attendanceNotifications: [],
            unreadNotificationCount: 0,
            overviewData: await getOverviewData()
        });
    }
});

// Kiểm tra MySQL trước khi chạy server
const startServer = async () => {
    try {
        const connection = await db.getConnection();

        console.log("Kết nối MySQL thành công!");

        connection.release();

        const PORT = 3000;

        app.listen(PORT, () => {
            console.log(`Server running: http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("KHÔNG THỂ KẾT NỐI MYSQL!");
        console.error("Mã lỗi:", error.code);
        console.error("Thông báo:", error.message);
        console.error("Chi tiết:", error);
    }
};

startServer();