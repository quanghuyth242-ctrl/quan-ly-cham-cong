import { db } from "../config/db.js";

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS attendance_requests (
            id INT NOT NULL AUTO_INCREMENT,
            request_code VARCHAR(40) NULL,
            employee_id INT NOT NULL,
            request_type ENUM('leave', 'business_trip', 'overtime', 'explanation', 'resignation') NOT NULL,
            category VARCHAR(50) NULL,
            from_date DATE NOT NULL,
            to_date DATE NOT NULL,
            reason TEXT NOT NULL,
            destination VARCHAR(255) NULL,
            overtime_start_time TIME NULL,
            overtime_end_time TIME NULL,
            status ENUM('pending', 'awaiting_employee', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
            created_by VARCHAR(100) NULL,
            reviewed_by INT NULL,
            reviewed_at DATETIME NULL,
            review_note VARCHAR(500) NULL,
            employee_response ENUM('accepted', 'rejected') NULL,
            employee_responded_at DATETIME NULL,
            employee_response_note VARCHAR(500) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_attendance_requests_code (request_code),
            KEY idx_attendance_requests_employee_dates (employee_id, from_date, to_date),
            KEY idx_attendance_requests_status (status, created_at),
            CONSTRAINT fk_attendance_request_employee
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await db.execute(`
        ALTER TABLE attendance_requests
        MODIFY COLUMN request_type ENUM('leave', 'business_trip', 'overtime', 'explanation', 'resignation') NOT NULL
    `);
    await db.execute(`
        ALTER TABLE attendance_requests
        MODIFY COLUMN status ENUM('pending', 'awaiting_employee', 'approved', 'rejected') NOT NULL DEFAULT 'pending'
    `);

    const [employeeResponseColumn] = await db.execute("SHOW COLUMNS FROM attendance_requests LIKE 'employee_response'");
    if (employeeResponseColumn.length === 0) {
        await db.execute("ALTER TABLE attendance_requests ADD COLUMN employee_response ENUM('accepted', 'rejected') NULL AFTER review_note");
    }
    const [employeeRespondedAtColumn] = await db.execute("SHOW COLUMNS FROM attendance_requests LIKE 'employee_responded_at'");
    if (employeeRespondedAtColumn.length === 0) {
        await db.execute("ALTER TABLE attendance_requests ADD COLUMN employee_responded_at DATETIME NULL AFTER employee_response");
    }
    const [employeeResponseNoteColumn] = await db.execute("SHOW COLUMNS FROM attendance_requests LIKE 'employee_response_note'");
    if (employeeResponseNoteColumn.length === 0) {
        await db.execute("ALTER TABLE attendance_requests ADD COLUMN employee_response_note VARCHAR(500) NULL AFTER employee_responded_at");
    }

    const [overtimeStartColumn] = await db.execute("SHOW COLUMNS FROM attendance_requests LIKE 'overtime_start_time'");
    if (overtimeStartColumn.length === 0) {
        await db.execute("ALTER TABLE attendance_requests ADD COLUMN overtime_start_time TIME NULL AFTER destination");
    }
    const [overtimeEndColumn] = await db.execute("SHOW COLUMNS FROM attendance_requests LIKE 'overtime_end_time'");
    if (overtimeEndColumn.length === 0) {
        await db.execute("ALTER TABLE attendance_requests ADD COLUMN overtime_end_time TIME NULL AFTER overtime_start_time");
    }

    const [statusColumns] = await db.execute("SHOW COLUMNS FROM attendance_day_statuses LIKE 'request_id'");
    if (statusColumns.length === 0) {
        await db.execute("ALTER TABLE attendance_day_statuses ADD COLUMN request_id INT NULL AFTER updated_by");
        await db.execute("ALTER TABLE attendance_day_statuses ADD INDEX idx_attendance_day_status_request (request_id)");
    }

    console.log("Bảng đơn nghỉ/công tác và liên kết trạng thái chấm công đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo đơn nghỉ/công tác:", error.message);
    await db.end();
    process.exit(1);
});
