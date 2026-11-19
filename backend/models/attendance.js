import { db } from "../config/db.js";

const ATTENDANCE_STATUS_FILTERS = [
    "all",
    "checked_in",
    "checked_out",
    "not_checked_in",
    "late",
    "early_leave"
];

export const normalizeAttendanceStatus = (status) => {
    const value = String(status || "all").toLowerCase();

    return ATTENDANCE_STATUS_FILTERS.includes(value) ? value : "all";
};

const buildStatusCondition = (status) => {
    switch (status) {
        case "checked_in":
            return "a.check_in IS NOT NULL";
        case "checked_out":
            return "a.check_out IS NOT NULL";
        case "not_checked_in":
            return "a.check_in IS NULL";
        case "late":
            return "a.status LIKE '%late%'";
        case "early_leave":
            return "a.status LIKE '%early_leave%'";
        default:
            return null;
    }
};

export const findEmployeeById = async (employeeId) => {
    const [rows] = await db.execute(
        `SELECT id,
                employee_code,
                full_name,
                department,
                email,
                phone
           FROM employees
          WHERE id = ?
          LIMIT 1`,
        [employeeId]
    );

    return rows[0] || null;
};

export const getDepartments = async () => {
    const [rows] = await db.execute(
        `SELECT DISTINCT department
           FROM employees
          WHERE department IS NOT NULL
            AND department <> ''
          ORDER BY department ASC`
    );

    return rows.map((row) => row.department);
};

/**
 * Danh sách nhân viên kèm bản ghi chấm công của một ngày.
 * Nhân viên chưa chấm công vẫn xuất hiện để quản trị viên có thể
 * chấm công thủ công khi camera/nhận diện gặp sự cố.
 */
export const getRosterForDate = async ({
    date,
    search = "",
    department = "",
    status = "all"
} = {}) => {
    const conditions = [];
    const params = [date];

    const keyword = String(search || "").trim();

    if (keyword) {
        conditions.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)");

        const like = `%${keyword}%`;
        params.push(like, like);
    }

    const departmentValue = String(department || "").trim();

    if (departmentValue) {
        conditions.push("e.department = ?");
        params.push(departmentValue);
    }

    const statusCondition = buildStatusCondition(
        normalizeAttendanceStatus(status)
    );

    if (statusCondition) {
        conditions.push(statusCondition);
    }

    const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const sql = `
        SELECT e.id AS employee_id,
               e.employee_code,
               e.full_name,
               e.department,
               e.email,
               e.phone,
               fp.id AS face_profile_id,
               a.id AS attendance_id,
               DATE_FORMAT(a.work_date, '%Y-%m-%d') AS work_date,
               a.check_in,
               a.check_out,
               a.status
          FROM employees e
          LEFT JOIN attendance a
            ON a.employee_id = e.id
           AND a.work_date = ?
          LEFT JOIN face_profiles fp
            ON fp.employee_id = e.id
          ${whereClause}
         ORDER BY e.employee_code ASC, e.id ASC
    `;

    const [rows] = await db.execute(sql, params);

    return rows;
};

export const findByEmployeeAndDateForUpdate = async (
    connection,
    employeeId,
    workDate
) => {
    const [rows] = await connection.execute(
        `SELECT id,
                employee_id,
                DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
                check_in,
                check_out,
                status
           FROM attendance
          WHERE employee_id = ?
            AND work_date = ?
          FOR UPDATE`,
        [employeeId, workDate]
    );

    return rows[0] || null;
};

const findAttendanceById = async (connection, attendanceId) => {
    const [rows] = await connection.execute(
        `SELECT id,
                employee_id,
                DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
                check_in,
                check_out,
                status
           FROM attendance
          WHERE id = ?
          LIMIT 1`,
        [attendanceId]
    );

    return rows[0] || null;
};

export const insertCheckIn = async (
    connection,
    { employeeId, workDate, checkIn, status }
) => {
    const [result] = await connection.execute(
        `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status)
         VALUES (?, ?, ?, NULL, ?)`,
        [employeeId, workDate, checkIn, status]
    );

    return findAttendanceById(connection, result.insertId);
};

export const updateCheckOut = async (
    connection,
    { attendanceId, checkOut, status }
) => {
    await connection.execute(
        `UPDATE attendance
            SET check_out = ?,
                status = ?
          WHERE id = ?`,
        [checkOut, status, attendanceId]
    );

    return findAttendanceById(connection, attendanceId);
};
