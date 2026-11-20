import { db } from "../config/db.js";

export const findAll = async () => {
    const [rows] = await db.execute(`
        SELECT p.id, p.position_name,
               DATE_FORMAT(p.created_at, '%Y-%m-%d') AS created_date,
               COUNT(e.id) AS employee_count
          FROM positions p
          LEFT JOIN employees e ON TRIM(e.position) = p.position_name
         GROUP BY p.id, p.position_name, p.created_at
         ORDER BY p.position_name ASC
    `);
    return rows.map((row) => ({ ...row, employee_count: Number(row.employee_count || 0) }));
};

export const create = async (name) => {
    const [result] = await db.execute("INSERT INTO positions (position_name) VALUES (?)", [name]);
    return result.insertId;
};

export const renameById = async (id, name) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute("SELECT position_name FROM positions WHERE id = ? FOR UPDATE", [id]);
        if (!rows[0]) {
            await connection.rollback();
            return false;
        }
        const previousName = rows[0].position_name;
        if (previousName !== name) {
            await connection.execute("UPDATE employees SET position = ? WHERE TRIM(position) = ?", [name, previousName]);
            await connection.execute("UPDATE positions SET position_name = ? WHERE id = ?", [name, id]);
        }
        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const removeById = async (id) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute("SELECT position_name FROM positions WHERE id = ? FOR UPDATE", [id]);
        if (!rows[0]) {
            await connection.rollback();
            return "not_found";
        }
        const [counts] = await connection.execute("SELECT COUNT(*) AS total FROM employees WHERE TRIM(position) = ?", [rows[0].position_name]);
        if (Number(counts[0].total) > 0) {
            await connection.rollback();
            return "has_employees";
        }
        await connection.execute("DELETE FROM positions WHERE id = ?", [id]);
        await connection.commit();
        return "deleted";
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
