import { db } from "../config/db.js";

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS attendance_day_statuses (
            id BIGINT NOT NULL AUTO_INCREMENT,
            employee_id INT NOT NULL,
            work_date DATE NOT NULL,
            status ENUM('leave', 'business_trip', 'overtime') NOT NULL,
            note VARCHAR(500) NULL,
            updated_by VARCHAR(100) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_attendance_day_status_employee_date (employee_id, work_date),
            KEY idx_attendance_day_status_date_type (work_date, status),
            CONSTRAINT fk_attendance_day_status_employee
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log("Bảng trạng thái chấm công theo ngày đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo trạng thái chấm công theo ngày:", error.message);
    await db.end();
    process.exit(1);
});
