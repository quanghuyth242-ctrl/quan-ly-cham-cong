import mysql from "mysql2/promise";

export const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "quanlynhansu"
});

try {
    const connection = await db.getConnection();
    console.log("Kết nối MySQL thành công!");
    connection.release();
} catch (error) {
    console.log("Kết nối MySQL thất bại:", error.message);
}