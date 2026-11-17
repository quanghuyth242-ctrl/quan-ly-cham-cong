
import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
    res.render("admin/attendance", {
        pageTitle: "Bảng chấm công",
        activePage: "attendance",
        user: req.session.user,

        stats: {
            total_employees: 20,
            present: 15,
            late: 2,
            absent: 3
        },

        filters: {
            keyword: "",
            date: "",
            status: ""
        },

        records: [
            {
                employee_id: 1,
                employee_name: "Nguyễn Văn An",
                work_date: "2026-11-16",
                check_in: "08:00",
                check_out: "17:00",
                total_hours: 8,
                status: "Đúng giờ"
            },
            {
                employee_id: 2,
                employee_name: "Trần Thị Bình",
                work_date: "2026-11-16",
                check_in: "08:15",
                check_out: "17:00",
                total_hours: 7.75,
                status: "Đi muộn"
            },
            {
                employee_id: 3,
                employee_name: "Lê Văn Cường",
                work_date: "2026-11-16",
                check_in: "--",
                check_out: "--",
                total_hours: 0,
                status: "Vắng mặt"
            }
        ]
    });
});

export default router;
