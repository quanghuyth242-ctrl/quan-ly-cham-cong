import * as AttendanceRequestModel from "../models/AttendanceRequestModel.js";
import {
    buildAttendanceSchedule,
    getShiftSchedulesForEmployeeRange
} from "../services/shiftScheduleService.js";
import { writeAttendanceAuditLog } from "../services/attendanceAuditService.js";
import { notifyRequestsChanged } from "../services/realtimeService.js";

const isValidDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isValidTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");

const redirect = (res, values) => {
    const query = new URLSearchParams(values);
    return res.redirect(`/admin/requests?${query.toString()}`);
};

const FILTER_QUERY_KEYS = ["q", "status", "type", "dateField", "dateFrom", "dateTo"];
const VALID_TABS = ["explanation", "business_trip", "overtime", "list"];

// Giữ lại tab và các filter khi redirect sau khi tạo/duyệt đơn.
const getReturnQuery = (req) => {
    const query = { tab: VALID_TABS.includes(req.query?.tab) ? req.query.tab : "list" };
    for (const key of FILTER_QUERY_KEYS) {
        const value = req.query?.[key];
        if (typeof value === "string" && value.trim() && value.length <= 50) {
            query[key] = value.trim();
        }
    }
    return query;
};

const toWorkdays = (request, schedules) => {
    const byDate = [];
    const current = new Date(`${request.from_date}T00:00:00Z`);
    const last = new Date(`${request.to_date}T00:00:00Z`);

    while (current <= last) {
        const date = current.toISOString().slice(0, 10);
        const assignment = schedules.find((schedule) => date >= schedule.start_date && date <= schedule.end_date);
        if (assignment) {
            const dailySchedule = buildAttendanceSchedule(assignment, date);
            if (dailySchedule.isWorkingDay && assignment.morning_start && assignment.afternoon_end) {
                byDate.push({ date, start: assignment.morning_start, end: assignment.afternoon_end });
            }
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return byDate;
};

const EXPLANATION_CATEGORY_LABELS = {
    late: "Đi muộn",
    early_leave: "Về sớm",
    missing_checkin: "Quên check-in",
    missing_checkout: "Quên check-out",
    wrong_record: "Sai dữ liệu chấm công",
    other: "Khác"
};

const parseRequestDate = (value) => {
    if (!value) return null;
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
};

const buildDurationLabel = (createdAt, finishedAt) => {
    const start = parseRequestDate(createdAt);
    const end = parseRequestDate(finishedAt);
    if (!start || !end || end < start) return "";
    const minutes = Math.max(1, Math.round((end - start) / 60000));
    if (minutes < 60) return `Xử lý trong ${minutes} phút`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) return `Xử lý trong ${hours} giờ${restMinutes ? ` ${restMinutes} phút` : ""}`;
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `Xử lý trong ${days} ngày${restHours ? ` ${restHours} giờ` : ""}`;
};

// Lịch sử trạng thái được suy từ các cột có sẵn nên không cần migrate database.
const buildStatusTimeline = (item, reviewerLabel) => {
    const hasEmployeeStep = ["business_trip", "overtime"].includes(item.request_type)
        && (item.status === "awaiting_employee" || Boolean(item.employee_response));
    const steps = [{
        key: "submitted",
        label: "Đơn được gửi",
        time: item.created_date || null,
        actor: item.created_by || item.employee_name || "Hệ thống",
        note: "",
        state: "done",
        tone: "primary"
    }];

    if (hasEmployeeStep) {
        const accepted = item.employee_response === "accepted";
        const rejectedByEmployee = item.employee_response === "rejected";
        steps.push({
            key: "employee",
            label: rejectedByEmployee ? "Nhân viên từ chối" : accepted ? "Nhân viên đã xác nhận" : "Chờ nhân viên xác nhận",
            time: item.employee_responded_date || null,
            actor: rejectedByEmployee || accepted ? item.employee_name || null : null,
            note: item.employee_response_note || "",
            state: rejectedByEmployee ? "error" : accepted ? "done" : "current",
            tone: rejectedByEmployee ? "error" : accepted ? "success" : "warning"
        });
    }

    const hasAdminReview = Boolean(item.reviewed_at || item.reviewed_by || item.review_note);
    if (hasAdminReview) {
        const rejectedByAdmin = item.status === "rejected";
        steps.push({
            key: "review",
            label: rejectedByAdmin ? "Admin từ chối" : "Admin phê duyệt",
            time: item.reviewed_date || null,
            actor: reviewerLabel || "Admin",
            note: item.review_note || "",
            state: rejectedByAdmin ? "error" : "done",
            tone: rejectedByAdmin ? "error" : "success"
        });
    } else if (!hasEmployeeStep) {
        steps.push({
            key: "review",
            label: "Chờ admin phê duyệt",
            time: null,
            actor: null,
            note: "",
            state: "current",
            tone: "warning"
        });
    }
    return steps;
};

const mapRequestItem = (item) => {
    const explanationCategory = item.request_type === "explanation"
        ? EXPLANATION_CATEGORY_LABELS[item.category] || "Khác"
        : null;
    const hasEmployeeStep = ["business_trip", "overtime"].includes(item.request_type)
        && (item.status === "awaiting_employee" || Boolean(item.employee_response));
    const reviewerLabel = item.reviewer_name || (item.reviewed_by ? `Người dùng #${item.reviewed_by}` : null);
    const statusHint = item.status === "pending" ? "Chờ admin phê duyệt"
        : item.status === "awaiting_employee" ? "Chờ nhân viên xác nhận"
        : item.status === "approved" ? (hasEmployeeStep ? "Đã xác nhận bởi nhân viên" : "Đã hoàn tất phê duyệt")
        : item.status === "rejected" ? (item.employee_response === "rejected" ? "Nhân viên đã từ chối" : "Admin đã từ chối")
        : "";
    const statusTone = item.status === "approved" ? "success"
        : item.status === "rejected" ? "error" : "warning";
    const finishedAt = item.employee_responded_date || item.reviewed_date || null;

    return {
        ...item,
        code: item.request_code,
        type: item.request_type,
        typeLabel: explanationCategory ? `Giải trình · ${explanationCategory}` : {
            business_trip: "Công tác",
            overtime: "Tăng ca",
            leave: {
                annual: "Nghỉ phép năm",
                sick: "Nghỉ ốm",
                unpaid: "Nghỉ không lương",
                personal: "Nghỉ việc riêng"
            }[item.category] || "Nghỉ phép",
            resignation: "Nghỉ việc",
            explanation: "Giải trình"
        }[item.request_type] || item.request_type,
        categoryLabel: explanationCategory || "",
        subject: item.request_type === "explanation" ? (item.destination || "") : "",
        employeeName: item.employee_name,
        employeeId: item.employee_code,
        fromDate: item.from_date,
        toDate: item.to_date,
        timeLabel: item.overtime_start_time && item.overtime_end_time
            ? `${item.overtime_start_time}–${item.overtime_end_time}`
            : "",
        statusLabel: item.status === "awaiting_employee" ? "Chờ nhân viên xác nhận"
            : item.status === "rejected" && item.employee_response === "rejected" ? "Nhân viên từ chối"
            : { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" }[item.status],
        statusHint,
        statusTone,
        durationLabel: buildDurationLabel(item.created_date, finishedAt),
        timeline: buildStatusTimeline(item, reviewerLabel),
        createdAt: item.created_date,
        reviewedAt: item.reviewed_date || null,
        reviewerName: reviewerLabel,
        reviewNote: item.review_note || null,
        employeeResponseNote: item.employee_response_note || null,
        canReview: item.status === "pending"
    };
};

export const index = async (req, res) => {
    const activeTab = VALID_TABS.includes(req.query.tab) ? req.query.tab : "list";
    try {
        const [requests, employees] = await Promise.all([
            AttendanceRequestModel.findAll(),
            AttendanceRequestModel.getEmployees()
        ]);
        const stats = {
            total: requests.length,
            pending: requests.filter((item) => ["pending", "awaiting_employee"].includes(item.status)).length,
            awaitingEmployee: requests.filter((item) => item.status === "awaiting_employee").length,
            approved: requests.filter((item) => item.status === "approved").length,
            rejected: requests.filter((item) => item.status === "rejected").length
        };
        const mappedRequests = requests.map(mapRequestItem);
        const explanationRequests = mappedRequests.filter((item) => item.type === "explanation");
        return res.render("requests/index", {
            user: req.session.user,
            success: req.query.success || null,
            error: req.query.error || null,
            activeTab,
            requests: mappedRequests,
            explanationRequests,
            explanationStats: {
                total: explanationRequests.length,
                pending: explanationRequests.filter((item) => item.status === "pending").length,
                approved: explanationRequests.filter((item) => item.status === "approved").length,
                rejected: explanationRequests.filter((item) => item.status === "rejected").length
            },
            employees,
            stats
        });
    } catch (error) {
        console.error("Lỗi tải danh sách đơn nhân sự:", error);
        return res.status(500).render("requests/index", {
            user: req.session.user,
            success: null,
            error: "Không thể tải dữ liệu đơn. Vui lòng thử lại.",
            activeTab,
            requests: [],
            explanationRequests: [],
            explanationStats: { total: 0, pending: 0, approved: 0, rejected: 0 },
            employees: [],
            stats: { total: 0, pending: 0, awaitingEmployee: 0, approved: 0, rejected: 0 }
        });
    }
};

export const employeeLeaveForm = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn nghỉ.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) {
            return res.status(403).render("requests/employeeLeave", {
                user: req.session.user, employee: null, requests: [], error: "Tài khoản chưa được liên kết với hồ sơ nhân viên. Vui lòng liên hệ quản trị viên.", success: null
            });
        }
        const requests = await AttendanceRequestModel.findEmployeeLeaveRequests(employee.id);
        return res.render("requests/employeeLeave", { user: req.session.user, employee, requests, error: req.query.error || null, success: req.query.success || null });
    } catch (error) {
        console.error("Lỗi tải đơn nghỉ của nhân viên:", error);
        return res.status(500).send("Không thể tải trang đơn nghỉ.");
    }
};

export const createEmployeeLeave = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn nghỉ.");
    const category = String(req.body.category || "").trim();
    const type = category === "resignation" ? "resignation" : "leave";
    const fromDate = String(req.body.from_date || "").trim();
    const toDate = String(req.body.to_date || "").trim();
    const reason = String(req.body.reason || "").trim();
    const fail = (message) => res.redirect(`/requests/leave?error=${encodeURIComponent(message)}`);
    if (!["annual", "sick", "unpaid", "personal", "resignation"].includes(category)) return fail("Vui lòng chọn loại đơn nghỉ.");
    if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) return fail("Khoảng ngày nghỉ không hợp lệ.");
    const spanDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (spanDays > 366) return fail("Mỗi đơn không vượt quá 366 ngày.");
    if (reason.length < 10 || reason.length > 5000) return fail("Lý do cần từ 10 đến 5.000 ký tự.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) return fail("Tài khoản chưa được liên kết với hồ sơ nhân viên.");
        const result = await AttendanceRequestModel.createEmployeeLeave({
            employeeId: employee.id, type, category, fromDate, toDate, reason,
            createdBy: req.session.user.username
        });
        if (!result.success && result.reason === "overlap") return fail("Khoảng ngày bị trùng với đơn hoặc trạng thái chấm công đã ghi nhận.");
        return res.redirect(`/requests/leave?success=${encodeURIComponent(`Đã gửi đơn ${result.requestCode}, đang chờ admin duyệt.`)}`);
    } catch (error) {
        console.error("Lỗi gửi đơn nghỉ của nhân viên:", error);
        return fail("Không thể gửi đơn nghỉ. Vui lòng thử lại.");
    }
};

export const createBusinessTrip = async (req, res) => {
    const employeeId = Number(req.body.employee_id);
    const fromDate = String(req.body.from_date || "").trim();
    const toDate = String(req.body.to_date || "").trim();
    const destination = String(req.body.destination || "").trim();
    const reason = String(req.body.reason || "").trim();

    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
        return redirect(res, { tab: "business_trip", error: "Vui lòng chọn nhân viên đi công tác." });
    }
    if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) {
        return redirect(res, { tab: "business_trip", error: "Khoảng ngày công tác không hợp lệ." });
    }
    const spanDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (spanDays > 366) return redirect(res, { tab: "business_trip", error: "Mỗi đơn công tác không vượt quá 366 ngày." });
    if (!destination || destination.length > 255) {
        return redirect(res, { tab: "business_trip", error: "Vui lòng nhập địa điểm công tác (không quá 255 ký tự)." });
    }
    if (reason.length < 10 || reason.length > 5000) {
        return redirect(res, { tab: "business_trip", error: "Lý do công tác cần từ 10 đến 5.000 ký tự." });
    }

    try {
        const employees = await AttendanceRequestModel.getEmployees();
        if (!employees.some((employee) => Number(employee.id) === employeeId)) {
            return redirect(res, { tab: "business_trip", error: "Không tìm thấy nhân viên đang hoạt động." });
        }
        const assignments = await getShiftSchedulesForEmployeeRange(employeeId, fromDate, toDate);
        const schedules = toWorkdays({ from_date: fromDate, to_date: toDate }, assignments);
        if (schedules.length === 0) {
            return redirect(res, { tab: "business_trip", error: "Nhân viên chưa có ngày làm việc được phân ca trong khoảng công tác." });
        }
        const request = await AttendanceRequestModel.createBusinessTrip({
            employeeId,
            fromDate,
            toDate,
            destination,
            reason,
            schedules,
            requireEmployeeConsent: true,
            createdBy: req.session.user?.username,
            reviewerId: req.session.user?.id
        });
        if (!request.success && request.reason === "overlap") {
            return redirect(res, { tab: "business_trip", error: "Khoảng công tác bị trùng với đơn hoặc trạng thái ngày công đã ghi nhận." });
        }
        return redirect(res, { tab: "list", success: `Đã gửi điều động công tác ${request.requestCode}; đang chờ nhân viên xác nhận. Chấm công sẽ cập nhật sau khi nhân viên đồng ý.` });
    } catch (error) {
        console.error("Lỗi tạo đơn công tác:", error);
        return redirect(res, { tab: "business_trip", error: "Không thể tạo đơn công tác. Vui lòng thử lại." });
    }
};

export const createOvertime = async (req, res) => {
    const employeeId = Number(req.body.employee_id);
    const fromDate = String(req.body.from_date || "").trim();
    const toDate = String(req.body.to_date || "").trim();
    const startTime = String(req.body.start_time || "").trim();
    const endTime = String(req.body.end_time || "").trim();
    const reason = String(req.body.reason || "").trim();

    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
        return redirect(res, { tab: "overtime", error: "Vui lòng chọn nhân viên tăng ca." });
    }
    if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) {
        return redirect(res, { tab: "overtime", error: "Khoảng ngày tăng ca không hợp lệ." });
    }
    if (!isValidTime(startTime) || !isValidTime(endTime) || endTime <= startTime) {
        return redirect(res, { tab: "overtime", error: "Khung giờ tăng ca không hợp lệ; giờ kết thúc phải sau giờ bắt đầu trong cùng ngày." });
    }
    const spanDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (spanDays > 366) return redirect(res, { tab: "overtime", error: "Mỗi đơn tăng ca không vượt quá 366 ngày." });
    if (reason.length < 10 || reason.length > 5000) {
        return redirect(res, { tab: "overtime", error: "Nội dung tăng ca cần từ 10 đến 5.000 ký tự." });
    }

    try {
        const employees = await AttendanceRequestModel.getEmployees();
        if (!employees.some((employee) => Number(employee.id) === employeeId)) {
            return redirect(res, { tab: "overtime", error: "Không tìm thấy nhân viên đang hoạt động." });
        }
        const result = await AttendanceRequestModel.createOvertime({
            employeeId,
            fromDate,
            toDate,
            startTime,
            endTime,
            reason,
            createdBy: req.session.user?.username,
            reviewerId: req.session.user?.id,
            requireEmployeeConsent: true
        });
        if (!result.success && result.reason === "overlap") {
            return redirect(res, { tab: "overtime", error: "Không thể gửi đơn tăng ca trùng với đơn tăng ca khác, ngày nghỉ hoặc công tác đã ghi nhận." });
        }
        return redirect(res, {
            tab: "list",
            success: `Đã gửi đơn tăng ca ${result.requestCode} (${startTime}–${endTime}); đang chờ nhân viên xác nhận. Trạng thái sẽ cập nhật sau khi nhân viên đồng ý.`
        });
    } catch (error) {
        console.error("Lỗi gửi đơn tăng ca:", error);
        return redirect(res, { tab: "overtime", error: "Không thể gửi đơn tăng ca. Vui lòng thử lại." });
    }
};

export const employeeOvertimeForm = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn tại đây.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) {
            return res.status(403).render("requests/employeeOvertime", {
                user: req.session.user, employee: null, requests: [], error: "Tài khoản chưa được liên kết với hồ sơ nhân viên. Vui lòng liên hệ quản trị viên.", success: null
            });
        }
        const requests = await AttendanceRequestModel.findByEmployee(employee.id);
        return res.render("requests/employeeOvertime", { user: req.session.user, employee, requests, error: req.query.error || null, success: req.query.success || null });
    } catch (error) {
        console.error("Lỗi tải đơn tăng ca cá nhân:", error);
        return res.status(500).send("Không thể tải trang đơn tăng ca.");
    }
};

export const employeeBusinessTripForm = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn tại đây.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) {
            return res.status(403).render("requests/employeeBusinessTrip", {
                user: req.session.user, employee: null, requests: [], error: "Tài khoản chưa được liên kết với hồ sơ nhân viên. Vui lòng liên hệ quản trị viên.", success: null
            });
        }
        const requests = await AttendanceRequestModel.findByEmployee(employee.id, "business_trip");
        return res.render("requests/employeeBusinessTrip", { user: req.session.user, employee, requests, error: req.query.error || null, success: req.query.success || null });
    } catch (error) {
        console.error("Lỗi tải đơn công tác cá nhân:", error);
        return res.status(500).send("Không thể tải trang đơn công tác.");
    }
};

export const createEmployeeBusinessTrip = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn tại đây.");
    const fromDate = String(req.body.from_date || "").trim();
    const toDate = String(req.body.to_date || "").trim();
    const destination = String(req.body.destination || "").trim();
    const reason = String(req.body.reason || "").trim();
    const fail = (message) => res.redirect(`/requests/business-trip?error=${encodeURIComponent(message)}`);
    if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) return fail("Khoảng ngày công tác không hợp lệ.");
    const spanDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (spanDays > 366) return fail("Mỗi đơn công tác không vượt quá 366 ngày.");
    if (!destination || destination.length > 255) return fail("Vui lòng nhập địa điểm công tác, tối đa 255 ký tự.");
    if (reason.length < 10 || reason.length > 5000) return fail("Lý do cần từ 10 đến 5.000 ký tự.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) return fail("Tài khoản chưa được liên kết với hồ sơ nhân viên.");
        const result = await AttendanceRequestModel.createBusinessTrip({
            employeeId: employee.id, fromDate, toDate, destination, reason,
            createdBy: req.session.user.username, approveImmediately: false
        });
        if (!result.success && result.reason === "overlap") return fail("Khoảng ngày bị trùng với đơn hoặc trạng thái ngày công đã ghi nhận.");
        return res.redirect(`/requests/business-trip?success=${encodeURIComponent(`Đã gửi đơn ${result.requestCode}, đang chờ admin duyệt.`)}`);
    } catch (error) {
        console.error("Lỗi gửi đơn công tác của nhân viên:", error);
        return fail("Không thể gửi đơn công tác. Vui lòng thử lại.");
    }
};

export const createEmployeeOvertime = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể gửi đơn tại đây.");
    const fromDate = String(req.body.from_date || "").trim();
    const toDate = String(req.body.to_date || "").trim();
    const startTime = String(req.body.start_time || "").trim();
    const endTime = String(req.body.end_time || "").trim();
    const reason = String(req.body.reason || "").trim();
    const fail = (message) => res.redirect(`/requests/overtime?error=${encodeURIComponent(message)}`);
    if (!isValidDate(fromDate) || !isValidDate(toDate) || toDate < fromDate) return fail("Khoảng ngày tăng ca không hợp lệ.");
    if (!isValidTime(startTime) || !isValidTime(endTime) || endTime <= startTime) return fail("Khung giờ tăng ca không hợp lệ; giờ kết thúc phải sau giờ bắt đầu.");
    const spanDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
    if (spanDays > 366) return fail("Mỗi đơn tăng ca không vượt quá 366 ngày.");
    if (reason.length < 10 || reason.length > 5000) return fail("Lý do cần từ 10 đến 5.000 ký tự.");
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) return fail("Tài khoản chưa được liên kết với hồ sơ nhân viên.");
        const result = await AttendanceRequestModel.createOvertime({ employeeId: employee.id, fromDate, toDate, startTime, endTime, reason, createdBy: req.session.user.username });
        if (!result.success && result.reason === "overlap") return fail("Khoảng ngày bị trùng với đơn hoặc trạng thái chấm công đã ghi nhận.");
        return res.redirect(`/requests/overtime?success=${encodeURIComponent(`Đã gửi đơn ${result.requestCode}, đang chờ admin duyệt.`)}`);
    } catch (error) {
        console.error("Lỗi gửi đơn tăng ca của nhân viên:", error);
        return fail("Không thể gửi đơn tăng ca. Vui lòng thử lại.");
    }
};

export const respondToAdminRequest = async (req, res) => {
    if (req.session.user?.role !== "employee") return res.status(403).send("Chỉ nhân viên mới có thể phản hồi đơn.");
    const id = Number(req.params.id);
    const accepted = req.body.decision === "accept";
    const responseNote = String(req.body.response_note || "").trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !["accept", "reject"].includes(req.body.decision)) {
        return res.status(400).send("Yêu cầu phản hồi đơn không hợp lệ.");
    }
    let responsePath = "/requests/overtime";
    try {
        const employee = await AttendanceRequestModel.findEmployeeForUser(req.session.user);
        if (!employee) return res.status(403).send("Tài khoản chưa được liên kết với hồ sơ nhân viên.");
        const request = await AttendanceRequestModel.findById(id);
        if (!request || Number(request.employee_id) !== Number(employee.id)) {
            return res.status(404).send("Không tìm thấy đơn được gửi cho tài khoản này.");
        }
        if (!["business_trip", "overtime"].includes(request.request_type)) {
            return res.status(400).send("Loại đơn này không yêu cầu xác nhận của nhân viên.");
        }
        responsePath = request.request_type === "overtime" ? "/requests/overtime" : "/requests/business-trip";
        if (!accepted && (responseNote.length < 10 || responseNote.length > 500)) {
            return res.redirect(`${responsePath}?error=${encodeURIComponent("Lý do từ chối cần từ 10 đến 500 ký tự.")}`);
        }

        let schedules = [];
        if (accepted && request.request_type === "business_trip") {
            const assignments = await getShiftSchedulesForEmployeeRange(employee.id, request.from_date, request.to_date);
            schedules = toWorkdays(request, assignments);
        }
        const result = await AttendanceRequestModel.employeeRespond({ id, employeeId: employee.id, accepted, responseNote: accepted ? null : responseNote, schedules });
        if (!result.success) {
            const message = result.reason === "already_responded" ? "Đơn này đã được phản hồi trước đó."
                : result.reason === "overlap" ? "Không thể xác nhận vì ngày công bị trùng với một đơn đã duyệt khác."
                : result.reason === "no_scheduled_days" ? "Không thể ghi nhận vì bạn chưa có ngày làm việc được phân ca trong khoảng công tác."
                : "Không thể phản hồi đơn này.";
            return res.redirect(`${responsePath}?error=${encodeURIComponent(message)}`);
        }
        const message = accepted
            ? `Bạn đã đồng ý đơn ${request.request_code}; hệ thống đã cập nhật chấm công cho ${result.appliedDays} ngày.`
            : `Bạn đã từ chối đơn ${request.request_code}; hệ thống không cập nhật chấm công.`;
        return res.redirect(`${responsePath}?success=${encodeURIComponent(message)}`);
    } catch (error) {
        console.error("Lỗi nhân viên phản hồi đơn:", error);
        return res.redirect(`${responsePath}?error=${encodeURIComponent("Không thể phản hồi đơn. Vui lòng thử lại.")}`);
    }
};

export const reviewRequest = async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.params.decision === "approve" ? "approved" : req.params.decision === "reject" ? "rejected" : null;
    const reviewNote = String(req.body.review_note || "").trim();
    const returnQuery = getReturnQuery(req);
    const fail = (message) => redirect(res, { ...returnQuery, error: message });
    if (!Number.isSafeInteger(id) || id <= 0 || !decision) {
        return fail("Yêu cầu duyệt đơn không hợp lệ.");
    }
    if (reviewNote.length > 500) {
        return fail("Ghi chú phê duyệt không được quá 500 ký tự.");
    }
    if (decision === "rejected" && reviewNote.length < 10) {
        return fail("Lý do từ chối cần từ 10 đến 500 ký tự.");
    }

    try {
        const request = await AttendanceRequestModel.findById(id);
        if (!request) return fail("Không tìm thấy đơn cần duyệt.");
        if (request.status !== "pending") return fail("Đơn này đã được xử lý trước đó.");

        let schedules = [];
        if (decision === "approved" && ["business_trip", "leave"].includes(request.request_type)) {
            const assignments = await getShiftSchedulesForEmployeeRange(request.employee_id, request.from_date, request.to_date);
            schedules = toWorkdays(request, assignments);
        }

        const result = await AttendanceRequestModel.review({
            id,
            decision,
            reviewerId: req.session.user?.id,
            reviewNote: reviewNote || null,
            schedules
        });
        if (!result.success) {
            const error = result.reason === "not_found" ? "Không tìm thấy đơn cần duyệt."
                : result.reason === "already_reviewed" ? "Đơn này đã được xử lý trước đó."
                : result.reason === "overlap" ? "Đơn bị trùng với một trạng thái ngày công đã được ghi nhận trong khoảng ngày này."
                : result.reason === "no_scheduled_days" ? "Không thể duyệt tự động: nhân viên chưa có ngày làm việc được phân ca trong khoảng công tác."
                : "Không thể xử lý đơn.";
            return fail(error);
        }

        await writeAttendanceAuditLog({
            action: "request_review",
            method: "admin_form",
            result: "success",
            actor: {
                id: req.session.user?.id,
                username: req.session.user?.username,
                role: req.session.user?.role
            },
            employee: { id: request.employee_id },
            workDate: `${request.from_date}..${request.to_date}`,
            reason: reviewNote || null,
            detail: {
                requestId: id,
                requestCode: request.request_code,
                requestType: request.request_type,
                decision,
                appliedDays: result.appliedDays || 0
            },
            req
        });
        notifyRequestsChanged();

        const message = decision === "approved" && request.request_type === "overtime"
            ? `Đã duyệt đơn tăng ca; trạng thái tăng ca đã được cập nhật cho ${result.appliedDays} ngày.`
            : decision === "approved" && request.request_type === "business_trip"
            ? `Đã duyệt công tác và cập nhật đủ giờ theo ca cho ${result.autoAttendanceDays} ngày làm việc.`
            : decision === "approved" && request.request_type === "leave"
            ? `Đã duyệt đơn nghỉ; trạng thái nghỉ đã được ghi nhận cho ${result.appliedDays} ngày làm việc trong khoảng đơn.`
            : decision === "approved" && request.request_type === "explanation"
            ? `Đã phê duyệt giải trình ${request.request_code}; quyết định và ghi chú đã được lưu.`
            : decision === "approved" ? "Đã duyệt đơn."
            : request.request_type === "explanation" ? `Đã từ chối giải trình ${request.request_code}.` : "Đã từ chối đơn.";
        return redirect(res, { ...returnQuery, success: message });
    } catch (error) {
        console.error("Lỗi duyệt đơn nhân sự:", error);
        return fail("Không thể xử lý đơn. Vui lòng thử lại.");
    }
};

// Tên cũ giữ lại để tương thích với import cũ.
export const reviewBusinessTrip = reviewRequest;

export const createExplanation = async (req, res) => {
    const returnQuery = { ...getReturnQuery(req), tab: "explanation" };
    const fail = (message) => redirect(res, { ...returnQuery, error: message });
    const employeeId = Number(req.body.employee_id);
    const category = String(req.body.explanation_type || "").trim();
    const incidentDate = String(req.body.incident_date || "").trim();
    const startTime = String(req.body.from_time || "").trim();
    const endTime = String(req.body.to_time || "").trim();
    const subject = String(req.body.subject || "").trim();
    const reason = String(req.body.reason || "").trim();

    const allowedTypes = ["late", "early_leave", "missing_checkin", "missing_checkout", "wrong_record", "other"];
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) return fail("Vui lòng chọn nhân viên giải trình.");
    if (!allowedTypes.includes(category)) return fail("Vui lòng chọn loại giải trình.");
    if (!isValidDate(incidentDate)) return fail("Ngày phát sinh không hợp lệ.");
    if (startTime && !isValidTime(startTime)) return fail("Thời gian bắt đầu không hợp lệ.");
    if (endTime && !isValidTime(endTime)) return fail("Thời gian kết thúc không hợp lệ.");
    if (startTime && endTime && endTime <= startTime) return fail("Thời gian kết thúc phải sau thời gian bắt đầu.");
    if (subject.length < 5 || subject.length > 120) return fail("Tiêu đề giải trình cần từ 5 đến 120 ký tự.");
    if (reason.length < 20 || reason.length > 5000) return fail("Nội dung giải trình cần từ 20 đến 5.000 ký tự.");

    try {
        const employees = await AttendanceRequestModel.getEmployees();
        if (!employees.some((employee) => Number(employee.id) === employeeId)) {
            return fail("Không tìm thấy nhân viên đang hoạt động.");
        }
        const result = await AttendanceRequestModel.createExplanation({
            employeeId,
            category,
            incidentDate,
            startTime,
            endTime,
            subject,
            reason,
            createdBy: req.session.user?.username
        });
        notifyRequestsChanged();
        return redirect(res, {
            ...returnQuery,
            success: `Đã gửi đơn giải trình ${result.requestCode}, đang chờ phê duyệt.`
        });
    } catch (error) {
        console.error("Lỗi tạo đơn giải trình:", error);
        return fail("Không thể gửi giải trình. Vui lòng thử lại.");
    }
};
