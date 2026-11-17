import * as EmployeeModel from "../models/EmployeeModel.js";

export const index = async (req, res) => {
    const filters = {
        search: String(req.query.search || "").trim().slice(0, 100),
        department: String(req.query.department || "").trim().slice(0, 100)
    };

    try {
        const [employees, departments, stats] = await Promise.all([
            EmployeeModel.findAll(filters),
            EmployeeModel.getDepartments(),
            EmployeeModel.getStats()
        ]);

        return res.render("admin/employees", {
            user: req.session.user,
            employees,
            departments,
            stats,
            filters,
            error: null
        });
    } catch (error) {
        console.error("Lỗi tải danh sách nhân sự:", error);

        return res.status(500).render("admin/employees", {
            user: req.session.user,
            employees: [],
            departments: [],
            stats: { total: 0, departments: 0, unassignedDepartment: 0 },
            filters,
            error: "Không thể tải danh sách nhân sự. Vui lòng thử lại."
        });
    }
};