import { db } from "../config/db.js";

const STATUS_VALUES = {
    present: "present",
    on_time: "present",
    "đúng giờ": "present",
    late: "late",
    "đi muộn": "late",
    absent: "absent",
    "vắng mặt": "absent"
};

const STATUS_LABELS = {
    present: "Đúng giờ",
    late: "Đi muộn",
    absent: "Vắng mặt"
};

const BASE_SELECT = `
    SELECT a.id,
           a.employee_id,
           e.employee_code,
           e.full_name AS employee_name,
           DATE_FORMAT(a.work_date, '%Y-%m-%d') AS work_date,
           TIME_FORMAT(a.check_in, '%H:%i') AS check_in,
           TIME_FORMAT(a.check_out, '%H:%i') AS check_out,
           COALESCE(
               ROUND(GREATEST(0, TIMESTAMPDIFF(MINUTE, a.check_in, a.check_out)) / 60, 2),
               0
           ) AS total_hours,
           a.status
      FROM attendance a
      INNER JOIN employees e ON e.id = a.employee_id
`;

const mapRecord = (row) => {
    const rawStatus = String(row.status || "");
    const normalizedStatus = STATUS_VALUES[rawStatus.trim().toLocaleLowerCase()] || rawStatus;

    return {
        ...row,
        status: normalizedStatus,
        status_label: STATUS_LABELS[normalizedStatus] || rawStatus || "Chưa xác định",
        total_hours: Number(row.total_hours || 0)
    };
};

export const findAll = async () => {
    const [rows] = await db.execute(
        `${BASE_SELECT} ORDER BY a.work_date DESC, e.full_name ASC, a.id DESC`
    );
    return rows.map(mapRecord);
};

export const findById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id, employee_id, work_date FROM attendance WHERE id = ? LIMIT 1",
        [id]
    );
    return rows[0] || null;
};

export const findByEmployeeDate = async (employeeId, workDate, excludeId = null) => {
    const [rows] = await db.execute(
        `SELECT id
           FROM attendance
          WHERE employee_id = ?
            AND work_date = ?
            AND (? IS NULL OR id <> ?)
          LIMIT 1`,
        [employeeId, workDate, excludeId, excludeId]
    );
    return rows[0] || null;
};

export const findEmployeeById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id FROM employees WHERE id = ? LIMIT 1",
        [id]
    );
    return rows[0] || null;
};

export const getEmployees = async () => {
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         ORDER BY full_name ASC
    `);
    return rows;
};

export const getStats = async () => {
    const [rows] = await db.execute(`
        SELECT
            (SELECT COUNT(*) FROM employees) AS total_employees,
            COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('present', 'on_time', 'đúng giờ')), 0) AS present,
            COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('late', 'đi muộn')), 0) AS late,
            COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('absent', 'vắng mặt')), 0) AS absent
          FROM attendance
    `);

    return {
        total_employees: Number(rows[0].total_employees),
        present: Number(rows[0].present),
        late: Number(rows[0].late),
        absent: Number(rows[0].absent)
    };
};

const toDateTime = (workDate, time) => time ? `${workDate} ${time}:00` : null;

export const create = async (data) => {
    const [result] = await db.execute(
        `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
            data.employee_id,
            data.work_date,
            toDateTime(data.work_date, data.check_in),
            toDateTime(data.work_date, data.check_out),
            data.status
        ]
    );
    return result.insertId;
};

export const update = async (id, data) => {
    await db.execute(
        `UPDATE attendance
            SET employee_id = ?,
                work_date = ?,
                check_in = ?,
                check_out = ?,
                status = ?
          WHERE id = ?`,
        [
            data.employee_id,
            data.work_date,
            toDateTime(data.work_date, data.check_in),
            toDateTime(data.work_date, data.check_out),
            data.status,
            id
        ]
    );
};