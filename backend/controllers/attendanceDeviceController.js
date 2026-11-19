import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as AttendanceModel from "../models/attendance.js";
import * as AttendanceDeviceModel from "../models/attendanceDevice.js";

const DEVICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9._-]{1,50}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const DEVICE_TYPES = new Set(["biometric", "camera", "network", "other"]);
const EMPTY_STATS = { total: 0, online: 0, offline: 0 };
const SYNC_STATUS_VALUES = {
    present: "present",
    on_time: "present",
    "đúng giờ": "present",
    late: "late",
    "đi muộn": "late",
    absent: "absent",
    "vắng mặt": "absent"
};

const isValidDate = (value) => {
    if (!DATE_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const authenticateDevice = async (req) => {
    const deviceCode = String(req.params.deviceCode || "").trim().toUpperCase();
    const token = req.get("x-device-token");

    if (!DEVICE_CODE_PATTERN.test(deviceCode) || typeof token !== "string" || token.length === 0 || token.length > 256) {
        return null;
    }

    const device = await AttendanceDeviceModel.findByCode(deviceCode);
    if (!device || !device.is_active || !/^[a-f\d]{64}$/i.test(device.token_hash)) {
        return null;
    }

    const expectedHash = Buffer.from(device.token_hash, "hex");
    const providedHash = createHash("sha256").update(token).digest();
    if (expectedHash.length !== providedHash.length || !timingSafeEqual(expectedHash, providedHash)) {
        return null;
    }

    return device;
};

const validateSyncPayload = (body) => {
    const errors = [];
    const records = [];
    const seenRecords = new Set();

    if (!body || !Array.isArray(body.records)) {
        return { records, errors: ["Dữ liệu đồng bộ phải có mảng records."] };
    }
    if (body.records.length === 0 || body.records.length > 500) {
        return { records, errors: ["Mỗi lần đồng bộ cần từ 1 đến 500 bản ghi."] };
    }

    body.records.forEach((record, index) => {
        const rowLabel = `Bản ghi ${index + 1}: `;
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            errors.push(`${rowLabel}định dạng không hợp lệ.`);
            return;
        }

        const employeeCode = typeof record.employee_code === "string"
            ? record.employee_code.trim().toUpperCase()
            : "";
        const workDate = typeof record.work_date === "string"
            ? record.work_date.trim()
            : "";
        const checkIn = record.check_in === undefined || record.check_in === null || record.check_in === ""
            ? ""
            : typeof record.check_in === "string" ? record.check_in.trim() : null;
        const checkOut = record.check_out === undefined || record.check_out === null || record.check_out === ""
            ? ""
            : typeof record.check_out === "string" ? record.check_out.trim() : null;
        const rawStatus = typeof record.status === "string"
            ? record.status.trim().toLocaleLowerCase()
            : "";
        const status = SYNC_STATUS_VALUES[rawStatus];
        const rowErrors = [];

        if (!EMPLOYEE_CODE_PATTERN.test(employeeCode)) {
            rowErrors.push("mã nhân viên không hợp lệ");
        }
        if (!isValidDate(workDate)) {
            rowErrors.push("ngày làm việc không hợp lệ");
        }
        if (checkIn === null || (checkIn && !TIME_PATTERN.test(checkIn))) {
            rowErrors.push("giờ vào phải theo định dạng HH:mm");
        }
        if (checkOut === null || (checkOut && !TIME_PATTERN.test(checkOut))) {
            rowErrors.push("giờ ra phải theo định dạng HH:mm");
        }
        if (!status) {
            rowErrors.push("trạng thái phải là present, late hoặc absent");
        } else if (status === "absent" && (checkIn || checkOut)) {
            rowErrors.push("bản ghi vắng mặt không được có giờ vào hoặc giờ ra");
        } else if (status !== "absent" && !checkIn) {
            rowErrors.push("bản ghi có mặt cần có giờ vào");
        }
        if (checkOut && !checkIn) {
            rowErrors.push("cần có giờ vào trước khi nhập giờ ra");
        } else if (checkIn && checkOut && checkOut <= checkIn) {
            rowErrors.push("giờ ra phải sau giờ vào");
        }

        if (rowErrors.length > 0) {
            errors.push(`${rowLabel}${rowErrors.join("; ")}.`);
            return;
        }

        const duplicateKey = `${employeeCode}:${workDate}`;
        if (seenRecords.has(duplicateKey)) {
            errors.push(`${rowLabel}nhân viên đã xuất hiện trong ngày này ở cùng lô đồng bộ.`);
            return;
        }
        seenRecords.add(duplicateKey);
        records.push({
            employee_code: employeeCode,
            work_date: workDate,
            check_in: checkIn,
            check_out: checkOut,
            status
        });
    });

    return { records, errors };
};

const validateEventPayload = (body) => {
    const errors = [];
    const events = [];
    const directions = {
        in: "in",
        check_in: "in",
        out: "out",
        check_out: "out"
    };

    if (!body || !Array.isArray(body.events)) {
        return { events, errors: ["Dữ liệu sự kiện phải có mảng events."] };
    }
    if (body.events.length === 0 || body.events.length > 500) {
        return { events, errors: ["Mỗi lần gửi cần từ 1 đến 500 sự kiện."] };
    }

    body.events.forEach((event, index) => {
        const rowLabel = `Sự kiện ${index + 1}: `;
        if (!event || typeof event !== "object" || Array.isArray(event)) {
            errors.push(`${rowLabel}định dạng không hợp lệ.`);
            return;
        }

        const employeeCode = typeof event.employee_code === "string"
            ? event.employee_code.trim().toUpperCase()
            : "";
        const occurredAt = typeof event.occurred_at === "string"
            ? event.occurred_at.trim().replace("T", " ")
            : "";
        const directionValue = typeof event.direction === "string"
            ? event.direction.trim().toLocaleLowerCase()
            : "";
        const direction = directions[directionValue];
        const eventId = event.event_id === undefined || event.event_id === null
            ? ""
            : typeof event.event_id === "string" ? event.event_id.trim() : null;
        const rowErrors = [];
        const timestampMatch = occurredAt.match(EVENT_TIMESTAMP_PATTERN);

        if (!EMPLOYEE_CODE_PATTERN.test(employeeCode)) {
            rowErrors.push("mã nhân viên không hợp lệ");
        }
        if (!timestampMatch || !isValidDate(timestampMatch[1])) {
            rowErrors.push("thời điểm phải theo định dạng YYYY-MM-DD HH:mm:ss");
        }
        if (!direction) {
            rowErrors.push("direction phải là in hoặc out");
        }
        if (eventId === null || (eventId && eventId.length > 128)) {
            rowErrors.push("event_id phải là chuỗi không vượt quá 128 ký tự");
        }

        if (rowErrors.length > 0) {
            errors.push(`${rowLabel}${rowErrors.join("; ")}.`);
            return;
        }

        events.push({
            employee_code: employeeCode,
            occurred_at: occurredAt,
            direction,
            event_id: eventId || null
        });
    });

    return { events, errors };
};

const renderDevicePage = async (req, res, {
    error = null,
    newDevice = null,
    statusCode = 200
} = {}) => {
    const devices = await AttendanceDeviceModel.findAll();
    const online = devices.filter((device) => device.is_online).length;

    return res.status(statusCode).render("admin/devices", {
        user: req.session.user,
        devices,
        stats: {
            total: devices.length,
            online,
            offline: devices.length - online
        },
        onlineWindowMinutes: AttendanceDeviceModel.ONLINE_WINDOW_MINUTES,
        newDevice,
        success: newDevice ? "Đã đăng ký thiết bị. Hãy lưu khóa kết nối vì khóa chỉ hiển thị một lần." : null,
        error
    });
};

const renderDeviceError = (req, res, error, statusCode = 500) => res
    .status(statusCode)
    .render("admin/devices", {
        user: req.session.user,
        devices: [],
        stats: EMPTY_STATS,
        onlineWindowMinutes: AttendanceDeviceModel.ONLINE_WINDOW_MINUTES,
        newDevice: null,
        success: null,
        error
    });

export const index = async (req, res) => {
    try {
        const newDevice = req.session.deviceSetup || null;
        const response = await renderDevicePage(req, res, { newDevice });
        if (newDevice) delete req.session.deviceSetup;
        return response;
    } catch (error) {
        console.error("Lỗi tải trạng thái thiết bị:", error);
        return renderDeviceError(req, res, "Không thể tải trạng thái thiết bị. Vui lòng thử lại.");
    }
};

export const create = async (req, res) => {
    const deviceCode = typeof req.body.device_code === "string"
        ? req.body.device_code.trim().toUpperCase()
        : "";
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const location = typeof req.body.location === "string" ? req.body.location.trim() : "";
    const deviceType = typeof req.body.device_type === "string"
        ? req.body.device_type.trim()
        : "";
    const errors = [];

    if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
        errors.push("Mã thiết bị phải dài 2–64 ký tự, bắt đầu bằng chữ hoặc số và chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới.");
    }
    if (!name || name.length > 120) {
        errors.push("Tên thiết bị là bắt buộc và không vượt quá 120 ký tự.");
    }
    if (location.length > 150) {
        errors.push("Vị trí không vượt quá 150 ký tự.");
    }
    if (!DEVICE_TYPES.has(deviceType)) {
        errors.push("Vui lòng chọn loại thiết bị hợp lệ.");
    }

    if (errors.length > 0) {
        try {
            return await renderDevicePage(req, res, {
                error: errors.join(" "),
                statusCode: 400
            });
        } catch (error) {
            console.error("Lỗi tải thiết bị sau khi kiểm tra thông tin:", error);
            return renderDeviceError(req, res, "Không thể tải danh sách thiết bị. Vui lòng thử lại.");
        }
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    try {
        await AttendanceDeviceModel.create({
            device_code: deviceCode,
            name,
            location,
            device_type: deviceType,
            token_hash: tokenHash
        });

        req.session.deviceSetup = { deviceCode, name, token };
        return res.redirect("/admin/devices");
    } catch (error) {
        console.error("Lỗi đăng ký thiết bị:", error);
        const isDuplicate = error.code === "ER_DUP_ENTRY";
        const message = isDuplicate
            ? "Mã thiết bị đã tồn tại. Vui lòng chọn mã khác."
            : "Không thể đăng ký thiết bị. Vui lòng thử lại.";

        try {
            return await renderDevicePage(req, res, {
                error: message,
                statusCode: isDuplicate ? 409 : 500
            });
        } catch (renderError) {
            console.error("Lỗi tải danh sách thiết bị sau khi đăng ký thất bại:", renderError);
            return renderDeviceError(req, res, message);
        }
    }
};

export const heartbeat = async (req, res) => {
    try {
        const device = await authenticateDevice(req);
        if (!device) {
            return res.status(401).json({ error: "Mã thiết bị hoặc khóa kết nối không hợp lệ." });
        }

        await AttendanceDeviceModel.markHeartbeat(device.id);
        return res.json({
            success: true,
            last_seen_at: new Date().toISOString()
        });
    } catch (error) {
        console.error("Lỗi nhận heartbeat từ thiết bị:", error);
        return res.status(500).json({ error: "Không thể cập nhật trạng thái thiết bị." });
    }
};

export const sync = async (req, res) => {
    try {
        const device = await authenticateDevice(req);
        if (!device) {
            return res.status(401).json({ error: "Mã thiết bị hoặc khóa kết nối không hợp lệ." });
        }

        const { records, errors } = validateSyncPayload(req.body);
        if (errors.length > 0) {
            return res.status(400).json({
                error: "Lô dữ liệu đồng bộ không hợp lệ.",
                details: errors
            });
        }

        const result = await AttendanceModel.syncDeviceRecords(device.id, records);
        return res.json({
            success: true,
            device_code: device.device_code,
            synced_at: new Date().toISOString(),
            ...result
        });
    } catch (error) {
        if (error.code === "UNKNOWN_EMPLOYEES") {
            return res.status(422).json({
                error: error.message,
                employee_codes: error.employeeCodes
            });
        }

        console.error("Lỗi đồng bộ dữ liệu từ thiết bị:", error);
        return res.status(500).json({ error: "Không thể đồng bộ dữ liệu chấm công." });
    }
};

export const syncEvents = async (req, res) => {
    try {
        const device = await authenticateDevice(req);
        if (!device) {
            return res.status(401).json({ error: "Mã thiết bị hoặc khóa kết nối không hợp lệ." });
        }

        const { events, errors } = validateEventPayload(req.body);
        if (errors.length > 0) {
            return res.status(400).json({
                error: "Lô sự kiện chấm công không hợp lệ.",
                details: errors
            });
        }

        const result = await AttendanceModel.syncDeviceEvents(device.id, events);
        return res.json({
            success: true,
            device_code: device.device_code,
            synced_at: new Date().toISOString(),
            ...result
        });
    } catch (error) {
        if (error.code === "UNKNOWN_EMPLOYEES") {
            return res.status(422).json({
                error: error.message,
                employee_codes: error.employeeCodes
            });
        }

        console.error("Lỗi đồng bộ sự kiện từ thiết bị:", error);
        return res.status(500).json({ error: "Không thể đồng bộ sự kiện chấm công." });
    }
};
