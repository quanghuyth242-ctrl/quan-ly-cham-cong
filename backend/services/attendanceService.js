import { db } from "../config/db.js";
import { evaluateAttendance } from "./shiftScheduleService.js";
import {
    findByEmployeeAndDateForUpdate,
    insertCheckIn,
    updateCheckOut
} from "../models/attendance.js";

/**
 * Nghiệp vụ chấm công dùng chung cho nhận diện khuôn mặt và phương thức thủ công.
 *
 * - Chống trùng check-in/check-out bằng transaction + khóa dòng.
 * - Bảng attendance hiện có UNIQUE KEY (employee_id, work_date), vì vậy mỗi
 *   nhân viên chỉ có tối đa một bản ghi cho mỗi ngày làm việc.
 * - Giới hạn tần suất trong bộ nhớ (phù hợp môi trường một process).
 */

const EMPLOYEE_ACTION_COOLDOWN_MS = 2000;
const FACE_FAILURE_WINDOW_MS = 60 * 1000;
const FACE_FAILURE_LIMIT = 10;

const actionCooldowns = new Map();
const faceFailures = new Map();

export class AttendanceError extends Error {
    constructor(message, statusCode = 400, code = "ATTENDANCE_ERROR", retryAfter = null) {
        super(message);
        this.name = "AttendanceError";
        this.statusCode = statusCode;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

export const getTodayDateString = (now = new Date()) => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
};

export const isValidAction = (action) => (
    action === "check_in" || action === "check_out"
);

const getCooldownKey = (employeeId, action) => `${employeeId}:${action}`;

export const getActionCooldownRemaining = (employeeId, action) => {
    const key = getCooldownKey(employeeId, action);
    const lastAt = actionCooldowns.get(key);

    if (!lastAt) return 0;

    const remainingMs = EMPLOYEE_ACTION_COOLDOWN_MS - (Date.now() - lastAt);

    if (remainingMs <= 0) {
        actionCooldowns.delete(key);
        return 0;
    }

    return Math.ceil(remainingMs / 1000);
};

export const markActionSuccess = (employeeId, action) => {
    actionCooldowns.set(getCooldownKey(employeeId, action), Date.now());
};

const cleanupFaceFailures = (now) => {
    for (const [ip, entry] of faceFailures.entries()) {
        if (now - entry.firstAt >= FACE_FAILURE_WINDOW_MS) {
            faceFailures.delete(ip);
        }
    }
};

export const getFaceFailureLimit = (ip) => {
    if (!ip) {
        return { blocked: false, retryAfter: 0 };
    }

    const now = Date.now();
    cleanupFaceFailures(now);

    const entry = faceFailures.get(ip);

    if (!entry || entry.count < FACE_FAILURE_LIMIT) {
        return { blocked: false, retryAfter: 0 };
    }

    const retryAfter = Math.max(
        1,
        Math.ceil((FACE_FAILURE_WINDOW_MS - (now - entry.firstAt)) / 1000)
    );

    return { blocked: true, retryAfter };
};

export const rememberFaceFailure = (ip) => {
    if (!ip) return;

    const now = Date.now();
    const entry = faceFailures.get(ip);

    if (!entry || now - entry.firstAt >= FACE_FAILURE_WINDOW_MS) {
        faceFailures.set(ip, { count: 1, firstAt: now });
        return;
    }

    entry.count += 1;
};

export const clearFaceFailures = (ip) => {
    if (ip) {
        faceFailures.delete(ip);
    }
};

const toDateValue = (value) => {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Ghi nhận một lượt check-in hoặc check-out.
 *
 * @param {object} params
 * @param {number} params.employeeId
 * @param {"check_in"|"check_out"} params.action
 * @param {string} params.workDate - YYYY-MM-DD (do server quyết định)
 * @param {object|null} [params.location] - GPS coordinates already validated against the geofence
 * @returns {Promise<{ attendance: object, evaluation: object }>}
 */
export const recordAttendance = async ({ employeeId, action, workDate, location = null }) => {
    const normalizedEmployeeId = Number(employeeId);

    if (!Number.isInteger(normalizedEmployeeId) || normalizedEmployeeId <= 0) {
        throw new AttendanceError(
            "Nhân viên không hợp lệ.",
            400,
            "INVALID_EMPLOYEE"
        );
    }

    if (!isValidAction(action)) {
        throw new AttendanceError(
            "Hành động chấm công không hợp lệ.",
            400,
            "INVALID_ACTION"
        );
    }

    if (!workDate) {
        throw new AttendanceError(
            "Ngày chấm công không hợp lệ.",
            400,
            "INVALID_WORK_DATE"
        );
    }

    // Chỉ cho phép chấm công khi nhân viên có ca đang hiệu lực và hôm nay
    // là ngày làm việc theo lịch phân ca. Không tự tạo ca mới.
    const schedule = await evaluateAttendance({
        employeeId: normalizedEmployeeId,
        workDate
    });

    if (!schedule.assigned) {
        throw new AttendanceError(
            "Nhân viên chưa được phân ca làm việc trong ngày này.",
            409,
            "NO_SHIFT"
        );
    }

    if (!schedule.isWorkingDay) {
        throw new AttendanceError(
            "Hôm nay không phải ngày làm việc theo ca được phân.",
            409,
            "DAY_OFF"
        );
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const existing = await findByEmployeeAndDateForUpdate(
            connection,
            normalizedEmployeeId,
            workDate
        );

        if (action === "check_in") {
            if (existing?.check_in) {
                throw new AttendanceError(
                    "Nhân viên đã check-in trong ngày này.",
                    409,
                    "ALREADY_CHECKED_IN"
                );
            }

            const checkIn = new Date();
            const evaluation = await evaluateAttendance({
                employeeId: normalizedEmployeeId,
                workDate,
                checkIn,
                schedule
            });

            const attendance = await insertCheckIn(connection, {
                employeeId: normalizedEmployeeId,
                workDate,
                checkIn,
                status: evaluation.suggestedStatus,
                location
            });

            await connection.commit();

            return { attendance, evaluation };
        }

        if (!existing?.check_in) {
            throw new AttendanceError(
                "Nhân viên chưa check-in nên không thể check-out.",
                409,
                "NOT_CHECKED_IN"
            );
        }

        if (existing.check_out) {
            throw new AttendanceError(
                "Nhân viên đã check-out trong ngày này.",
                409,
                "ALREADY_CHECKED_OUT"
            );
        }

        const checkInDate = toDateValue(existing.check_in);
        const checkOut = new Date();

        if (checkInDate && checkOut.getTime() <= checkInDate.getTime()) {
            throw new AttendanceError(
                "Giờ check-out phải sau giờ check-in.",
                409,
                "INVALID_CHECK_OUT_TIME"
            );
        }

        const evaluation = await evaluateAttendance({
            employeeId: normalizedEmployeeId,
            workDate,
            checkIn: existing.check_in,
            checkOut,
            schedule
        });

        const attendance = await updateCheckOut(connection, {
            attendanceId: existing.id,
            checkOut,
            status: evaluation.suggestedStatus,
            location
        });

        await connection.commit();

        return { attendance, evaluation };
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.warn(
                "Không thể rollback giao dịch chấm công:",
                rollbackError.message
            );
        }

        if (error instanceof AttendanceError) {
            throw error;
        }

        // Hai yêu cầu check-in đồng thời: một yêu cầu thắng, yêu cầu còn lại
        // vi phạm UNIQUE KEY (employee_id, work_date).
        if (error.code === "ER_DUP_ENTRY") {
            throw new AttendanceError(
                "Nhân viên đã check-in trong ngày này.",
                409,
                "ALREADY_CHECKED_IN"
            );
        }

        if (
            error.code === "ER_LOCK_DEADLOCK" ||
            error.code === "ER_LOCK_WAIT_TIMEOUT"
        ) {
            throw new AttendanceError(
                "Yêu cầu chấm công đang được xử lý. Vui lòng thử lại sau.",
                409,
                "ATTENDANCE_BUSY"
            );
        }

        throw error;
    } finally {
        connection.release();
    }
};
