import { db } from "../config/db.js";

export const findAll = async () => {
    const [rows] = await db.execute(`
        SELECT d.id,
               d.department_name,
               DATE_FORMAT(d.created_at, '%Y-%m-%d') AS created_date,
               COUNT(e.id) AS employee_count
          FROM departments d
          LEFT JOIN employees e
            ON TRIM(e.department) = d.department_name
         GROUP BY d.id, d.department_name, d.created_at
         ORDER BY d.department_name ASC
    `);

    return rows.map((row) => ({
        ...row,
        employee_count: Number(row.employee_count || 0)
    }));
};

export const create = async (departmentName) => {
    const [result] = await db.execute(
        "INSERT INTO departments (department_name) VALUES (?)",
        [departmentName]
    );

    return result.insertId;
};

export const renameById = async (id, departmentName) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            "SELECT department_name FROM departments WHERE id = ? FOR UPDATE",
            [id]
        );
        if (!rows[0]) {
            await connection.rollback();
            return false;
        }

        const previousName = rows[0].department_name;
        if (previousName === departmentName) {
            await connection.commit();
            return true;
        }

        await connection.execute(
            "UPDATE employees SET department = ? WHERE TRIM(department) = ?",
            [departmentName, previousName]
        );
        const [result] = await connection.execute(
            "UPDATE departments SET department_name = ? WHERE id = ?",
            [departmentName, id]
        );
        await connection.commit();

        return result.affectedRows > 0;
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
        const [rows] = await connection.execute(
            "SELECT department_name FROM departments WHERE id = ? FOR UPDATE",
            [id]
        );
        if (!rows[0]) {
            await connection.rollback();
            return { deleted: false, reason: "not_found" };
        }

        const [employeeRows] = await connection.execute(
            "SELECT COUNT(*) AS total FROM employees WHERE TRIM(department) = ?",
            [rows[0].department_name]
        );
        const employeeCount = Number(employeeRows[0].total);
        if (employeeCount > 0) {
            await connection.rollback();
            return { deleted: false, reason: "has_employees", employeeCount };
        }

        const [result] = await connection.execute(
            "DELETE FROM departments WHERE id = ?",
            [id]
        );
        await connection.commit();

        return { deleted: result.affectedRows > 0, reason: result.affectedRows ? null : "not_found" };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
