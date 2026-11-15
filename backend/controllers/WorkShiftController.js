import * as WorkShiftModel from "../models/WorkShiftModel.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{2,50}$/;

export const WEEKDAY_LABELS = {
    1: "Thứ 2",
    2: "Thứ 3",
    3: "Thứ 4",
    4: "Thứ 5",
    5: "Thứ 6",
    6: "Thứ 7",
    7: "Chủ nhật"
};

const toSeconds = (time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 3600 + minute * 60;
};

const toSqlTime = (time) => `${time}:00`;

const parseWorkdays = (raw) => {
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return [...new Set(
        values
            .map(Number)
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
    )].sort((a, b) => a - b);
};

const redirectWith = (res, path, { success = null, error = null } = {}) => {
    const params = new URLSearchParams();

    if (success) params.set("success", success);
    if (error) params.set("error", error);

    const query = params.toString();
    res.redirect(query ? `${path}?${query}` : path);
};

const validateShift = async (body, excludeId = null) => {
    const data = {
        shift_code: String(body.shift_code || "").trim().toUpperCase(),
        shift_name: String(body.shift_name || "").trim(),
        morning_start: String(body.morning_start || "").trim(),
        morning_end: String(body.morning_end || "").trim(),
        afternoon_start: String(body.afternoon_start || "").trim(),
        afternoon_end: String(body.afternoon_end || "").trim(),
        status: String(body.status) === "0" ? 0 : 1
    };

    const workdays = parseWorkdays(body.workdays);
    const errors = [];

    if (!data.shift_code) {
        errors.push("Vui lòng nhập mã ca.");
    } else if (!CODE_PATTERN.test(data.shift_code)) {
        errors.push("Mã ca chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới (2-50 ký tự).");
    }

    if (!data.shift_name) {
        errors.push("Vui lòng nhập tên ca.");
    } else if (data.shift_name.length > 100) {
        errors.push("Tên ca không vượt quá 100 ký tự.");
    }

    const timeFields = [
        ["morning_start", "giờ bắt đầu buổi sáng"],
        ["morning_end", "giờ kết thúc buổi sáng"],
        ["afternoon_start", "giờ bắt đầu buổi chiều"],
        ["afternoon_end", "giờ kết thúc buổi chiều"]
    ];

    for (const [field, label] of timeFields) {
        if (!data[field]) {
            errors.push(`Vui lòng nhập ${label}.`);
        } else if (!TIME_PATTERN.test(data[field])) {
            errors.push(`Định dạng ${label} không hợp lệ (HH:MM).`);
        }
    }

    const timesValid = timeFields.every(([field]) => TIME_PATTERN.test(data[field]));

    if (timesValid) {
        if (toSeconds(data.morning_end) <= toSeconds(data.morning_start)) {
            errors.push("Giờ kết thúc buổi sáng phải sau giờ bắt đầu buổi sáng.");
        }

        if (toSeconds(data.afternoon_end) <= toSeconds(data.afternoon_start)) {
            errors.push("Giờ kết thúc buổi chiều phải sau giờ bắt đầu buổi chiều.");
        }

        if (toSeconds(data.afternoon_start) <= toSeconds(data.morning_end)) {
            errors.push("Giờ bắt đầu buổi chiều phải sau giờ kết thúc buổi sáng.");
        }
    }

    if (workdays.length === 0) {
        errors.push("Vui lòng chọn ít nhất một ngày làm việc trong tuần.");
    }

    if (errors.length === 0) {
        const existing = await WorkShiftModel.findByCode(data.shift_code, excludeId);

        if (existing) {
            errors.push(`Mã ca "${data.shift_code}" đã tồn tại, vui lòng chọn mã khác.`);
        }
    }

    return {
        errors,
        data: {
            ...data,
            shift_code: data.shift_code,
            morning_start: toSqlTime(data.morning_start),
            morning_end: toSqlTime(data.morning_end),
            afternoon_start: toSqlTime(data.afternoon_start),
            afternoon_end: toSqlTime(data.afternoon_end),
            workdays
        }
    };
};

export const index = async (req, res) => {
    try {
        const search = String(req.query.search || "").trim();
        const status = ["1", "0"].includes(String(req.query.status))
            ? String(req.query.status)
            : "";

        const [shifts, stats] = await Promise.all([
            WorkShiftModel.findAll({ search, status }),
            WorkShiftModel.getStats()
        ]);

        res.render("shifts", {
            user: req.session.user,
            shifts,
            stats,
            filters: { search, status },
            weekdayLabels: WEEKDAY_LABELS,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.log("Lỗi tải danh sách ca:", error);

        res.render("shifts", {
            user: req.session.user,
            shifts: [],
            stats: { total: 0, active: 0, inactive: 0 },
            filters: { search: "", status: "" },
            weekdayLabels: WEEKDAY_LABELS,
            success: null,
            error: "Không thể tải danh sách ca làm việc. Vui lòng thử lại."
        });
    }
};

export const create = async (req, res) => {
    try {
        const { data, errors } = await validateShift(req.body);

        if (errors.length > 0) {
            return redirectWith(res, "/admin/shifts", { error: errors.join(" ") });
        }

        await WorkShiftModel.create(data);

        redirectWith(res, "/admin/shifts", {
            success: `Đã thêm ca làm việc "${data.shift_name}".`
        });
    } catch (error) {
        console.log("Lỗi thêm ca:", error);

        const message = error.code === "ER_DUP_ENTRY"
            ? "Mã ca đã tồn tại, vui lòng chọn mã khác."
            : "Không thể thêm ca làm việc. Vui lòng thử lại.";

        redirectWith(res, "/admin/shifts", { error: message });
    }
};

export const update = async (req, res) => {
    try {
        const shift = await WorkShiftModel.findById(req.params.id);

        if (!shift) {
            return redirectWith(res, "/admin/shifts", {
                error: "Ca làm việc không tồn tại."
            });
        }

        const { data, errors } = await validateShift(req.body, shift.id);

        if (errors.length > 0) {
            return redirectWith(res, "/admin/shifts", { error: errors.join(" ") });
        }

        await WorkShiftModel.update(shift.id, data);

        redirectWith(res, "/admin/shifts", {
            success: `Đã cập nhật ca làm việc "${data.shift_name}".`
        });
    } catch (error) {
        console.log("Lỗi cập nhật ca:", error);

        const message = error.code === "ER_DUP_ENTRY"
            ? "Mã ca đã tồn tại, vui lòng chọn mã khác."
            : "Không thể cập nhật ca làm việc. Vui lòng thử lại.";

        redirectWith(res, "/admin/shifts", { error: message });
    }
};

export const remove = async (req, res) => {
    try {
        const shift = await WorkShiftModel.findById(req.params.id);

        if (!shift) {
            return redirectWith(res, "/admin/shifts", {
                error: "Ca làm việc không tồn tại."
            });
        }

        const assignmentCount = await WorkShiftModel.countAssignments(shift.id);

        if (assignmentCount > 0) {
            return redirectWith(res, "/admin/shifts", {
                error: `Không thể xóa ca "${shift.shift_name}" vì đã có ${assignmentCount} phân ca sử dụng. Hãy ngừng hoạt động ca thay vì xóa.`
            });
        }

        await WorkShiftModel.remove(shift.id);

        redirectWith(res, "/admin/shifts", {
            success: `Đã xóa ca làm việc "${shift.shift_name}".`
        });
    } catch (error) {
        console.log("Lỗi xóa ca:", error);

        redirectWith(res, "/admin/shifts", {
            error: "Không thể xóa ca làm việc. Vui lòng thử lại."
        });
    }
};

export const toggleStatus = async (req, res) => {
    try {
        const shift = await WorkShiftModel.findById(req.params.id);

        if (!shift) {
            return redirectWith(res, "/admin/shifts", {
                error: "Ca làm việc không tồn tại."
            });
        }

        const nextStatus = shift.status === 1 ? 0 : 1;
        await WorkShiftModel.setStatus(shift.id, nextStatus);

        redirectWith(res, "/admin/shifts", {
            success: nextStatus === 1
                ? `Đã kích hoạt lại ca "${shift.shift_name}".`
                : `Đã ngừng hoạt động ca "${shift.shift_name}".`
        });
    } catch (error) {
        console.log("Lỗi đổi trạng thái ca:", error);

        redirectWith(res, "/admin/shifts", {
            error: "Không thể thay đổi trạng thái ca. Vui lòng thử lại."
        });
    }
};
