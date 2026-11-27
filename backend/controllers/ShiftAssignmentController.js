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
const ASSIGNMENTS_PATH = "/admin/shift-assignments";
const RETURN_PARAM_KEYS = ["view", "date", "status", "search", "department", "shift_id", "start_date", "end_date"];

const isValidDate = (value) => {
    if (!DATE_PATTERN.test(value)) return false;

    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const parseYearMonth = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    const month = match ? Number(match[2]) : 0;
    if (!match || month < 1 || month > 12) return null;
    return { year: Number(match[1]), month, formatted: `${match[1]}-${match[2]}` };
};

const redirectWith = (res, path, { success = null, error = null } = {}) => {
    const params = new URLSearchParams();

    if (success) params.set("success", success);
    if (error) params.set("error", error);

    const query = params.toString();
    if (!query) return res.redirect(path);

    // path có thể đã kèm query (view/date/filter) khi quay lại danh sách.
    res.redirect(`${path}${path.includes("?") ? "&" : "?"}${query}`);
};

// Giữ ngữ cảnh lịch tuần/bộ lọc sau khi lưu, nhưng chỉ cho phép quay lại
// chính trang phân ca và chỉ các tham số biết trước.
const buildReturnPath = (req) => {
    const raw = String(req.body?.return_to || req.query?.return_to || "").trim();
    if (!raw) return ASSIGNMENTS_PATH;

    try {
        const url = new URL(raw, "http://localhost");
        if (url.pathname !== ASSIGNMENTS_PATH) return ASSIGNMENTS_PATH;

        const params = new URLSearchParams();
        for (const key of RETURN_PARAM_KEYS) {
            const value = url.searchParams.get(key);
            if (value) params.set(key, value);
        }

        const query = params.toString();
        return query ? `${ASSIGNMENTS_PATH}?${query}` : ASSIGNMENTS_PATH;
    } catch {
        return ASSIGNMENTS_PATH;
    }
};

const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const getWeekRange = (dateStr) => {
    const target = dateStr && isValidDate(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);
    const [y, m, d] = target.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const jsDay = date.getUTCDay();
    const dbDay = jsDay === 0 ? 7 : jsDay;
    const mon = new Date(date.getTime() - (dbDay - 1) * 86400000);
    const sun = new Date(date.getTime() + (7 - dbDay) * 86400000);
    const prevMon = new Date(mon.getTime() - 7 * 86400000);
    const nextMon = new Date(mon.getTime() + 7 * 86400000);

    return {
        selectedDate: target,
        weekStart: mon.toISOString().slice(0, 10),
        weekEnd: sun.toISOString().slice(0, 10),
        prevWeekDate: prevMon.toISOString().slice(0, 10),
        nextWeekDate: nextMon.toISOString().slice(0, 10)
    };
};

const getSaveErrorMessage = (error, fallback) => {
    if (error.code === "SHIFT_ASSIGNMENT_CONFLICT") {
        const conflict = error.conflict;
        return `Lịch vừa được thay đổi và trùng với ca "${conflict.shift_name}" (${conflict.start_date} - ${conflict.end_date}). Hãy tải lại danh sách rồi chọn khoảng thời gian khác.`;
    }
    if (error.code === "SHIFT_ASSIGNMENT_EMPLOYEE_INACTIVE") {
        return "Nhân viên vừa ngừng hoạt động nên không thể phân ca.";
    }
    if (error.code === "SHIFT_ASSIGNMENT_SHIFT_INACTIVE") {
        return "Ca làm việc vừa ngừng hoạt động nên không thể phân ca.";
    }
    return fallback;
};

const validateAssignment = async (body, excludeId = null, { skipEmployeeCheck = false } = {}) => {
    const data = {
        employee_id: parseId(body.employee_id),
        shift_id: parseId(body.shift_id),
        start_date: String(body.start_date || "").trim(),
        end_date: String(body.end_date || "").trim(),
        note: String(body.note || "").trim().slice(0, 255)
    };

    const errors = [];

    if (!data.employee_id && !skipEmployeeCheck) {
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

    const [employee, shift] = await Promise.all([
        data.employee_id && !skipEmployeeCheck ? ShiftAssignmentModel.findEmployeeById(data.employee_id) : null,
        data.shift_id ? WorkShiftModel.findById(data.shift_id) : null
    ]);

    if (data.employee_id && !skipEmployeeCheck && !employee) {
        errors.push("Nhân viên được chọn không tồn tại.");
    }

    if (data.shift_id) {
        if (!shift) {
            errors.push("Ca làm việc được chọn không tồn tại.");
        } else if (shift.status !== 1) {
            errors.push(`Ca "${shift.shift_name}" đã ngừng hoạt động, không thể phân ca.`);
        }
    }

    if (errors.length === 0 && !skipEmployeeCheck) {
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
        const requestedStartDate = String(req.query.start_date || "").trim();
        const requestedEndDate = String(req.query.end_date || "").trim();
        const startDate = isValidDate(requestedStartDate) ? requestedStartDate : "";
        const endDate = isValidDate(requestedEndDate) ? requestedEndDate : "";
        const filterError = startDate && endDate && startDate > endDate
            ? "Ngày bắt đầu lọc phải trước hoặc bằng ngày kết thúc."
            : null;
        const allowedStatuses = ["", "active", "cancelled"];
        const status = allowedStatuses.includes(String(req.query.status))
            ? String(req.query.status)
            : "active";

        const viewMode = ["calendar", "list"].includes(req.query.view)
            ? req.query.view
            : "calendar";

        const weekInfo = getWeekRange(req.query.date || requestedStartDate);

        const [assignments, employees, activeShifts, departments, stats, scheduleMatrix] = await Promise.all([
            ShiftAssignmentModel.findAll({
                search,
                department,
                shiftId: shiftId || "",
                startDate: filterError ? "" : startDate,
                endDate: filterError ? "" : endDate,
                status
            }),
            ShiftAssignmentModel.getEmployeeOptions(),
            WorkShiftModel.findActive(),
            ShiftAssignmentModel.getDepartments(),
            ShiftAssignmentModel.getStats(),
            ShiftAssignmentModel.getScheduleMatrix({
                startDate: weekInfo.weekStart,
                endDate: weekInfo.weekEnd,
                department,
                shiftId: shiftId || "",
                search
            })
        ]);
        const syncRevision = await WorkShiftModel.getScheduleSyncRevision().catch(() => "");

        // Nhóm assignments theo từng nhân viên (employee_id)
        // Mỗi phần tử là: { employee: { id, employee_code, full_name, department, position },
        //                   primaryAssignment: assignment (active, start_date mới nhất),
        //                   otherAssignments: [assignment...] (các ca còn lại theo thứ tự) }
        const empMap = new Map();
        for (const a of assignments) {
            const empKey = a.employee_id;
            if (!empMap.has(empKey)) {
                empMap.set(empKey, {
                    employee_id: a.employee_id,
                    employee_code: a.employee_code,
                    full_name: a.full_name,
                    department: a.department,
                    assignments: []
                });
            }
            empMap.get(empKey).assignments.push(a);
        }
        // Chuyển thành mảng; mỗi nhóm sắp xếp: active trước, start_date mới nhất trước
        const groupedAssignments = Array.from(empMap.values()).map(group => {
            const sorted = group.assignments.slice().sort((a, b) => {
                if (a.status !== b.status) return a.status === "active" ? -1 : 1;
                return String(b.start_date).localeCompare(String(a.start_date));
            });
            return {
                employee_id: group.employee_id,
                employee_code: group.employee_code,
                full_name: group.full_name,
                department: group.department,
                primaryAssignment: sorted[0],
                otherAssignments: sorted.slice(1),
                totalAssignments: sorted.length
            };
        });

        res.render("assignments", {
            user: req.session.user,
            assignments,
            groupedAssignments,
            employees,
            activeShifts,
            departments,
            stats,
            syncRevision,
            viewMode,
            weekInfo,
            scheduleMatrix,
            filters: {
                search,
                department,
                shiftId: shiftId ? String(shiftId) : "",
                startDate: requestedStartDate,
                endDate: requestedEndDate,
                status,
                view: viewMode,
                date: weekInfo.selectedDate
            },
            weekdayLabels: WEEKDAY_LABELS,
            success: req.query.success || null,
            error: req.query.error || filterError
        });
    } catch (error) {
        console.log("Lỗi tải danh sách phân ca:", error);

        res.render("assignments", {
            user: req.session.user,
            assignments: [],
            groupedAssignments: [],
            employees: [],
            activeShifts: [],
            departments: [],
            stats: {
                activeAssignments: 0,
                cancelledAssignments: 0,
                assignedEmployees: 0
            },
            syncRevision: "",
            viewMode: "calendar",
            weekInfo: getWeekRange(""),
            scheduleMatrix: { days: [], employees: [], matrix: {}, summary: {} },
            filters: { search: "", department: "", shiftId: "", startDate: "", endDate: "", status: "active", view: "calendar", date: "" },
            weekdayLabels: WEEKDAY_LABELS,
            success: null,
            error: "Không thể tải danh sách phân ca. Vui lòng thử lại."
        });
    }
};

const buildCalendarPayload = async (query) => {
    const search = String(query.search || "").trim();
    const department = String(query.department || "").trim();
    const shiftId = parseId(query.shift_id);
    const mode = query.mode === "month" ? "month" : "week";

    let startDate = "";
    let endDate = "";
    let weekInfo = null;

    if (mode === "month") {
        const parsedYm = parseYearMonth(query.month);
        const now = new Date();
        const year = parsedYm ? parsedYm.year : now.getFullYear();
        const month = parsedYm ? parsedYm.month : (now.getMonth() + 1);
        const formattedYm = `${year}-${String(month).padStart(2, "0")}`;
        startDate = `${formattedYm}-01`;
        const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
        endDate = `${formattedYm}-${String(lastDay).padStart(2, "0")}`;
    } else {
        weekInfo = getWeekRange(query.date);
        startDate = weekInfo.weekStart;
        endDate = weekInfo.weekEnd;
    }

    const [scheduleMatrix, activeShifts] = await Promise.all([
        ShiftAssignmentModel.getScheduleMatrix({
            startDate,
            endDate,
            department,
            shiftId: shiftId || "",
            search
        }),
        WorkShiftModel.findActive()
    ]);

    return {
        success: true,
        mode,
        startDate,
        endDate,
        weekInfo,
        activeShifts,
        ...scheduleMatrix
    };
};

export const calendarData = async (req, res) => {
    try {
        res.json(await buildCalendarPayload(req.query));
    } catch (error) {
        console.error("Lỗi lấy dữ liệu lịch phân ca:", error);
        res.status(500).json({ success: false, error: "Không thể lấy dữ liệu lịch phân ca." });
    }
};

// Một request cho cả revision và dữ liệu lịch để đồng bộ tại chỗ.
export const syncState = async (req, res) => {
    try {
        const includeCalendar = String(req.query.include_calendar || "1") !== "0";
        const [revision, calendar] = await Promise.all([
            WorkShiftModel.getScheduleSyncRevision(),
            includeCalendar ? buildCalendarPayload(req.query) : Promise.resolve(null)
        ]);

        res.set("Cache-Control", "no-store").json({
            success: true,
            revision: String(revision || ""),
            calendar
        });
    } catch (error) {
        console.error("Lỗi đồng bộ lịch phân ca:", error);
        res.status(503).set("Cache-Control", "no-store").json({
            success: false,
            error: "Không thể đồng bộ trạng thái lịch phân ca."
        });
    }
};

export const employeeCalendar = async (req, res) => {
    try {
        const employeeId = parseId(req.query.employee_id || req.params.employeeId);
        if (!employeeId) {
            return res.status(400).json({ success: false, error: "Thiếu mã nhân viên hợp lệ." });
        }

        const parsedMonth = parseYearMonth(req.query.month);
        const month = parsedMonth ? parsedMonth.formatted : new Date().toISOString().slice(0, 7);
        const result = await ShiftAssignmentModel.getEmployeeMonthlySchedule(employeeId, month);
        if (!result) {
            return res.status(404).json({ success: false, error: "Không tìm thấy nhân viên." });
        }

        res.json({ success: true, ...result });
    } catch (error) {
        console.error("Lỗi tải lịch nhân viên:", error);
        res.status(500).json({ success: false, error: "Không thể tải lịch phân ca của nhân viên." });
    }
};

export const create = async (req, res) => {
    const returnPath = buildReturnPath(req);

    try {
        const bulkMode = String(req.body.multi_employee_mode) === "1";
        const rawEmployeeIds = req.body.employee_ids === undefined
            ? []
            : Array.isArray(req.body.employee_ids) ? req.body.employee_ids : [req.body.employee_ids];
        const employeeIds = rawEmployeeIds.map(parseId);
        const invalidEmployeeIds = employeeIds.some((id) => !id);
        const { data, errors } = await validateAssignment(req.body, null, {
            skipEmployeeCheck: bulkMode
        });

        if (bulkMode && employeeIds.length === 0) {
            errors.push("Vui lòng chọn ít nhất một nhân viên để phân ca.");
        } else if (bulkMode && invalidEmployeeIds) {
            errors.push("Danh sách nhân viên được chọn không hợp lệ. Vui lòng chọn lại.");
        }

        if (errors.length > 0) {
            return redirectWith(res, returnPath, {
                error: errors.join(" ")
            });
        }

        if (bulkMode) {
            const result = await ShiftAssignmentModel.createMany(data, employeeIds);
            if (result.created.length === 0) {
                const skippedNames = result.skipped.slice(0, 5).map((item) => item.employeeName).join(", ");
                return redirectWith(res, returnPath, {
                    error: `Không phân ca được cho nhân viên nào. Các trường hợp bị bỏ qua: ${skippedNames || "nhân viên không đủ điều kiện"}.`
                });
            }

            const skippedSummary = result.skipped.length
                ? ` Bỏ qua ${result.skipped.length} nhân viên do trùng lịch hoặc không còn hoạt động: ${result.skipped.slice(0, 5).map((item) => item.employeeName).join(", ")}${result.skipped.length > 5 ? "…" : ""}.`
                : "";
            return redirectWith(res, returnPath, {
                success: `Đã phân ca thành công cho ${result.created.length} nhân viên.${skippedSummary}`
            });
        }

        await ShiftAssignmentModel.create(data);

        redirectWith(res, returnPath, {
            success: "Đã phân ca cho nhân viên."
        });
    } catch (error) {
        console.log("Lỗi phân ca:", error);

        redirectWith(res, returnPath, {
            error: getSaveErrorMessage(error, "Không thể lưu phân ca. Vui lòng thử lại.")
        });
    }
};

export const update = async (req, res) => {
    const returnPath = buildReturnPath(req);

    try {
        const assignment = await ShiftAssignmentModel.findById(req.params.id);

        if (!assignment) {
            return redirectWith(res, returnPath, {
                error: "Phân ca không tồn tại."
            });
        }

        const { data, errors } = await validateAssignment(req.body, assignment.id);

        if (errors.length > 0) {
            return redirectWith(res, returnPath, {
                error: errors.join(" ")
            });
        }

        await ShiftAssignmentModel.update(assignment.id, data);

        redirectWith(res, returnPath, {
            success: "Đã điều chỉnh ca làm việc và khoảng thời gian áp dụng."
        });
    } catch (error) {
        console.log("Lỗi cập nhật phân ca:", error);

        redirectWith(res, returnPath, {
            error: getSaveErrorMessage(error, "Không thể cập nhật phân ca. Vui lòng thử lại.")
        });
    }
};

export const adjust = async (req, res) => {
    const isJson = Boolean(req.xhr || req.headers.accept?.includes("application/json") || req.body._format === "json");
    const returnPath = buildReturnPath(req);

    try {
        const assignmentId = parseId(req.params.id);
        const shiftId = parseId(req.body.shift_id);
        const effectiveDate = String(req.body.effective_date || "").trim();
        const returnView = String(req.body.return_view || "").trim();
        const returnDate = String(req.body.return_date || "").trim();
        const errors = [];

        if (!assignmentId) errors.push("Lịch phân ca không hợp lệ.");
        if (!shiftId) errors.push("Vui lòng chọn ca làm việc mới.");
        if (!effectiveDate || !isValidDate(effectiveDate)) errors.push("Ngày hiệu lực không hợp lệ.");

        if (errors.length) {
            if (isJson) {
                return res.status(400).json({ success: false, error: errors.join(" ") });
            }
            return redirectWith(res, returnPath, { error: errors.join(" ") });
        }

        const result = await ShiftAssignmentModel.adjustShift(assignmentId, {
            shift_id: shiftId,
            effective_date: effectiveDate,
            note: String(req.body.note || "").trim().slice(0, 255)
        });

        const successMsg = result.split
            ? `Đã điều chỉnh ca từ ngày ${effectiveDate}; lịch cũ được giữ nguyên đến ngày liền trước.`
            : `Đã cập nhật ca làm việc từ ngày ${effectiveDate}.`;

        if (isJson) {
            return res.json({ success: true, message: successMsg, result });
        }

        let redirectUrl = returnPath;
        // Fallback cho các modal cũ chưa gửi return_to.
        if (redirectUrl === ASSIGNMENTS_PATH && (returnView || returnDate)) {
            const params = new URLSearchParams();
            if (returnView) params.set("view", returnView);
            if (returnDate) params.set("date", returnDate);
            redirectUrl = `${ASSIGNMENTS_PATH}?${params.toString()}`;
        }

        redirectWith(res, redirectUrl, {
            success: successMsg
        });
    } catch (error) {
        console.log("Lỗi điều chỉnh ca làm:", error);
        const messages = {
            SHIFT_ASSIGNMENT_NOT_FOUND: "Lịch phân ca không tồn tại.",
            SHIFT_ASSIGNMENT_NOT_ACTIVE: "Chỉ có thể điều chỉnh lịch đang áp dụng.",
            SHIFT_ASSIGNMENT_INVALID_EFFECTIVE_DATE: "Ngày hiệu lực phải nằm trong khoảng lịch đang áp dụng.",
            SHIFT_ASSIGNMENT_NO_CHANGE: "Ca mới phải khác ca đang áp dụng.",
            SHIFT_ASSIGNMENT_EMPLOYEE_INACTIVE: "Nhân viên đã ngừng hoạt động nên không thể điều chỉnh ca.",
            SHIFT_ASSIGNMENT_SHIFT_INACTIVE: "Ca mới không tồn tại hoặc đã ngừng hoạt động.",
            SHIFT_ASSIGNMENT_CHANGED: "Lịch vừa được thay đổi. Vui lòng tải lại trang rồi thử lại."
        };
        const message = error.code === "SHIFT_ASSIGNMENT_CONFLICT"
            ? `Không thể điều chỉnh vì trùng với ca "${error.conflict.shift_name}" (${error.conflict.start_date} - ${error.conflict.end_date}).`
            : messages[error.code] || "Không thể điều chỉnh ca làm. Vui lòng thử lại.";

        if (isJson) {
            return res.status(400).json({ success: false, error: message });
        }

        redirectWith(res, returnPath, { error: message });
    }
};

export const cancel = async (req, res) => {
    const returnPath = buildReturnPath(req);

    try {
        const assignment = await ShiftAssignmentModel.findById(req.params.id);

        if (!assignment) {
            return redirectWith(res, returnPath, {
                error: "Phân ca không tồn tại."
            });
        }

        if (assignment.status === "cancelled") {
            return redirectWith(res, returnPath, {
                error: "Phân ca này đã được hủy trước đó."
            });
        }

        await ShiftAssignmentModel.cancel(assignment.id);

        redirectWith(res, returnPath, {
            success: `Đã hủy phân ca của "${assignment.full_name}".`
        });
    } catch (error) {
        console.log("Lỗi hủy phân ca:", error);

        redirectWith(res, returnPath, {
            error: "Không thể hủy phân ca. Vui lòng thử lại."
        });
    }
};
