import {
    getRosterForDate,
    getDepartments,
    getAllShifts,
    findEmployeeFullById,
    normalizeAttendanceStatus
} from "../models/attendance.js";
import { getAllFaceProfiles } from "../models/FaceModel.js";
import {
    findMatchingEmployee,
    isFaceDescriptorUsable
} from "../services/FaceService.js";
import {
    recordAttendance,
    AttendanceError,
    getTodayDateString,
    getActionCooldownRemaining,
    markActionSuccess,
    getFaceFailureLimit,
    rememberFaceFailure,
    clearFaceFailures,
    isValidAction
} from "../services/attendanceService.js";
import {
    buildAttendanceSchedule,
    evaluateAttendance,
    getShiftSchedulesForEmployeesOnDate
} from "../services/shiftScheduleService.js";
import { writeAttendanceAuditLog } from "../services/attendanceAuditService.js";
import {
    AttendanceGpsError,
    getSettings as getAttendanceGpsSettings,
    saveSettings as saveAttendanceGpsSettings,
    validateLocation
} from "../models/attendanceGps.js";

export const renderAttendancePage = async (req, res) => {
    const gpsSettings = await getAttendanceGpsSettings();

    res.render("admin/attendance", {
        user: req.session.user,
        pageTitle: "Bảng chấm công",
        activePage: "attendance",
        gpsSettings
    });
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateString = (value) => {
    if (!DATE_PATTERN.test(String(value))) return false;

    const date = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
};

const parseEmployeeId = (value) => {
    const id = Number(value);

    return Number.isInteger(id) && id > 0 ? id : null;
};

const parseFiniteNumber = (value) => {
    if (
        (typeof value !== "number" && typeof value !== "string")
        || String(value).trim() === ""
    ) {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const safeEmployee = (employee) => {
    if (!employee) return null;

    return {
        id: Number(employee.id ?? employee.employee_id),
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        department: employee.department || null
    };
};

const formatTime = (value) => {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit"
    });
};

const sendAttendanceError = (res, error) => {
    if (error instanceof AttendanceGpsError) {
        return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    if (error instanceof AttendanceError) {
        if (error.retryAfter) {
            res.set("Retry-After", String(error.retryAfter));
        }

        return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message
        });
    }

    console.error("Lỗi chấm công:", error);

    return res.status(500).json({
        success: false,
        code: "ATTENDANCE_SERVER_ERROR",
        message: "Không thể xử lý yêu cầu chấm công. Vui lòng thử lại."
    });
};

export const saveGpsSettings = async (req, res) => {
    try {
        const settings = await saveAttendanceGpsSettings({
            latitude: parseFiniteNumber(req.body?.latitude),
            longitude: parseFiniteNumber(req.body?.longitude),
            radiusMeters: parseFiniteNumber(req.body?.radius_m),
            updatedBy: Number(req.session.user?.id)
        });

        return res.status(200).json({
            success: true,
            settings,
            message: "Đã lưu vị trí cơ sở và bán kính chấm công GPS."
        });
    } catch (error) {
        if (error instanceof AttendanceGpsError) {
            return sendAttendanceError(res, error);
        }

        console.error("Lỗi lưu cấu hình chấm công GPS:", error);
        return res.status(500).json({
            success: false,
            code: "GPS_SETTINGS_ERROR",
            message: "Không thể lưu cấu hình GPS. Vui lòng thử lại."
        });
    }
};

export const gpsAttendance = async (req, res) => {
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const workDate = getTodayDateString();
    const employeeId = parseEmployeeId(body.employee_id);
    let employee = null;
    let location = null;

    if (!isValidAction(action)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_ACTION",
            message: "Hành động chấm công không hợp lệ."
        });
    }

    if (!employeeId) {
        return res.status(400).json({
            success: false,
            code: "INVALID_EMPLOYEE",
            message: "Nhân viên không hợp lệ."
        });
    }

    try {
        const employeeRecord = await findEmployeeFullById(employeeId);
        if (!employeeRecord) {
            return res.status(404).json({
                success: false,
                code: "EMPLOYEE_NOT_FOUND",
                message: "Không tìm thấy nhân viên."
            });
        }

        employee = safeEmployee(employeeRecord);
        location = await validateLocation({
            latitude: parseFiniteNumber(body.latitude),
            longitude: parseFiniteNumber(body.longitude),
            accuracy: parseFiniteNumber(body.accuracy)
        });

        const cooldown = getActionCooldownRemaining(employee.id, action);
        if (cooldown > 0) {
            res.set("Retry-After", String(cooldown));
            return res.status(429).json({
                success: false,
                code: "TOO_MANY_REQUESTS",
                message: `Vui lòng đợi ${cooldown} giây trước khi thực hiện lại.`
            });
        }

        const result = await recordAttendance({
            employeeId: employee.id,
            action,
            workDate,
            location
        });

        markActionSuccess(employee.id, action);

        await writeAttendanceAuditLog({
            action,
            method: "gps",
            result: "success",
            actor: req.session.user,
            employee,
            workDate,
            detail: {
                accuracyMeters: location.accuracy,
                distanceMeters: location.distance_m,
                radiusMeters: location.radius_m,
                status: result.evaluation.suggestedStatus
            },
            req
        });

        const time = formatTime(
            action === "check_in"
                ? result.attendance.check_in
                : result.attendance.check_out
        );

        return res.status(200).json({
            success: true,
            code: action === "check_in" ? "GPS_CHECK_IN_SUCCESS" : "GPS_CHECK_OUT_SUCCESS",
            message: `${action === "check_in" ? "Check-in" : "Check-out"} GPS thành công${time ? ` lúc ${time}` : ""}.`,
            employee,
            attendance: result.attendance,
            evaluation: result.evaluation,
            location: {
                distance_m: location.distance_m,
                accuracy_m: Math.round(location.accuracy),
                radius_m: location.radius_m
            }
        });
    } catch (error) {
        if (error instanceof AttendanceError || error instanceof AttendanceGpsError) {
            await writeAttendanceAuditLog({
                action,
                method: "gps",
                result: "rejected",
                actor: req.session.user,
                employee,
                workDate,
                detail: {
                    code: error.code,
                    message: error.message
                },
                req
            });
        }

        return sendAttendanceError(res, error);
    }
};

// Bảng chấm công theo ngày, bao gồm cả nhân viên chưa chấm công.
export const getAttendanceData = async (req, res) => {
    try {
        const rawDate = String(req.query.date || "").trim();
        const date = rawDate || getTodayDateString();

        if (!isValidDateString(date)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Ngày chấm công không hợp lệ. Định dạng yêu cầu: YYYY-MM-DD."
            });
        }

        const search = String(req.query.search || "").trim().slice(0, 100);
        const department = String(req.query.department || "")
            .trim()
            .slice(0, 100);
        const status = normalizeAttendanceStatus(req.query.status);
        const rawShiftId = String(req.query.shiftId || "").trim();
        const shiftId = rawShiftId ? Number(rawShiftId) : null;

        if (
            rawShiftId
            && (!/^[1-9]\d*$/.test(rawShiftId) || !Number.isSafeInteger(shiftId))
        ) {
            return res.status(400).json({
                success: false,
                code: "INVALID_SHIFT_ID",
                message: "Mã ca làm không hợp lệ."
            });
        }

        const [rows, departments, shifts] = await Promise.all([
            getRosterForDate({ date, search, department, status, shiftId }),
            getDepartments(),
            getAllShifts()
        ]);

        const shiftSchedules = await getShiftSchedulesForEmployeesOnDate(
            rows.map((row) => row.employee_id),
            date
        );

        const employees = await Promise.all(
            rows.map(async (row) => {
                const schedule = buildAttendanceSchedule(
                    shiftSchedules.get(row.employee_id) || null,
                    date
                );
                const evaluation = await evaluateAttendance({
                    employeeId: row.employee_id,
                    workDate: date,
                    checkIn: row.check_in,
                    checkOut: row.check_out,
                    schedule
                });

                return {
                    ...row,
                    face_registered: Boolean(row.face_profile_id),
                    evaluation
                };
            })
        );

        const stats = employees.reduce((totals, row) => {
            totals.total += 1;
            if (row.check_in) totals.checkedIn += 1;
            if (row.check_out) totals.checkedOut += 1;
            if (row.check_in && row.evaluation.isLate) totals.late += 1;
            if (row.check_out && row.evaluation.isEarlyLeave) totals.earlyLeave += 1;
            if (row.record_source === "device") totals.deviceRecords += 1;
            if (!row.check_in) totals.notCheckedIn += 1;
            return totals;
        }, {
            total: 0,
            checkedIn: 0,
            checkedOut: 0,
            late: 0,
            earlyLeave: 0,
            deviceRecords: 0,
            notCheckedIn: 0
        });

        return res.status(200).json({
            success: true,
            date,
            employees,
            departments,
            shifts,
            stats
        });
    } catch (error) {
        console.error("Lỗi lấy bảng chấm công:", error);

        return res.status(500).json({
            success: false,
            code: "ATTENDANCE_LIST_ERROR",
            message: "Không thể tải bảng chấm công. Vui lòng thử lại."
        });
    }
};

// Chấm công bằng khuôn mặt: server tự đối chiếu descriptor với hồ sơ đã lưu.
export const faceAttendance = async (req, res) => {
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const workDate = getTodayDateString();

    let matchedEmployee = null;

    if (!isValidAction(action)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_ACTION",
            message: "Hành động chấm công không hợp lệ."
        });
    }

    if (!isFaceDescriptorUsable(body.descriptor)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_DESCRIPTOR",
            message: "Dữ liệu khuôn mặt không hợp lệ. Vui lòng thử lại."
        });
    }

    const faceLimit = getFaceFailureLimit(req.ip);

    if (faceLimit.blocked) {
        res.set("Retry-After", String(faceLimit.retryAfter));

        return res.status(429).json({
            success: false,
            code: "TOO_MANY_FACE_ATTEMPTS",
            message: `Có quá nhiều lần nhận diện thất bại. Vui lòng thử lại sau ${faceLimit.retryAfter} giây.`
        });
    }

    try {
        const profiles = await getAllFaceProfiles();

        if (profiles.length === 0) {
            await writeAttendanceAuditLog({
                action,
                method: "face",
                result: "no_profiles",
                actor: req.session.user,
                employee: null,
                workDate,
                req
            });

            return res.status(404).json({
                success: false,
                code: "NO_FACE_PROFILES",
                message: "Chưa có hồ sơ khuôn mặt nào được đăng ký. Vui lòng đăng ký khuôn mặt hoặc dùng phương thức thủ công."
            });
        }

        const match = findMatchingEmployee(body.descriptor, profiles);

        if (!match.matched || !match.employee) {
            rememberFaceFailure(req.ip);

            await writeAttendanceAuditLog({
                action,
                method: "face",
                result: "unmatched",
                actor: req.session.user,
                employee: null,
                workDate,
                req
            });

            return res.status(404).json({
                success: false,
                code: "FACE_NOT_MATCHED",
                message: "Không nhận diện được khuôn mặt. Vui lòng thử lại hoặc dùng phương thức thủ công."
            });
        }

        clearFaceFailures(req.ip);

        matchedEmployee = safeEmployee(match.employee);

        const cooldown = getActionCooldownRemaining(
            matchedEmployee.id,
            action
        );

        if (cooldown > 0) {
            res.set("Retry-After", String(cooldown));

            return res.status(429).json({
                success: false,
                code: "TOO_MANY_REQUESTS",
                message: `Vui lòng đợi ${cooldown} giây trước khi thực hiện lại.`
            });
        }

        const result = await recordAttendance({
            employeeId: matchedEmployee.id,
            action,
            workDate
        });

        markActionSuccess(matchedEmployee.id, action);

        await writeAttendanceAuditLog({
            action,
            method: "face",
            result: "success",
            actor: req.session.user,
            employee: matchedEmployee,
            workDate,
            detail: {
                status: result.evaluation.suggestedStatus,
                lateMinutes: result.evaluation.lateMinutes,
                earlyLeaveMinutes: result.evaluation.earlyLeaveMinutes,
                workMinutes: result.evaluation.workMinutes,
                distance: match.distance
            },
            req
        });

        const attendanceTime = action === "check_in"
            ? result.attendance.check_in
            : result.attendance.check_out;
        const timeLabel = formatTime(attendanceTime);

        return res.status(200).json({
            success: true,
            code: action === "check_in"
                ? "CHECK_IN_SUCCESS"
                : "CHECK_OUT_SUCCESS",
            message: action === "check_in"
                ? `Check-in thành công${timeLabel ? ` lúc ${timeLabel}` : ""}.`
                : `Check-out thành công${timeLabel ? ` lúc ${timeLabel}` : ""}.`,
            method: "face",
            employee: matchedEmployee,
            attendance: result.attendance,
            evaluation: result.evaluation
        });
    } catch (error) {
        if (error instanceof AttendanceError) {
            await writeAttendanceAuditLog({
                action,
                method: "face",
                result: "rejected",
                actor: req.session.user,
                employee: matchedEmployee,
                workDate,
                detail: {
                    code: error.code,
                    message: error.message
                },
                req
            });
        }

        return sendAttendanceError(res, error);
    }
};

// Phương thức dự phòng khi camera/nhận diện không hoạt động.
// Chỉ quản trị viên được thao tác và bắt buộc nhập lý do.
export const manualAttendance = async (req, res) => {
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const workDate = getTodayDateString();
    const employeeId = parseEmployeeId(body.employee_id);
    const reason = String(body.reason || "").trim();

    let manualEmployee = null;

    if (!isValidAction(action)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_ACTION",
            message: "Hành động chấm công không hợp lệ."
        });
    }

    if (!employeeId) {
        return res.status(400).json({
            success: false,
            code: "INVALID_EMPLOYEE",
            message: "Vui lòng chọn nhân viên."
        });
    }

    if (reason.length < 5 || reason.length > 255) {
        return res.status(400).json({
            success: false,
            code: "INVALID_REASON",
            message: "Vui lòng nhập lý do chấm công thủ công (từ 5 đến 255 ký tự)."
        });
    }

    try {
        const employee = await findEmployeeFullById(employeeId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                code: "EMPLOYEE_NOT_FOUND",
                message: "Không tìm thấy nhân viên."
            });
        }

        manualEmployee = safeEmployee(employee);

        const cooldown = getActionCooldownRemaining(
            manualEmployee.id,
            action
        );

        if (cooldown > 0) {
            res.set("Retry-After", String(cooldown));

            return res.status(429).json({
                success: false,
                code: "TOO_MANY_REQUESTS",
                message: `Vui lòng đợi ${cooldown} giây trước khi thực hiện lại.`
            });
        }

        const result = await recordAttendance({
            employeeId: manualEmployee.id,
            action,
            workDate
        });

        markActionSuccess(manualEmployee.id, action);

        await writeAttendanceAuditLog({
            action,
            method: "manual",
            result: "success",
            actor: req.session.user,
            employee: manualEmployee,
            workDate,
            reason,
            detail: {
                status: result.evaluation.suggestedStatus,
                lateMinutes: result.evaluation.lateMinutes,
                earlyLeaveMinutes: result.evaluation.earlyLeaveMinutes,
                workMinutes: result.evaluation.workMinutes
            },
            req
        });

        return res.status(200).json({
            success: true,
            code: action === "check_in"
                ? "MANUAL_CHECK_IN_SUCCESS"
                : "MANUAL_CHECK_OUT_SUCCESS",
            message: action === "check_in"
                ? `Đã ghi nhận check-in thủ công cho ${manualEmployee.full_name}.`
                : `Đã ghi nhận check-out thủ công cho ${manualEmployee.full_name}.`,
            method: "manual",
            employee: manualEmployee,
            attendance: result.attendance,
            evaluation: result.evaluation
        });
    } catch (error) {
        if (error instanceof AttendanceError) {
            await writeAttendanceAuditLog({
                action,
                method: "manual",
                result: "rejected",
                actor: req.session.user,
                employee: manualEmployee,
                workDate,
                reason,
                detail: {
                    code: error.code,
                    message: error.message
                },
                req
            });
        }

        return sendAttendanceError(res, error);
    }
};

import * as AttendanceModel from "../models/attendance.js";

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

    const automaticStatus = data.status === "auto";
    if (!automaticStatus && !VALID_STATUSES.has(data.status)) {
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

    if (errors.length === 0 && !excludeId) {
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

    if (errors.length === 0 && automaticStatus) {
        data.status = await AttendanceModel.getScheduledAttendanceStatus(
            data.employee_id,
            data.work_date,
            data.check_in
        );
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

export const history = async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    if (!employeeId) {
        return res.status(400).json({ error: "Mã nhân viên không hợp lệ." });
    }

    try {
        const [records, employee] = await Promise.all([
            AttendanceModel.findHistoryByEmployee(employeeId),
            AttendanceModel.findEmployeeDetailsById(employeeId)
        ]);

        if (!employee) {
            return res.status(404).json({ error: "Không tìm thấy nhân viên." });
        }
        return res.json({ employeeId, records });
    } catch (error) {
        console.error("Lỗi tải lịch sử chấm công:", error);
        return res.status(500).json({ error: "Không thể tải lịch sử chấm công." });
    }
};

export const exportCsv = async (req, res) => {
    try {
        const [rows] = await AttendanceModel.exportAllHistory(
            String(req.query.from_date || "").trim() || null,
            String(req.query.to_date || "").trim() || null
        );
        const data = [
            [
                "Mã nhân viên",
                "Nhân viên",
                "Ngày",
                "Giờ vào",
                "Giờ ra",
                "GPS vào (vĩ độ, kinh độ)",
                "Độ chính xác GPS vào (m)",
                "Khoảng cách vào (m)",
                "GPS ra (vĩ độ, kinh độ)",
                "Độ chính xác GPS ra (m)",
                "Khoảng cách ra (m)",
                "Trạng thái"
            ],
            ...rows.map((row) => [
                row.employee_code,
                row.full_name,
                row.work_date,
                row.check_in || "",
                row.check_out || "",
                row.check_in_latitude !== null && row.check_in_longitude !== null
                    ? `${row.check_in_latitude}, ${row.check_in_longitude}`
                    : "",
                row.check_in_accuracy_m ?? "",
                row.check_in_distance_m ?? "",
                row.check_out_latitude !== null && row.check_out_longitude !== null
                    ? `${row.check_out_latitude}, ${row.check_out_longitude}`
                    : "",
                row.check_out_accuracy_m ?? "",
                row.check_out_distance_m ?? "",
                { present: "Đúng giờ", late: "Đi muộn", absent: "Vắng mặt" }[row.status] || row.status
            ])
        ];
        const csv = "\uFEFF" + data.map((row) =>
            row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
        ).join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="lich-su-cham-cong.csv"');
        return res.send(csv);
    } catch (error) {
        console.error("Lỗi xuất CSV lịch sử chấm công:", error);
        return res.status(500).json({ error: "Không thể xuất CSV lịch sử chấm công." });
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

        const { data, errors } = await validateRecord({
            ...req.body,
            employee_id: record.employee_id
        }, id);
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