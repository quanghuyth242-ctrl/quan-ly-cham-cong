import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "attendance-audit.log");

/**
 * Ghi nhật ký chấm công (đặc biệt là các lần chấm công thủ công).
 * Không lưu descriptor khuôn mặt và không thay đổi cấu trúc database.
 */
export const writeAttendanceAuditLog = async ({
    action,
    method,
    result,
    actor,
    employee,
    workDate,
    reason,
    detail,
    req
}) => {
    try {
        await mkdir(LOG_DIR, { recursive: true });

        const entry = {
            at: new Date().toISOString(),
            action: action || null,
            method: method || null,
            result: result || null,
            actor: actor
                ? {
                    id: actor.id,
                    username: actor.username,
                    role: actor.role
                }
                : null,
            employee: employee
                ? {
                    id: employee.id,
                    employee_code: employee.employee_code,
                    full_name: employee.full_name
                }
                : null,
            workDate: workDate || null,
            reason: reason || null,
            detail: detail || null,
            ip: req?.ip || null
        };

        await appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
        // Không chặn thao tác chính nếu ghi log thất bại.
        console.warn("Không ghi được nhật ký chấm công:", error.message);
    }
};

/** Đọc lịch sử audit liên quan đến một đơn để hiển thị ở trang chi tiết. */
export const getRequestAuditLogs = async ({ requestId, requestCode, limit = 20 } = {}) => {
    try {
        const content = await readFile(LOG_FILE, "utf8");
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        return content.split(/\r?\n/).filter(Boolean).reverse().flatMap((line) => {
            try {
                const event = JSON.parse(line);
                const matches = (requestId && Number(event.detail?.requestId) === Number(requestId))
                    || (requestCode && event.detail?.requestCode === requestCode);
                if (!matches) return [];
                return [{
                    at: event.at,
                    action: event.action,
                    method: event.method,
                    result: event.result,
                    actor: event.actor,
                    reason: event.reason,
                    detail: event.detail
                }];
            } catch {
                return [];
            }
        }).slice(0, safeLimit);
    } catch (error) {
        // Nhật ký chỉ là thông tin bổ trợ, không được chặn trang chi tiết.
        console.warn("Không đọc được nhật ký chấm công:", error.message);
        return [];
    }
};

/** Đọc các sự kiện chấm công thành công gần nhất để hiển thị trên bảng quản trị. */
export const getRecentAttendanceEvents = async ({ date, limit = 30 } = {}) => {
    try {
        const content = await readFile(LOG_FILE, "utf8");
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
        return content.split(/\r?\n/).filter(Boolean).reverse().flatMap((line) => {
            try {
                const event = JSON.parse(line);
                if (event.result !== "success" || !["check_in", "check_out"].includes(event.action)) return [];
                if (date && event.workDate !== date) return [];
                return [{ at: event.at, action: event.action, method: event.method, workDate: event.workDate, employee: event.employee, detail: event.detail }];
            } catch {
                return [];
            }
        }).slice(0, safeLimit);
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
};
