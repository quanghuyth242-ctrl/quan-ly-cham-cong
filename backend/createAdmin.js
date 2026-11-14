
import { db } from "./config/db.js";
import bcrypt from "bcryptjs";

const createAdmin = async () => {
    try {
        const username = "admin";
        const password = "Admin@12345";

        const [check] = await db.execute(
            "SELECT id FROM users WHERE username = ?",
            [username]
        );

        if (check.length > 0) {
            console.log("Tài khoản admin đã tồn tại!");
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.execute(
            `INSERT INTO users (username, password, role, status)
             VALUES (?, ?, ?, ?)`,
            [username, hashedPassword, "admin", "active"]
        );

        console.log("Tạo tài khoản Admin thành công!");

    } catch (error) {
        console.log("Lỗi:", error.message);
    } finally {
        await db.end();
    }
};

createAdmin();
