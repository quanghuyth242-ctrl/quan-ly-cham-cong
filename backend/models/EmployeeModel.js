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
        SELECT DISTINCT department
          FROM employees
         WHERE department IS NOT NULL
           AND TRIM(department) <> ''
         ORDER BY department ASC
    `);

    return rows.map((row) => row.department);
};

export const getAvailableEmployeeCodes = async (limit = 20) => {
    const [rows] = await db.execute(
        "SELECT employee_code FROM employees WHERE employee_code LIKE 'NV%'"
    );
    const usedCodes = new Set(rows.map((row) => String(row.employee_code).toUpperCase()));
    const availableCodes = [];

    for (let number = 1; number <= 999999 && availableCodes.length < limit; number += 1) {
        const code = `NV${String(number).padStart(3, "0")}`;
        if (!usedCodes.has(code)) availableCodes.push(code);
    }

    return availableCodes;
};

export const getStats = async () => {
    const [rows] = await db.execute(`
        SELECT COUNT(*) AS total,
               COUNT(DISTINCT NULLIF(TRIM(department), '')) AS departments,
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
        `INSERT INTO employees (employee_code, full_name, email, phone, department)
         VALUES (?, ?, ?, ?, ?)`,
        [
            employee.employee_code,
            employee.full_name,
            employee.email,
            employee.phone,
            employee.department
        ]
    );

    return result.insertId;
};

export const findById = async (id) => {
    const [rows] = await db.execute(
        `SELECT id, employee_code, full_name, email, phone, department, is_active,
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
                department = ?
          WHERE id = ?`,
        [
            employee.full_name,
            employee.email,
            employee.phone,
            employee.department,
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
