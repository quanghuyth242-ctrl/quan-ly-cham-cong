import { db } from "../config/db.js";

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS positions (
            id INT NOT NULL AUTO_INCREMENT,
            position_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_positions_name (position_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    const [columns] = await db.execute("SHOW COLUMNS FROM employees LIKE 'position'");
    if (columns.length === 0) {
        await db.execute("ALTER TABLE employees ADD COLUMN position VARCHAR(100) NULL AFTER department");
    }
    await db.execute(`
        INSERT IGNORE INTO positions (position_name)
        SELECT DISTINCT TRIM(position) FROM employees
         WHERE position IS NOT NULL AND TRIM(position) <> ''
    `);
    await db.query(`
        INSERT IGNORE INTO positions (position_name) VALUES
            ('Giám đốc'),
            ('Trưởng phòng'),
            ('Phó phòng'),
            ('Chuyên viên nhân sự'),
            ('Nhân viên hành chính'),
            ('Kế toán viên'),
            ('Nhân viên kinh doanh'),
            ('Nhân viên marketing'),
            ('Kỹ thuật viên'),
            ('Nhân viên công nghệ thông tin'),
            ('Nhân viên chăm sóc khách hàng'),
            ('Bảo vệ')
    `);
    console.log("Bảng positions đã sẵn sàng và đã đồng bộ chức vụ hiện có.");
    await db.end();
};
main().catch(async (error) => {
    console.error("Lỗi khởi tạo module chức vụ:", error.message);
    await db.end();
    process.exit(1);
});
