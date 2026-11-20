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

const attendanceColumns = [
    ["check_in_latitude", "DECIMAL(10,7) NULL"],
    ["check_in_longitude", "DECIMAL(10,7) NULL"],
    ["check_in_accuracy_m", "DECIMAL(8,2) NULL"],
    ["check_in_distance_m", "INT UNSIGNED NULL"],
    ["check_out_latitude", "DECIMAL(10,7) NULL"],
    ["check_out_longitude", "DECIMAL(10,7) NULL"],
    ["check_out_accuracy_m", "DECIMAL(8,2) NULL"],
    ["check_out_distance_m", "INT UNSIGNED NULL"]
];

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS attendance_gps_settings (
            id TINYINT UNSIGNED NOT NULL,
            latitude DECIMAL(10,7) NULL,
            longitude DECIMAL(10,7) NULL,
            radius_m INT UNSIGNED NOT NULL DEFAULT 100,
            updated_by INT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await db.execute(
        `INSERT IGNORE INTO attendance_gps_settings (id, radius_m)
         VALUES (1, 100)`
    );

    for (const [column, definition] of attendanceColumns) {
        if (await columnExists("attendance", column)) continue;

        await db.execute(
            `ALTER TABLE attendance ADD COLUMN ${column} ${definition}`
        );
    }

    console.log("Cấu hình GPS và cột vị trí chấm công đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo chấm công GPS:", error.message);
    await db.end();
    process.exit(1);
});
