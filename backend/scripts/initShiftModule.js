import { db } from "../config/db.js";

const columnExists = async (table, column) => {
    const [rows] = await db.execute(
        `SELECT 1
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );

    return rows.length > 0;
};

const indexExists = async (table, indexName) => {
    const [rows] = await db.execute(
        `SELECT 1
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?
         LIMIT 1`,
        [table, indexName]
    );

    return rows.length > 0;
};

const tableExists = async (table) => {
    const [rows] = await db.execute(
        `SELECT 1
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
         LIMIT 1`,
        [table]
    );

    return rows.length > 0;
};

const main = async () => {
    console.log("=== Khởi tạo module ca làm việc & phân ca ===");

    // Đảm bảo bảng ca làm việc tồn tại trên cơ sở dữ liệu mới
    if (!(await tableExists("work_shifts"))) {
        await db.query(`
            CREATE TABLE work_shifts (
                id INT NOT NULL AUTO_INCREMENT,
                shift_code VARCHAR(50) NULL,
                shift_name VARCHAR(100) NOT NULL,
                morning_start TIME NOT NULL,
                morning_end TIME NOT NULL,
                afternoon_start TIME NOT NULL,
                afternoon_end TIME NOT NULL,
                status TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        `);
        console.log("+ Đã tạo bảng work_shifts");
    } else {
        console.log("= Bảng work_shifts đã tồn tại");
    }

    // 1. Bổ sung cột shift_code cho work_shifts
    if (!(await columnExists("work_shifts", "shift_code"))) {
        await db.query(
            "ALTER TABLE work_shifts ADD COLUMN shift_code VARCHAR(50) NULL AFTER id"
        );
        console.log("+ Đã thêm cột work_shifts.shift_code");
    } else {
        console.log("= work_shifts.shift_code đã tồn tại");
    }

    // 2. Sinh mã ca cho các bản ghi cũ chưa có mã
    const [missingCode] = await db.query(
        "SELECT id FROM work_shifts WHERE shift_code IS NULL OR shift_code = ''"
    );

    for (const row of missingCode) {
        await db.execute(
            "UPDATE work_shifts SET shift_code = ? WHERE id = ?",
            [`CA${String(row.id).padStart(3, "0")}`, row.id]
        );
    }

    if (missingCode.length > 0) {
        console.log(`+ Đã sinh mã ca cho ${missingCode.length} bản ghi cũ`);
    }

    // 3. Đảm bảo shift_code là NOT NULL
    const [codeColumn] = await db.execute(
        `SELECT IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'work_shifts'
           AND COLUMN_NAME = 'shift_code'
         LIMIT 1`
    );

    if (codeColumn.length > 0 && codeColumn[0].IS_NULLABLE === "YES") {
        await db.query(
            "ALTER TABLE work_shifts MODIFY COLUMN shift_code VARCHAR(50) NOT NULL"
        );
        console.log("+ Đã chuyển work_shifts.shift_code sang NOT NULL");
    }

    // 4. Unique index cho shift_code
    if (!(await indexExists("work_shifts", "uk_work_shifts_code"))) {
        await db.query(
            "ALTER TABLE work_shifts ADD UNIQUE KEY uk_work_shifts_code (shift_code)"
        );
        console.log("+ Đã tạo unique index uk_work_shifts_code");
    } else {
        console.log("= Unique index uk_work_shifts_code đã tồn tại");
    }

    // 5. Index trạng thái ca
    if (!(await indexExists("work_shifts", "idx_work_shifts_status"))) {
        await db.query(
            "ALTER TABLE work_shifts ADD INDEX idx_work_shifts_status (status)"
        );
        console.log("+ Đã tạo index idx_work_shifts_status");
    }

    // 6. Tạo bảng ngày làm việc của từng ca
    if (!(await tableExists("shift_workdays"))) {
        await db.query(`
            CREATE TABLE shift_workdays (
                shift_id INT NOT NULL,
                weekday TINYINT UNSIGNED NOT NULL,
                PRIMARY KEY (shift_id, weekday),
                CONSTRAINT fk_shift_workdays_shift
                    FOREIGN KEY (shift_id) REFERENCES work_shifts (id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        `);
        console.log("+ Đã tạo bảng shift_workdays");
    } else {
        console.log("= Bảng shift_workdays đã tồn tại");
    }

    // 7. Tạo bảng phân ca nhân viên
    if (!(await tableExists("employee_shift_assignments"))) {
        await db.query(`
            CREATE TABLE employee_shift_assignments (
                id INT NOT NULL AUTO_INCREMENT,
                employee_id INT NOT NULL,
                shift_id INT NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                status ENUM('active', 'cancelled') NOT NULL DEFAULT 'active',
                note VARCHAR(255) NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_esa_employee_dates (employee_id, start_date, end_date),
                KEY idx_esa_shift (shift_id),
                KEY idx_esa_status (status),
                CONSTRAINT fk_esa_employee
                    FOREIGN KEY (employee_id) REFERENCES employees (id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT fk_esa_shift
                    FOREIGN KEY (shift_id) REFERENCES work_shifts (id)
                    ON DELETE RESTRICT ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        `);
        console.log("+ Đã tạo bảng employee_shift_assignments");
    } else {
        console.log("= Bảng employee_shift_assignments đã tồn tại");
    }

    // 8. Tạo ca mặc định nếu hệ thống chưa có ca nào
    const [shiftCount] = await db.query("SELECT COUNT(*) AS total FROM work_shifts");

    if (Number(shiftCount[0].total) === 0) {
        const [result] = await db.execute(
            `INSERT INTO work_shifts
                (shift_code, shift_name, morning_start, morning_end,
                 afternoon_start, afternoon_end, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ["CA001", "Ca hành chính", "07:30:00", "11:00:00", "13:30:00", "17:30:00", 1]
        );

        const shiftId = result.insertId;

        for (let weekday = 1; weekday <= 6; weekday += 1) {
            await db.execute(
                "INSERT INTO shift_workdays (shift_id, weekday) VALUES (?, ?)",
                [shiftId, weekday]
            );
        }

        console.log("+ Đã tạo ca mặc định: Ca hành chính (Thứ 2 - Thứ 7)");
    } else {
        console.log("= Đã có ca làm việc, không tạo ca mặc định");
    }

    console.log("=== Hoàn tất khởi tạo ===");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo:", error.message);
    await db.end();
    process.exit(1);
});
