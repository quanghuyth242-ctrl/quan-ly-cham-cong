import {
    getRosterForDate,
    getDepartments,
    findEmployeeById,
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
import { evaluateAttendance } from "../services/shiftScheduleService.js";
import { writeAttendanceAuditLog } from "../services/attendanceAuditService.js";

export const renderAttendancePage = (req, res) => {
    res.render("admin/attendance", {
        user: req.session.user,
        pageTitle: "Bảng chấm công",
        activePage: "attendance"
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

        const [rows, departments] = await Promise.all([
            getRosterForDate({ date, search, department, status }),
            getDepartments()
        ]);

        const employees = await Promise.all(
            rows.map(async (row) => {
                const evaluation = await evaluateAttendance({
                    employeeId: row.employee_id,
                    workDate: date,
                    checkIn: row.check_in,
                    checkOut: row.check_out
                });

                return {
                    ...row,
                    face_registered: Boolean(row.face_profile_id),
                    evaluation
                };
            })
        );

        const stats = {
            total: employees.length,
            checkedIn: employees.filter((row) => row.check_in).length,
            checkedOut: employees.filter((row) => row.check_out).length,
            late: employees.filter(
                (row) => row.check_in && row.evaluation.isLate
            ).length,
            earlyLeave: employees.filter(
                (row) => row.check_out && row.evaluation.isEarlyLeave
            ).length,
            notCheckedIn: employees.filter((row) => !row.check_in).length
        };

        return res.status(200).json({
            success: true,
            date,
            employees,
            departments,
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
        const employee = await findEmployeeById(employeeId);

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
