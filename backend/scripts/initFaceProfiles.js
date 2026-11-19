import { db } from "../config/db.js";

/**
 * Script tạo bảng face_profiles nếu database chưa có.
 * Chạy khi cần: node backend/scripts/initFaceProfiles.js
 *
 * Lưu ý: script chỉ tạo bảng mới, không sửa bảng employees
 * hay bất kỳ bảng nào khác.
 */
const main = async () => {
    console.log("=== Khởi tạo bảng face_profiles ===");

    await db.query(`
        CREATE TABLE IF NOT EXISTS face_profiles (
            id INT NOT NULL AUTO_INCREMENT,
            employee_id INT NOT NULL,
            face_embedding LONGBLOB NOT NULL,
            consent_at DATETIME NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uk_face_profiles_employee (employee_id),
            CONSTRAINT fk_face_profiles_employee
                FOREIGN KEY (employee_id) REFERENCES employees (id)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    console.log("+ Bảng face_profiles đã sẵn sàng.");
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi khởi tạo bảng face_profiles:", error.message);
    await db.end();
    process.exit(1);
});
