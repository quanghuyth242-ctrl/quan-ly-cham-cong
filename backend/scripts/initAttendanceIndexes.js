import { db } from "../config/db.js";

const indexExists = async (table, index) => {
    const [rows] = await db.execute(
        `SELECT 1
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND INDEX_NAME = ?
          LIMIT 1`,
        [table, index]
    );

    return rows.length > 0;
};

const main = async () => {
    if (!(await indexExists("attendance", "idx_attendance_work_date"))) {
        await db.execute(
            "ALTER TABLE attendance ADD INDEX idx_attendance_work_date (work_date)"
        );
    }

    console.log("Chỉ mục ngày chấm công đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo chỉ mục chấm công:", error.message);
    await db.end();
    process.exit(1);
});
