import { db } from "../config/db.js";

const main = async () => {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS departments (
            id INT NOT NULL AUTO_INCREMENT,
            department_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_departments_name (department_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await db.execute(`
        INSERT IGNORE INTO departments (department_name)
        SELECT DISTINCT TRIM(department)
          FROM employees
         WHERE department IS NOT NULL
           AND TRIM(department) <> ''
    `);

    console.log("Bảng departments đã sẵn sàng và đã đồng bộ các phòng ban hiện có.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo module phòng ban:", error.message);
    await db.end();
    process.exit(1);
});
