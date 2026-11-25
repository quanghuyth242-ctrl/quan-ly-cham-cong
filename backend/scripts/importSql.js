// Nạp file .sql vào MySQL đúng bảng mã UTF-8 (tránh lỗi chữ loạn khi import bằng công cụ khác).
// Cách dùng:  node backend/scripts/importSql.js "C:\duong\dan\quanlynhansu_full_1.sql"
// CẢNH BÁO: lệnh này XÓA database quanlynhansu hiện có rồi nạp lại từ file.
import fs from "fs";
import mysql from "mysql2/promise";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
    console.log("Không tìm thấy file. Cách dùng: node backend/scripts/importSql.js \"đường\\dẫn\\file.sql\"");
    process.exit(1);
}

const sql = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    charset: "utf8mb4",
    multipleStatements: true
});

try {
    await connection.query("DROP DATABASE IF EXISTS quanlynhansu");
    await connection.query(sql);
    const [rows] = await connection.query("SELECT full_name, department FROM quanlynhansu.employees ORDER BY id LIMIT 3");
    console.log("Đã nạp xong. 3 nhân viên đầu tiên:", rows);
} catch (error) {
    console.log("Lỗi khi nạp file:", error.message);
    process.exitCode = 1;
} finally {
    await connection.end();
}