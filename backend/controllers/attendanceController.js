import {
    getRosterForDate,
    getDepartments,
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
import { evaluateAttendance } from "../services/shiftScheduleService.js";
import { writeAttendanceAuditLog } from "../services/attendanceAuditService.js";

export const renderAttendancePage = (req, res) => {
    res.render("admin/attendance", {
        user: req.session.user,
        pageTitle: "Bß║úng chß║Ñm c├┤ng",
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

    console.error("Lß╗ùi chß║Ñm c├┤ng:", error);

    return res.status(500).json({
        success: false,
        code: "ATTENDANCE_SERVER_ERROR",
        message: "Kh├┤ng thß╗â xß╗¡ l├╜ y├¬u cß║ºu chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
    });
};

// Bß║úng chß║Ñm c├┤ng theo ng├áy, bao gß╗ôm cß║ú nh├ón vi├¬n ch╞░a chß║Ñm c├┤ng.
export const getAttendanceData = async (req, res) => {
    try {
        const rawDate = String(req.query.date || "").trim();
        const date = rawDate || getTodayDateString();

        if (!isValidDateString(date)) {
            return res.status(400).json({
                success: false,
                code: "INVALID_DATE",
                message: "Ng├áy chß║Ñm c├┤ng kh├┤ng hß╗úp lß╗ç. ─Éß╗ïnh dß║íng y├¬u cß║ºu: YYYY-MM-DD."
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
        console.error("Lß╗ùi lß║Ñy bß║úng chß║Ñm c├┤ng:", error);

        return res.status(500).json({
            success: false,
            code: "ATTENDANCE_LIST_ERROR",
            message: "Kh├┤ng thß╗â tß║úi bß║úng chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
        });
    }
};

// Chß║Ñm c├┤ng bß║▒ng khu├┤n mß║╖t: server tß╗▒ ─æß╗æi chiß║┐u descriptor vß╗¢i hß╗ô s╞í ─æ├ú l╞░u.
export const faceAttendance = async (req, res) => {
    const body = req.body || {};
    const action = String(body.action || "").trim();
    const workDate = getTodayDateString();

    let matchedEmployee = null;

    if (!isValidAction(action)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_ACTION",
            message: "H├ánh ─æß╗Öng chß║Ñm c├┤ng kh├┤ng hß╗úp lß╗ç."
        });
    }

    if (!isFaceDescriptorUsable(body.descriptor)) {
        return res.status(400).json({
            success: false,
            code: "INVALID_DESCRIPTOR",
            message: "Dß╗» liß╗çu khu├┤n mß║╖t kh├┤ng hß╗úp lß╗ç. Vui l├▓ng thß╗¡ lß║íi."
        });
    }

    const faceLimit = getFaceFailureLimit(req.ip);

    if (faceLimit.blocked) {
        res.set("Retry-After", String(faceLimit.retryAfter));

        return res.status(429).json({
            success: false,
            code: "TOO_MANY_FACE_ATTEMPTS",
            message: `C├│ qu├í nhiß╗üu lß║ºn nhß║¡n diß╗çn thß║Ñt bß║íi. Vui l├▓ng thß╗¡ lß║íi sau ${faceLimit.retryAfter} gi├óy.`
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
                message: "Ch╞░a c├│ hß╗ô s╞í khu├┤n mß║╖t n├áo ─æ╞░ß╗úc ─æ─âng k├╜. Vui l├▓ng ─æ─âng k├╜ khu├┤n mß║╖t hoß║╖c d├╣ng ph╞░╞íng thß╗⌐c thß╗º c├┤ng."
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
                message: "Kh├┤ng nhß║¡n diß╗çn ─æ╞░ß╗úc khu├┤n mß║╖t. Vui l├▓ng thß╗¡ lß║íi hoß║╖c d├╣ng ph╞░╞íng thß╗⌐c thß╗º c├┤ng."
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
                message: `Vui l├▓ng ─æß╗úi ${cooldown} gi├óy tr╞░ß╗¢c khi thß╗▒c hiß╗çn lß║íi.`
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
                ? `Check-in th├ánh c├┤ng${timeLabel ? ` l├║c ${timeLabel}` : ""}.`
                : `Check-out th├ánh c├┤ng${timeLabel ? ` l├║c ${timeLabel}` : ""}.`,
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

// Ph╞░╞íng thß╗⌐c dß╗▒ ph├▓ng khi camera/nhß║¡n diß╗çn kh├┤ng hoß║ít ─æß╗Öng.
// Chß╗ë quß║ún trß╗ï vi├¬n ─æ╞░ß╗úc thao t├íc v├á bß║»t buß╗Öc nhß║¡p l├╜ do.
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
            message: "H├ánh ─æß╗Öng chß║Ñm c├┤ng kh├┤ng hß╗úp lß╗ç."
        });
    }

    if (!employeeId) {
        return res.status(400).json({
            success: false,
            code: "INVALID_EMPLOYEE",
            message: "Vui l├▓ng chß╗ìn nh├ón vi├¬n."
        });
    }

    if (reason.length < 5 || reason.length > 255) {
        return res.status(400).json({
            success: false,
            code: "INVALID_REASON",
            message: "Vui l├▓ng nhß║¡p l├╜ do chß║Ñm c├┤ng thß╗º c├┤ng (tß╗½ 5 ─æß║┐n 255 k├╜ tß╗▒)."
        });
    }

    try {
        const employee = await findEmployeeFullById(employeeId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                code: "EMPLOYEE_NOT_FOUND",
                message: "Kh├┤ng t├¼m thß║Ñy nh├ón vi├¬n."
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
                message: `Vui l├▓ng ─æß╗úi ${cooldown} gi├óy tr╞░ß╗¢c khi thß╗▒c hiß╗çn lß║íi.`
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
                ? `─É├ú ghi nhß║¡n check-in thß╗º c├┤ng cho ${manualEmployee.full_name}.`
                : `─É├ú ghi nhß║¡n check-out thß╗º c├┤ng cho ${manualEmployee.full_name}.`,
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
        errors.push("Vui l├▓ng chß╗ìn nh├ón vi├¬n.");
    }

    if (!isValidDate(data.work_date)) {
        errors.push("Ng├áy chß║Ñm c├┤ng kh├┤ng hß╗úp lß╗ç.");
    }

    for (const [field, label] of [["check_in", "giß╗¥ v├áo"], ["check_out", "giß╗¥ ra"]]) {
        if (data[field] && !TIME_PATTERN.test(data[field])) {
            errors.push(`─Éß╗ïnh dß║íng ${label} kh├┤ng hß╗úp lß╗ç.`);
        }
    }

    const automaticStatus = data.status === "auto";
    if (!automaticStatus && !VALID_STATUSES.has(data.status)) {
        errors.push("Vui l├▓ng chß╗ìn trß║íng th├íi chß║Ñm c├┤ng hß╗úp lß╗ç.");
    }

    if (data.status === "absent" && (data.check_in || data.check_out)) {
        errors.push("Bß║ún ghi vß║»ng mß║╖t kh├┤ng ─æ╞░ß╗úc c├│ giß╗¥ v├áo hoß║╖c giß╗¥ ra.");
    } else if (data.status !== "absent" && !data.check_in) {
        errors.push("Vui l├▓ng nhß║¡p giß╗¥ v├áo cho bß║ún ghi c├│ mß║╖t.");
    }

    if (data.check_out && !data.check_in) {
        errors.push("Cß║ºn c├│ giß╗¥ v├áo tr╞░ß╗¢c khi nhß║¡p giß╗¥ ra.");
    } else if (data.check_in && data.check_out && data.check_out <= data.check_in) {
        errors.push("Giß╗¥ ra phß║úi sau giß╗¥ v├áo.");
    }

    if (errors.length === 0 && !excludeId) {
        const employee = await AttendanceModel.findEmployeeById(data.employee_id);
        if (!employee) {
            errors.push("Nh├ón vi├¬n ─æ╞░ß╗úc chß╗ìn kh├┤ng tß╗ôn tß║íi.");
        }
    }

    if (errors.length === 0) {
        const duplicate = await AttendanceModel.findByEmployeeDate(
            data.employee_id,
            data.work_date,
            excludeId
        );
        if (duplicate) {
            errors.push("Nh├ón vi├¬n ─æ├ú c├│ dß╗» liß╗çu chß║Ñm c├┤ng trong ng├áy n├áy.");
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
        console.error("Lß╗ùi tß║úi bß║úng chß║Ñm c├┤ng:", error);
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
            error: "Kh├┤ng thß╗â tß║úi dß╗» liß╗çu chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
        });
    }
};

export const refresh = async (_req, res) => {
    try {
        const { records, employees, stats } = await getAttendancePageData();

        return res.render("admin/attendanceRows", { records }, (renderError, rowsHtml) => {
            if (renderError) {
                console.error("Lß╗ùi tß║ío nß╗Öi dung l├ám mß╗¢i bß║úng chß║Ñm c├┤ng:", renderError);
                return res.status(500).json({
                    error: "Kh├┤ng thß╗â cß║¡p nhß║¡t bß║úng chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
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
        console.error("Lß╗ùi ─æß╗ông bß╗Ö bß║úng chß║Ñm c├┤ng:", error);
        return res.status(500).json({
            error: "Kh├┤ng thß╗â ─æß╗ông bß╗Ö dß╗» liß╗çu chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
        });
    }
};

export const history = async (req, res) => {
    const employeeId = parseId(req.params.employeeId);
    if (!employeeId) {
        return res.status(400).json({ error: "M├ú nh├ón vi├¬n kh├┤ng hß╗úp lß╗ç." });
    }

    try {
        const [records, employee] = await Promise.all([
            AttendanceModel.findHistoryByEmployee(employeeId),
            AttendanceModel.findEmployeeDetailsById(employeeId)
        ]);

        if (!employee) {
            return res.status(404).json({ error: "Kh├┤ng t├¼m thß║Ñy nh├ón vi├¬n." });
        }
        return res.json({ employeeId, records });
    } catch (error) {
        console.error("Lß╗ùi tß║úi lß╗ïch sß╗¡ chß║Ñm c├┤ng:", error);
        return res.status(500).json({ error: "Kh├┤ng thß╗â tß║úi lß╗ïch sß╗¡ chß║Ñm c├┤ng." });
    }
};

export const exportCsv = async (req, res) => {
    try {
        const [rows] = await AttendanceModel.exportAllHistory(
            String(req.query.from_date || "").trim() || null,
            String(req.query.to_date || "").trim() || null
        );
        const data = [
            ["M├ú nh├ón vi├¬n", "Nh├ón vi├¬n", "Ng├áy", "Giß╗¥ v├áo", "Giß╗¥ ra", "Trß║íng th├íi"],
            ...rows.map((row) => [
                row.employee_code,
                row.full_name,
                row.work_date,
                row.check_in || "",
                row.check_out || "",
                { present: "─É├║ng giß╗¥", late: "─Éi muß╗Ön", absent: "Vß║»ng mß║╖t" }[row.status] || row.status
            ])
        ];
        const csv = "\uFEFF" + data.map((row) =>
            row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
        ).join("\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="lich-su-cham-cong.csv"');
        return res.send(csv);
    } catch (error) {
        console.error("Lß╗ùi xuß║Ñt CSV lß╗ïch sß╗¡ chß║Ñm c├┤ng:", error);
        return res.status(500).json({ error: "Kh├┤ng thß╗â xuß║Ñt CSV lß╗ïch sß╗¡ chß║Ñm c├┤ng." });
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
            error: "Khoß║úng ng├áy b├ío c├ío kh├┤ng hß╗úp lß╗ç."
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
        console.error("Lß╗ùi tß║úi b├ío c├ío chß║Ñm c├┤ng:", error);
        return res.status(500).render("admin/attendance-report", {
            user: req.session.user,
            filters: { fromDate, toDate },
            stats: getEmptyReportStats(),
            employees: [],
            attendanceRate: 0,
            success: null,
            error: "Kh├┤ng thß╗â tß║úi b├ío c├ío chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi."
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
        return redirectWith(res, { success: "─É├ú th├¬m dß╗» liß╗çu chß║Ñm c├┤ng." });
    } catch (error) {
        console.error("Lß╗ùi th├¬m dß╗» liß╗çu chß║Ñm c├┤ng:", error);
        const message = error.code === "ER_DUP_ENTRY"
            ? "Nh├ón vi├¬n ─æ├ú c├│ dß╗» liß╗çu chß║Ñm c├┤ng trong ng├áy n├áy."
            : "Kh├┤ng thß╗â l╞░u dß╗» liß╗çu chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi.";
        return redirectWith(res, { error: message });
    }
};

export const update = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) {
            return redirectWith(res, { error: "M├ú bß║ún ghi chß║Ñm c├┤ng kh├┤ng hß╗úp lß╗ç." });
        }

        const record = await AttendanceModel.findById(id);
        if (!record) {
            return redirectWith(res, { error: "Bß║ún ghi chß║Ñm c├┤ng kh├┤ng tß╗ôn tß║íi." });
        }

        const { data, errors } = await validateRecord({
            ...req.body,
            employee_id: record.employee_id
        }, id);
        if (errors.length > 0) {
            return redirectWith(res, { error: errors.join(" ") });
        }

        await AttendanceModel.update(id, data);
        return redirectWith(res, { success: "─É├ú cß║¡p nhß║¡t dß╗» liß╗çu chß║Ñm c├┤ng." });
    } catch (error) {
        console.error("Lß╗ùi cß║¡p nhß║¡t dß╗» liß╗çu chß║Ñm c├┤ng:", error);
        const message = error.code === "ER_DUP_ENTRY"
            ? "Nh├ón vi├¬n ─æ├ú c├│ dß╗» liß╗çu chß║Ñm c├┤ng trong ng├áy n├áy."
            : "Kh├┤ng thß╗â cß║¡p nhß║¡t dß╗» liß╗çu chß║Ñm c├┤ng. Vui l├▓ng thß╗¡ lß║íi.";
        return redirectWith(res, { error: message });
    }
};