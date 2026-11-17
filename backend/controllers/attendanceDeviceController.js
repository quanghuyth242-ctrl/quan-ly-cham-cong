import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as AttendanceDeviceModel from "../models/attendanceDevice.js";

const DEVICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const DEVICE_TYPES = new Set(["biometric", "camera", "network", "other"]);
const EMPTY_STATS = { total: 0, online: 0, offline: 0 };

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
    const deviceCode = String(req.params.deviceCode || "").trim().toUpperCase();
    const token = req.get("x-device-token");

    if (!DEVICE_CODE_PATTERN.test(deviceCode) || typeof token !== "string" || token.length === 0 || token.length > 256) {
        return res.status(401).json({ error: "Mã thiết bị hoặc khóa kết nối không hợp lệ." });
    }

    try {
        const device = await AttendanceDeviceModel.findByCode(deviceCode);
        if (!device || !device.is_active || !/^[a-f\d]{64}$/i.test(device.token_hash)) {
            return res.status(401).json({ error: "Mã thiết bị hoặc khóa kết nối không hợp lệ." });
        }

        const expectedHash = Buffer.from(device.token_hash, "hex");
        const providedHash = createHash("sha256").update(token).digest();
        if (expectedHash.length !== providedHash.length || !timingSafeEqual(expectedHash, providedHash)) {
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
