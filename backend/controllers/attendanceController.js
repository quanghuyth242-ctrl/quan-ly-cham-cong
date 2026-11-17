import * as AttendanceModel from "../models/attendance.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_STATUSES = new Set(["present", "late", "absent"]);

const parseId = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const isValidDate = (value) => {
    if (!DATE_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const getToday = () => {
    const date = new Date();
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
};

const getEmptyReportStats = () => ({
    total_records: 0,
    present: 0,
    late: 0,
    absent: 0,
    total_hours: 0
});

const redirectWith = (res, { success = null, error = null } = {}) => {
    const params = new URLSearchParams();
    if (success) params.set("success", success);
    if (error) params.set("error", error);
    const query = params.toString();
    res.redirect(query ? `/admin/attendance?${query}` : "/admin/attendance");
};

const validateRecord = async (body, excludeId = null) => {
    const data = {
        employee_id: parseId(body.employee_id),
        work_date: String(body.work_date || "").trim(),
        check_in: String(body.check_in || "").trim(),
        check_out: String(body.check_out || "").trim(),
        status: String(body.status || "").trim().toLowerCase()
    };
    const errors = [];

    if (!data.employee_id) {
        errors.push("Vui lòng chọn nhân viên.");
    }

    if (!isValidDate(data.work_date)) {
        errors.push("Ngày chấm công không hợp lệ.");
    }

    for (const [field, label] of [["check_in", "giờ vào"], ["check_out", "giờ ra"]]) {
        if (data[field] && !TIME_PATTERN.test(data[field])) {
            errors.push(`Định dạng ${label} không hợp lệ.`);
        }
    }

    if (!VALID_STATUSES.has(data.status)) {
        errors.push("Vui lòng chọn trạng thái chấm công hợp lệ.");
    }

    if (data.status === "absent" && (data.check_in || data.check_out)) {
        errors.push("Bản ghi vắng mặt không được có giờ vào hoặc giờ ra.");
    } else if (data.status !== "absent" && !data.check_in) {
        errors.push("Vui lòng nhập giờ vào cho bản ghi có mặt.");
    }

    if (data.check_out && !data.check_in) {
        errors.push("Cần có giờ vào trước khi nhập giờ ra.");
    } else if (data.check_in && data.check_out && data.check_out <= data.check_in) {
        errors.push("Giờ ra phải sau giờ vào.");
    }

    if (errors.length === 0) {
        const employee = await AttendanceModel.findEmployeeById(data.employee_id);
        if (!employee) {
            errors.push("Nhân viên được chọn không tồn tại.");
        }
    }

    if (errors.length === 0) {
        const duplicate = await AttendanceModel.findByEmployeeDate(
            data.employee_id,
            data.work_date,
            excludeId
        );
        if (duplicate) {
            errors.push("Nhân viên đã có dữ liệu chấm công trong ngày này.");
        }
    }

    return { data, errors };
};

const getAttendancePageData = async () => {
    const [records, employees] = await Promise.all([
        AttendanceModel.findAll(),
        AttendanceModel.getEmployees()
    ]);
    const stats = {
        total_employees: employees.length,
        present: 0,
        late: 0,
        absent: 0
    };
    const overview = {
        late: 0,
        early: 0,
        unassigned: 0,
        absent: 0,
        absenceRate: 0,
        attended: 0,
        attendanceRate: 0
    };

    for (const record of records) {
        if (record.status === "present") {
            stats.present += 1;
            overview.attended += 1;
        } else if (record.status === "late") {
            stats.late += 1;
            overview.attended += 1;
        } else if (record.status === "absent") {
            stats.absent += 1;
            overview.absent += 1;
        }

        if (record.status === "late" || record.late_minutes > 0) overview.late += 1;
        if (record.early_leave_minutes > 0) overview.early += 1;
        if (record.status !== "absent" && !record.has_schedule) overview.unassigned += 1;
    }

    if (records.length > 0) {
        overview.absenceRate = Math.round((overview.absent / records.length) * 100);
        overview.attendanceRate = Math.round((overview.attended / records.length) * 100);
    }

    return { records, employees, stats, overview };
};

export const index = async (req, res) => {
    try {
        const { records, employees, stats, overview } = await getAttendancePageData();

        res.render("admin/attendance", {
            user: req.session.user,
            records,
            employees,
            stats,
            overview,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error("Lỗi tải bảng chấm công:", error);
        res.status(500).render("admin/attendance", {
            user: req.session.user,
            records: [],
            employees: [],
            stats: { total_employees: 0, present: 0, late: 0, absent: 0 },
            overview: {
                late: 0,
                early: 0,
                unassigned: 0,
                absent: 0,
                absenceRate: 0,
                attended: 0,
                attendanceRate: 0
            },
            success: null,
            error: "Không thể tải dữ liệu chấm công. Vui lòng thử lại."
        });
    }
};

export const refresh = async (_req, res) => {
    try {
        const { records, employees, stats } = await getAttendancePageData();

        return res.render("admin/attendanceRows", { records }, (renderError, rowsHtml) => {
            if (renderError) {
                console.error("Lỗi tạo nội dung làm mới bảng chấm công:", renderError);
                return res.status(500).json({
                    error: "Không thể cập nhật bảng chấm công. Vui lòng thử lại."
                });
            }

            return res.json({
                rowsHtml,
                employees,
                stats,
                refreshedAt: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error("Lỗi đồng bộ bảng chấm công:", error);
        return res.status(500).json({
            error: "Không thể đồng bộ dữ liệu chấm công. Vui lòng thử lại."
        });
    }
};

export const report = async (req, res) => {
    const today = getToday();
    const defaultFromDate = `${today.slice(0, 7)}-01`;
    const fromDate = String(req.query.from_date || defaultFromDate).trim();
    const toDate = String(req.query.to_date || today).trim();
    const rangeValid = isValidDate(fromDate)
        && isValidDate(toDate)
        && fromDate <= toDate;

    if (!rangeValid) {
        return res.status(400).render("admin/attendance-report", {
            user: req.session.user,
            filters: { fromDate, toDate },
            stats: getEmptyReportStats(),
            employees: [],
            attendanceRate: 0,
            success: null,
            error: "Khoảng ngày báo cáo không hợp lệ."
        });
    }

    try {
        const [stats, employees] = await Promise.all([
            AttendanceModel.getReportSummary(fromDate, toDate),
            AttendanceModel.getEmployeeReport(fromDate, toDate)
        ]);
        const attendanceRate = stats.total_records > 0
            ? Math.round(((stats.present + stats.late) / stats.total_records) * 100)
            : 0;

        return res.render("admin/attendance-report", {
            user: req.session.user,
            filters: { fromDate, toDate },
            stats,
            employees,
            attendanceRate,
            success: null,
            error: null
        });
    } catch (error) {
        console.error("Lỗi tải báo cáo chấm công:", error);
        return res.status(500).render("admin/attendance-report", {
            user: req.session.user,
            filters: { fromDate, toDate },
            stats: getEmptyReportStats(),
            employees: [],
            attendanceRate: 0,
            success: null,
            error: "Không thể tải báo cáo chấm công. Vui lòng thử lại."
        });
    }
};

export const create = async (req, res) => {
    try {
        const { data, errors } = await validateRecord(req.body);
        if (errors.length > 0) {
            return redirectWith(res, { error: errors.join(" ") });
        }

        await AttendanceModel.create(data);
        return redirectWith(res, { success: "Đã thêm dữ liệu chấm công." });
    } catch (error) {
        console.error("Lỗi thêm dữ liệu chấm công:", error);
        const message = error.code === "ER_DUP_ENTRY"
            ? "Nhân viên đã có dữ liệu chấm công trong ngày này."
            : "Không thể lưu dữ liệu chấm công. Vui lòng thử lại.";
        return redirectWith(res, { error: message });
    }
};

export const update = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) {
            return redirectWith(res, { error: "Mã bản ghi chấm công không hợp lệ." });
        }

        const record = await AttendanceModel.findById(id);
        if (!record) {
            return redirectWith(res, { error: "Bản ghi chấm công không tồn tại." });
        }

        const { data, errors } = await validateRecord(req.body, id);
        if (errors.length > 0) {
            return redirectWith(res, { error: errors.join(" ") });
        }

        await AttendanceModel.update(id, data);
        return redirectWith(res, { success: "Đã cập nhật dữ liệu chấm công." });
    } catch (error) {
        console.error("Lỗi cập nhật dữ liệu chấm công:", error);
        const message = error.code === "ER_DUP_ENTRY"
            ? "Nhân viên đã có dữ liệu chấm công trong ngày này."
            : "Không thể cập nhật dữ liệu chấm công. Vui lòng thử lại.";
        return redirectWith(res, { error: message });
    }
};