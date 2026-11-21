import { db } from "../config/db.js";

export const save = async ({ employeeId, workDate, status, note, updatedBy, requestId = null }) => {
    if (status === "overtime" && !requestId) {
        const error = new Error("Trạng thái tăng ca chỉ được cập nhật từ đơn tăng ca đã gửi.");
        error.code = "OVERTIME_REQUEST_REQUIRED";
        throw error;
    }
    const [existingRows] = await db.execute(
        "SELECT request_id FROM attendance_day_statuses WHERE employee_id = ? AND work_date = ? LIMIT 1",
        [employeeId, workDate]
    );
    if (existingRows[0]?.request_id && !requestId) {
        const error = new Error("Trạng thái này được tạo từ đơn đã duyệt và cần được xử lý qua đơn công tác.");
        error.code = "REQUEST_LINKED_STATUS";
        throw error;
    }

    if (!status) {
        const [result] = await db.execute(
            "DELETE FROM attendance_day_statuses WHERE employee_id = ? AND work_date = ?",
            [employeeId, workDate]
        );
        return result.affectedRows > 0;
    }

    await db.execute(`
        INSERT INTO attendance_day_statuses (employee_id, work_date, status, note, updated_by, request_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            note = VALUES(note),
            updated_by = VALUES(updated_by),
            request_id = VALUES(request_id),
            updated_at = CURRENT_TIMESTAMP
    `, [employeeId, workDate, status, note || null, updatedBy || null, requestId]);
    return true;
};
