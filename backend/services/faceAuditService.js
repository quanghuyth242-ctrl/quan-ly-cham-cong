import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "face-audit.log");

/**
 * Ghi nhật ký thao tác trên dữ liệu khuôn mặt.
 * Không làm thay đổi cấu trúc database hiện tại.
 */
export const writeFaceAuditLog = async ({ action, actor, employee, detail, req }) => {
    try {
        await mkdir(LOG_DIR, { recursive: true });

        const entry = {
            at: new Date().toISOString(),
            action,
            actor: actor
                ? {
                    id: actor.id,
                    username: actor.username,
                    role: actor.role
                }
                : null,
            employee: employee || null,
            detail: detail || null,
            ip: req?.ip || null
        };

        await appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
        // Không chặn thao tác chính nếu ghi log thất bại.
        console.warn("Không ghi được nhật ký thao tác khuôn mặt:", error.message);
    }
};
