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

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS attendance_devices (
            id INT NOT NULL AUTO_INCREMENT,
            device_code VARCHAR(64) NOT NULL,
            name VARCHAR(120) NOT NULL,
            location VARCHAR(150) NULL,
            device_type VARCHAR(24) NOT NULL,
            token_hash CHAR(64) NOT NULL,
            last_seen_at DATETIME(6) NULL,
            last_sync_at DATETIME(6) NULL,
            last_sync_count INT UNSIGNED NOT NULL DEFAULT 0,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            is_sample TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_attendance_devices_code (device_code),
            KEY idx_attendance_devices_active_last_seen (is_active, last_seen_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    if (!(await columnExists("attendance_devices", "is_sample"))) {
        await db.execute(
            "ALTER TABLE attendance_devices ADD COLUMN is_sample TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active"
        );
    }

    if (!(await columnExists("attendance_devices", "last_sync_at"))) {
        await db.execute(
            "ALTER TABLE attendance_devices ADD COLUMN last_sync_at DATETIME(6) NULL AFTER last_seen_at"
        );
    }

    if (!(await columnExists("attendance_devices", "last_sync_count"))) {
        await db.execute(
            "ALTER TABLE attendance_devices ADD COLUMN last_sync_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_sync_at"
        );
    }

    if (!(await columnExists("attendance", "record_source"))) {
        await db.execute(
            "ALTER TABLE attendance ADD COLUMN record_source ENUM('manual', 'device') NOT NULL DEFAULT 'manual' AFTER status"
        );
    }

    console.log("Bảng attendance_devices đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo module thiết bị:", error.message);
    await db.end();
    process.exit(1);
});
