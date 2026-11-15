import { db } from "../config/db.js";

const BASE_SELECT = `
    SELECT a.id,
           a.employee_id,
           a.shift_id,
           a.status,
           a.note,
           DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
           a.created_at,
           e.employee_code,
           e.full_name,
           e.department,
           s.shift_code,
           s.shift_name,
           TIME_FORMAT(s.morning_start, '%H:%i') AS morning_start,
           TIME_FORMAT(s.morning_end, '%H:%i') AS morning_end,
           TIME_FORMAT(s.afternoon_start, '%H:%i') AS afternoon_start,
           TIME_FORMAT(s.afternoon_end, '%H:%i') AS afternoon_end,
           (SELECT GROUP_CONCAT(sw.weekday ORDER BY sw.weekday)
              FROM shift_workdays sw
             WHERE sw.shift_id = s.id) AS workdays
      FROM employee_shift_assignments a
      INNER JOIN employees e ON e.id = a.employee_id
      INNER JOIN work_shifts s ON s.id = a.shift_id
`;

const mapAssignment = (row) => ({
    ...row,
    workdays: row.workdays
        ? String(row.workdays).split(",").map(Number)
        : []
});

export const findAll = async ({
    search = "",
    department = "",
    shiftId = "",
    status = "active"
} = {}) => {
    const conditions = [];
    const params = [];

    if (search) {
        conditions.push("(e.full_name LIKE ? OR e.employee_code LIKE ? OR s.shift_name LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (department) {
        conditions.push("e.department = ?");
        params.push(department);
    }

    if (shiftId) {
        conditions.push("a.shift_id = ?");
        params.push(Number(shiftId));
    }

    if (status === "active" || status === "cancelled") {
        conditions.push("a.status = ?");
        params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
        ${BASE_SELECT}
        ${where}
        ORDER BY a.status = 'active' DESC, a.start_date DESC, a.id DESC
    `;

    const [rows] = await db.execute(sql, params);
    return rows.map(mapAssignment);
};

export const findById = async (id) => {
    const sql = `${BASE_SELECT} WHERE a.id = ?`;
    const [rows] = await db.execute(sql, [id]);
    return rows.length > 0 ? mapAssignment(rows[0]) : null;
};

export const findEmployeeById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id, employee_code, full_name, department FROM employees WHERE id = ?",
        [id]
    );
    return rows[0] || null;
};

export const getEmployeeOptions = async () => {
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         ORDER BY full_name ASC
    `);
    return rows;
};

export const getDepartments = async () => {
    const [rows] = await db.execute(`
        SELECT DISTINCT department
          FROM employees
         WHERE department IS NOT NULL
           AND department <> ''
         ORDER BY department ASC
    `);
    return rows.map((row) => row.department);
};

export const findConflict = async (employeeId, startDate, endDate, excludeId = null) => {
    const sql = `
        SELECT a.id,
               DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
               DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
               s.shift_name
          FROM employee_shift_assignments a
          INNER JOIN work_shifts s ON s.id = a.shift_id
         WHERE a.employee_id = ?
           AND a.status = 'active'
           AND a.start_date <= ?
           AND a.end_date >= ?
           AND (? IS NULL OR a.id <> ?)
         LIMIT 1
    `;

    const [rows] = await db.execute(sql, [employeeId, endDate, startDate, excludeId, excludeId]);
    return rows[0] || null;
};

export const create = async (data) => {
    const [result] = await db.execute(
        `INSERT INTO employee_shift_assignments
            (employee_id, shift_id, start_date, end_date, status, note)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [data.employee_id, data.shift_id, data.start_date, data.end_date, data.note]
    );

    return result.insertId;
};

export const update = async (id, data) => {
    await db.execute(
        `UPDATE employee_shift_assignments
            SET employee_id = ?,
                shift_id = ?,
                start_date = ?,
                end_date = ?,
                note = ?,
                status = 'active'
          WHERE id = ?`,
        [data.employee_id, data.shift_id, data.start_date, data.end_date, data.note, id]
    );
};

export const cancel = async (id) => {
    await db.execute(
        "UPDATE employee_shift_assignments SET status = 'cancelled' WHERE id = ?",
        [id]
    );
};

export const getStats = async () => {
    const [rows] = await db.execute(`
        SELECT
            (SELECT COUNT(*)
               FROM employee_shift_assignments
              WHERE status = 'active') AS active_assignments,
            (SELECT COUNT(*)
               FROM employee_shift_assignments
              WHERE status = 'cancelled') AS cancelled_assignments,
            (SELECT COUNT(DISTINCT employee_id)
               FROM employee_shift_assignments
              WHERE status = 'active') AS assigned_employees
    `);

    return {
        activeAssignments: Number(rows[0].active_assignments),
        cancelledAssignments: Number(rows[0].cancelled_assignments),
        assignedEmployees: Number(rows[0].assigned_employees)
    };
};
