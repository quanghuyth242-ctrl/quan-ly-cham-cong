import * as ShiftAssignmentModel from "../models/ShiftAssignmentModel.js";
import * as WorkShiftModel from "../models/WorkShiftModel.js";

const WEEKDAY_LABELS = {
    1: "Thứ 2",
    2: "Thứ 3",
    3: "Thứ 4",
    4: "Thứ 5",
    5: "Thứ 6",
    6: "Thứ 7",
    7: "Chủ nhật"
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDate = (value) => {
    if (!DATE_PATTERN.test(value)) return false;

    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const redirectWith = (res, path, { success = null, error = null } = {}) => {
    const params = new URLSearchParams();

    if (success) params.set("success", success);
    if (error) params.set("error", error);

    const query = params.toString();
    res.redirect(query ? `${path}?${query}` : path);
};

const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const validateAssignment = async (body, excludeId = null) => {
    const data = {
        employee_id: parseId(body.employee_id),
        shift_id: parseId(body.shift_id),
        start_date: String(body.start_date || "").trim(),
        end_date: String(body.end_date || "").trim(),
        note: String(body.note || "").trim().slice(0, 255)
    };

    const errors = [];

    if (!data.employee_id) {
        errors.push("Vui lòng chọn nhân viên cần phân ca.");
    }

    if (!data.shift_id) {
        errors.push("Vui lòng chọn ca làm việc.");
    }

    if (!data.start_date) {
        errors.push("Vui lòng chọn ngày bắt đầu áp dụng.");
    } else if (!isValidDate(data.start_date)) {
        errors.push("Ngày bắt đầu không hợp lệ.");
    }

    if (!data.end_date) {
        errors.push("Vui lòng chọn ngày kết thúc áp dụng.");
    } else if (!isValidDate(data.end_date)) {
        errors.push("Ngày kết thúc không hợp lệ.");
    }

    if (isValidDate(data.start_date) && isValidDate(data.end_date)
        && data.end_date < data.start_date) {
        errors.push("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
    }

    if (data.employee_id) {
        const employee = await ShiftAssignmentModel.findEmployeeById(data.employee_id);

        if (!employee) {
            errors.push("Nhân viên được chọn không tồn tại.");
        }
    }

    if (data.shift_id) {
        const shift = await WorkShiftModel.findById(data.shift_id);

        if (!shift) {
            errors.push("Ca làm việc được chọn không tồn tại.");
        } else if (shift.status !== 1) {
            errors.push(`Ca "${shift.shift_name}" đã ngừng hoạt động, không thể phân ca.`);
        }
    }

    if (errors.length === 0) {
        const conflict = await ShiftAssignmentModel.findConflict(
            data.employee_id,
            data.start_date,
            data.end_date,
            excludeId
        );

        if (conflict) {
            errors.push(
                `Nhân viên đã có phân ca "${conflict.shift_name}" trong khoảng ${conflict.start_date} - ${conflict.end_date}. Vui lòng chọn khoảng thời gian khác.`
            );
        }
    }

    return { data, errors };
};

export const index = async (req, res) => {
    try {
        const search = String(req.query.search || "").trim();
        const department = String(req.query.department || "").trim();
        const shiftId = parseId(req.query.shift_id);
        const allowedStatuses = ["", "active", "cancelled"];
        const status = allowedStatuses.includes(String(req.query.status))
            ? String(req.query.status)
            : "active";

        const [assignments, employees, activeShifts, departments, stats] = await Promise.all([
            ShiftAssignmentModel.findAll({
                search,
                department,
                shiftId: shiftId || "",
                status
            }),
            ShiftAssignmentModel.getEmployeeOptions(),
            WorkShiftModel.findActive(),
            ShiftAssignmentModel.getDepartments(),
            ShiftAssignmentModel.getStats()
        ]);

        res.render("assignments", {
            user: req.session.user,
            assignments,
            employees,
            activeShifts,
            departments,
            stats,
            filters: {
                search,
                department,
                shiftId: shiftId ? String(shiftId) : "",
                status
            },
            weekdayLabels: WEEKDAY_LABELS,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.log("Lỗi tải danh sách phân ca:", error);

        res.render("assignments", {
            user: req.session.user,
            assignments: [],
            employees: [],
            activeShifts: [],
            departments: [],
            stats: {
                activeAssignments: 0,
                cancelledAssignments: 0,
                assignedEmployees: 0
            },
            filters: { search: "", department: "", shiftId: "", status: "active" },
            weekdayLabels: WEEKDAY_LABELS,
            success: null,
            error: "Không thể tải danh sách phân ca. Vui lòng thử lại."
        });
    }
};

export const create = async (req, res) => {
    try {
        const { data, errors } = await validateAssignment(req.body);

        if (errors.length > 0) {
            return redirectWith(res, "/admin/shift-assignments", {
                error: errors.join(" ")
            });
        }

        await ShiftAssignmentModel.create(data);

        redirectWith(res, "/admin/shift-assignments", {
            success: "Đã phân ca cho nhân viên."
        });
    } catch (error) {
        console.log("Lỗi phân ca:", error);

        redirectWith(res, "/admin/shift-assignments", {
            error: "Không thể lưu phân ca. Vui lòng thử lại."
        });
    }
};

export const update = async (req, res) => {
    try {
        const assignment = await ShiftAssignmentModel.findById(req.params.id);

        if (!assignment) {
            return redirectWith(res, "/admin/shift-assignments", {
                error: "Phân ca không tồn tại."
            });
        }

        const { data, errors } = await validateAssignment(req.body, assignment.id);

        if (errors.length > 0) {
            return redirectWith(res, "/admin/shift-assignments", {
                error: errors.join(" ")
            });
        }

        await ShiftAssignmentModel.update(assignment.id, data);

        redirectWith(res, "/admin/shift-assignments", {
            success: "Đã cập nhật phân ca."
        });
    } catch (error) {
        console.log("Lỗi cập nhật phân ca:", error);

        redirectWith(res, "/admin/shift-assignments", {
            error: "Không thể cập nhật phân ca. Vui lòng thử lại."
        });
    }
};

export const cancel = async (req, res) => {
    try {
        const assignment = await ShiftAssignmentModel.findById(req.params.id);

        if (!assignment) {
            return redirectWith(res, "/admin/shift-assignments", {
                error: "Phân ca không tồn tại."
            });
        }

        if (assignment.status === "cancelled") {
            return redirectWith(res, "/admin/shift-assignments", {
                error: "Phân ca này đã được hủy trước đó."
            });
        }

        await ShiftAssignmentModel.cancel(assignment.id);

        redirectWith(res, "/admin/shift-assignments", {
            success: `Đã hủy phân ca của "${assignment.full_name}".`
        });
    } catch (error) {
        console.log("Lỗi hủy phân ca:", error);

        redirectWith(res, "/admin/shift-assignments", {
            error: "Không thể hủy phân ca. Vui lòng thử lại."
        });
    }
};
