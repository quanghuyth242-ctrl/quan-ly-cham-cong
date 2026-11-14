
import { db } from "../config/db.js";

// Tìm tài khoản theo username
export const findByUsername = async (username) => {
    const sql = "SELECT * FROM users WHERE username = ?";
    const [data] = await db.execute(sql, [username]);

    return data[0] || null;
};

// Tìm tài khoản theo ID
export const findById = async (id) => {
    const sql = "SELECT * FROM users WHERE id = ?";
    const [data] = await db.execute(sql, [id]);

    return data[0] || null;
};

// Lấy tất cả tài khoản
export const findAll = async () => {
    const sql = "SELECT * FROM users";
    const [data] = await db.execute(sql);

    return data;
};
