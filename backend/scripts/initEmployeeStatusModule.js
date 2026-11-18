import { db } from "../config/db.js";

const columnExists = async (column) => {
    const [rows] = await db.execute(
        `SELECT 1
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'employees'
            AND COLUMN_NAME = ?
          LIMIT 1`,
        [column]
    );
    return rows.length > 0;
};

const indexExists = async (index) => {
    const [rows] = await db.execute(
        `SELECT 1
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'employees'
            AND INDEX_NAME = ?
          LIMIT 1`,
        [index]
    );
    return rows.length > 0;
};

const main = async () => {
    if (!(await columnExists("is_active"))) {
        await db.execute(
            "ALTER TABLE employees ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1"
        );
    }

    if (!(await columnExists("deactivated_at"))) {
        await db.execute(
            "ALTER TABLE employees ADD COLUMN deactivated_at DATETIME NULL"
        );
    }

    await db.execute(
        "UPDATE employees SET deactivated_at = NULL WHERE is_active = 1"
    );
    if (!(await indexExists("idx_employees_active_code"))) {
        await db.execute(
            "ALTER TABLE employees ADD INDEX idx_employees_active_code (is_active, employee_code)"
        );
    }

    console.log("Trạng thái hoạt động nhân viên đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo trạng thái nhân viên:", error.message);
    await db.end();
    process.exit(1);
});
