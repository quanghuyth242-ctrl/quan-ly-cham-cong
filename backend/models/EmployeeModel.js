import { db } from "../config/db.js";

export const findAll = async ({ search = "", department = "", status = "" } = {}) => {
    const conditions = [];
    const params = [];

    if (search) {
        const keyword = `%${search}%`;
        conditions.push("(employee_code LIKE ? OR full_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
        params.push(keyword, keyword, keyword, keyword);
    }

    if (department) {
        conditions.push("department = ?");
        params.push(department);
    }

    if (status === "active") {
        conditions.push("is_active = 1");
    } else if (status === "inactive") {
        conditions.push("is_active = 0");
    }

    const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
    const [rows] = await db.execute(
        `SELECT id,
                employee_code,
                full_name,
                email,
                phone,
                department,
                position,
                is_active,
                DATE_FORMAT(deactivated_at, '%Y-%m-%d %H:%i') AS deactivated_date,
                DATE_FORMAT(created_at, '%Y-%m-%d') AS created_date
           FROM employees
           ${whereClause}
          ORDER BY employee_code DESC, full_name ASC`,
        params
    );

    return rows;
};

export const getDepartments = async () => {
    const [rows] = await db.execute(`
        SELECT department_name
          FROM departments
         ORDER BY department_name ASC
    `);

    return rows.map((row) => row.department_name);
};

export const getPositions = async () => {
    const [rows] = await db.execute(`
        SELECT position_name
          FROM positions
         ORDER BY position_name ASC
    `);
    return rows.map((row) => row.position_name);
};

export const getAvailableEmployeeCodes = async (limit = 20) => {
    const availableCodes = [];
    const batchSize = Math.min(1000, Math.max(100, limit * 2));
    let number = 1;

    while (number <= 999999 && availableCodes.length < limit) {
        const candidates = [];
        for (let end = Math.min(999999, number + batchSize - 1); number <= end; number += 1) {
            candidates.push(`NV${String(number).padStart(3, "0")}`);
        }

        const placeholders = candidates.map(() => "?").join(", ");
        const [rows] = await db.execute(
            `SELECT employee_code FROM employees WHERE employee_code IN (${placeholders})`,
            candidates
        );
        const usedCodes = new Set(rows.map((row) => String(row.employee_code).toUpperCase()));
        for (const code of candidates) {
            if (!usedCodes.has(code)) availableCodes.push(code);
            if (availableCodes.length >= limit) break;
        }
    }

    return availableCodes;
};

export const getStats = async () => {
    const [rows] = await db.execute(`
        SELECT COUNT(*) AS total,
               (SELECT COUNT(*) FROM departments) AS departments,
               COALESCE(SUM(department IS NULL OR TRIM(department) = ''), 0) AS unassigned_department,
               COALESCE(SUM(is_active = 1), 0) AS active,
               COALESCE(SUM(is_active = 0), 0) AS inactive
          FROM employees
    `);

    return {
        total: Number(rows[0].total),
        departments: Number(rows[0].departments),
        unassignedDepartment: Number(rows[0].unassigned_department),
        active: Number(rows[0].active),
        inactive: Number(rows[0].inactive)
    };
};

export const create = async (employee) => {
    const [result] = await db.execute(
        `INSERT INTO employees (employee_code, full_name, email, phone, department, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            employee.employee_code,
            employee.full_name,
            employee.email,
            employee.phone,
            employee.department,
            employee.position
        ]
    );

    return result.insertId;
};

export const findById = async (id) => {
    const [rows] = await db.execute(
        `SELECT id, employee_code, full_name, email, phone, department, position, is_active,
                DATE_FORMAT(created_at, '%Y-%m-%d') AS created_date,
                DATE_FORMAT(deactivated_at, '%Y-%m-%d %H:%i') AS deactivated_date
           FROM employees
          WHERE id = ?
          LIMIT 1`,
        [id]
    );

    return rows[0] || null;
};

export const update = async (id, employee) => {
    await db.execute(
        `UPDATE employees
            SET full_name = ?,
                email = ?,
                phone = ?,
                department = ?,
                position = ?
          WHERE id = ?`,
        [
            employee.full_name,
            employee.email,
            employee.phone,
            employee.department,
            employee.position,
            id
        ]
    );
};

export const setActiveStatus = async (id, isActive) => {
    const [result] = await db.execute(
        `UPDATE employees
            SET is_active = ?,
                deactivated_at = CASE WHEN ? = 0 THEN NOW() ELSE NULL END
          WHERE id = ?`,
        [isActive ? 1 : 0, isActive ? 1 : 0, id]
    );

    return result.affectedRows > 0;
};

export const removeById = async (id) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const [employeeRows] = await connection.execute(
            "SELECT id FROM employees WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!employeeRows[0]) {
            await connection.rollback();
            return { deleted: false, reason: "not_found" };
        }

        const tables = ["attendance", "employee_shift_assignments", "attendance_device_events"];
        const history = {};

        for (const table of tables) {
            const [tableRows] = await connection.execute(
                `SELECT 1 FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
                [table]
            );

            if (tableRows.length === 0) continue;

            const [countRows] = await connection.execute(
                `SELECT COUNT(*) AS total FROM ${table} WHERE employee_id = ?`,
                [id]
            );
            history[table] = Number(countRows[0].total);
        }

        if (Object.values(history).some((count) => count > 0)) {
            await connection.rollback();
            return { deleted: false, reason: "has_history", history };
        }

        const [faceProfileTables] = await connection.execute(
            `SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'face_profiles' LIMIT 1`
        );
        if (faceProfileTables.length > 0) {
            await connection.execute(
                "DELETE FROM face_profiles WHERE employee_id = ?",
                [id]
            );
        }

        const [result] = await connection.execute(
            "DELETE FROM employees WHERE id = ?",
            [id]
        );
        await connection.commit();

        return { deleted: result.affectedRows > 0, reason: result.affectedRows > 0 ? null : "not_found" };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
