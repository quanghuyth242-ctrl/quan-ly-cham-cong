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
          ORDER BY full_name ASC, employee_code ASC`,
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
