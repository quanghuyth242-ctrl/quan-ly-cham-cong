import { db } from "../config/db.js";

export const findAll = async ({ search = "", department = "" } = {}) => {
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
               COALESCE(SUM(department IS NULL OR TRIM(department) = ''), 0) AS unassigned_department
          FROM employees
    `);

    return {
        total: Number(rows[0].total),
        departments: Number(rows[0].departments),
        unassignedDepartment: Number(rows[0].unassigned_department)
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
