import { appendFile, mkdir } from "node:fs/promises";
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
