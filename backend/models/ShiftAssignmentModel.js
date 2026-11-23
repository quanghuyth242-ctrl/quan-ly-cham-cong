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
    startDate = "",
    endDate = "",
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

    if (endDate) {
        conditions.push("a.start_date <= ?");
        params.push(endDate);
    }

    if (startDate) {
        conditions.push("a.end_date >= ?");
        params.push(startDate);
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
        "SELECT id, employee_code, full_name, department FROM employees WHERE id = ? AND is_active = 1",
        [id]
    );
    return rows[0] || null;
};

export const getEmployeeOptions = async () => {
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         WHERE is_active = 1
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

const assertCanSaveAssignment = async (connection, data, excludeId = null) => {
    const [employees] = await connection.execute(
        "SELECT id, full_name, is_active FROM employees WHERE id = ? FOR UPDATE",
        [data.employee_id]
    );
    if (employees.length === 0 || Number(employees[0].is_active) !== 1) {
        const error = new Error("Nhân viên không tồn tại hoặc đã ngừng hoạt động.");
        error.code = "SHIFT_ASSIGNMENT_EMPLOYEE_INACTIVE";
        error.employeeName = employees[0]?.full_name || String(data.employee_id);
        throw error;
    }

    const [shifts] = await connection.execute(
        "SELECT id FROM work_shifts WHERE id = ? AND status = 1 FOR UPDATE",
        [data.shift_id]
    );
    if (shifts.length === 0) {
        const error = new Error("Ca làm việc không tồn tại hoặc đã ngừng hoạt động.");
        error.code = "SHIFT_ASSIGNMENT_SHIFT_INACTIVE";
        throw error;
    }

    const [conflicts] = await connection.execute(
        `SELECT a.id,
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
          LIMIT 1`,
        [data.employee_id, data.end_date, data.start_date, excludeId, excludeId]
    );

    if (conflicts.length > 0) {
        const error = new Error("Khoảng thời gian phân ca bị trùng.");
        error.code = "SHIFT_ASSIGNMENT_CONFLICT";
        error.conflict = conflicts[0];
        error.employeeName = employees[0].full_name;
        throw error;
    }
};

export const create = async (data) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await assertCanSaveAssignment(connection, data);

        const [result] = await connection.execute(
            `INSERT INTO employee_shift_assignments
                (employee_id, shift_id, start_date, end_date, status, note)
             VALUES (?, ?, ?, ?, 'active', ?)`,
            [data.employee_id, data.shift_id, data.start_date, data.end_date, data.note]
        );

        await connection.commit();
        return result.insertId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const createMany = async (data, employeeIds) => {
    const connection = await db.getConnection();
    const created = [];
    const skipped = [];

    try {
        await connection.beginTransaction();

        for (const employeeId of [...new Set(employeeIds)].sort((a, b) => a - b)) {
            try {
                const employeeData = { ...data, employee_id: employeeId };
                await assertCanSaveAssignment(connection, employeeData);
                await connection.execute(
                    `INSERT INTO employee_shift_assignments
                        (employee_id, shift_id, start_date, end_date, status, note)
                     VALUES (?, ?, ?, ?, 'active', ?)`,
                    [employeeId, data.shift_id, data.start_date, data.end_date, data.note]
                );
                created.push(employeeId);
            } catch (error) {
                if (!["SHIFT_ASSIGNMENT_CONFLICT", "SHIFT_ASSIGNMENT_EMPLOYEE_INACTIVE", "SHIFT_ASSIGNMENT_SHIFT_INACTIVE"].includes(error.code)) {
                    throw error;
                }

                skipped.push({
                    employeeName: error.employeeName || String(employeeId),
                    reason: error.code === "SHIFT_ASSIGNMENT_CONFLICT"
                        ? `trùng ca ${error.conflict.shift_name} (${error.conflict.start_date} - ${error.conflict.end_date})`
                        : "nhân viên hoặc ca đã ngừng hoạt động"
                });
            }
        }

        await connection.commit();
        return { created, skipped };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const update = async (id, data) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await assertCanSaveAssignment(connection, data, id);

        await connection.execute(
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

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const adjustShift = async (id, { shift_id: shiftId, effective_date: effectiveDate, note = "" }) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [initialRows] = await connection.execute(
            `SELECT employee_id
               FROM employee_shift_assignments
              WHERE id = ?`,
            [id]
        );
        if (initialRows.length === 0) {
            const error = new Error("Phân ca không tồn tại.");
            error.code = "SHIFT_ASSIGNMENT_NOT_FOUND";
            throw error;
        }

        const employeeId = initialRows[0].employee_id;
        const [employees] = await connection.execute(
            "SELECT id, is_active FROM employees WHERE id = ? FOR UPDATE",
            [employeeId]
        );
        if (employees.length === 0 || Number(employees[0].is_active) !== 1) {
            const error = new Error("Nhân viên đã ngừng hoạt động.");
            error.code = "SHIFT_ASSIGNMENT_EMPLOYEE_INACTIVE";
            throw error;
        }

        const [assignmentRows] = await connection.execute(
            `SELECT id, employee_id, shift_id, status, note,
                    DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
               FROM employee_shift_assignments
              WHERE id = ?
              FOR UPDATE`,
            [id]
        );
        const assignment = assignmentRows[0];
        if (!assignment || Number(assignment.employee_id) !== Number(employeeId)) {
            const error = new Error("Lịch phân ca vừa được thay đổi. Vui lòng tải lại trang.");
            error.code = "SHIFT_ASSIGNMENT_CHANGED";
            throw error;
        }
        if (assignment.status !== "active") {
            const error = new Error("Chỉ có thể điều chỉnh lịch đang áp dụng.");
            error.code = "SHIFT_ASSIGNMENT_NOT_ACTIVE";
            throw error;
        }
        if (effectiveDate < assignment.start_date || effectiveDate > assignment.end_date) {
            const error = new Error("Ngày hiệu lực phải nằm trong khoảng lịch đang áp dụng.");
            error.code = "SHIFT_ASSIGNMENT_INVALID_EFFECTIVE_DATE";
            throw error;
        }

        const [shifts] = await connection.execute(
            "SELECT id, status FROM work_shifts WHERE id = ? FOR UPDATE",
            [shiftId]
        );
        if (shifts.length === 0 || Number(shifts[0].status) !== 1) {
            const error = new Error("Ca mới không tồn tại hoặc đã ngừng hoạt động.");
            error.code = "SHIFT_ASSIGNMENT_SHIFT_INACTIVE";
            throw error;
        }
        if (Number(assignment.shift_id) === Number(shiftId)) {
            const error = new Error("Ca được chọn đang giống ca hiện tại.");
            error.code = "SHIFT_ASSIGNMENT_NO_CHANGE";
            throw error;
        }

        const [conflicts] = await connection.execute(
            `SELECT DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
                    s.shift_name
               FROM employee_shift_assignments a
               INNER JOIN work_shifts s ON s.id = a.shift_id
              WHERE a.employee_id = ?
                AND a.status = 'active'
                AND a.id <> ?
                AND a.start_date <= ?
                AND a.end_date >= ?
              LIMIT 1`,
            [employeeId, id, assignment.end_date, effectiveDate]
        );
        if (conflicts.length > 0) {
            const error = new Error("Khoảng thời gian điều chỉnh bị trùng lịch.");
            error.code = "SHIFT_ASSIGNMENT_CONFLICT";
            error.conflict = conflicts[0];
            throw error;
        }

        const nextNote = String(note || assignment.note || "").trim().slice(0, 255) || null;
        let newAssignmentId = id;
        if (effectiveDate === assignment.start_date) {
            await connection.execute(
                `UPDATE employee_shift_assignments
                    SET shift_id = ?, note = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [shiftId, nextNote, id]
            );
        } else {
            await connection.execute(
                `UPDATE employee_shift_assignments
                    SET end_date = DATE_SUB(?, INTERVAL 1 DAY),
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                [effectiveDate, id]
            );
            const [result] = await connection.execute(
                `INSERT INTO employee_shift_assignments
                    (employee_id, shift_id, start_date, end_date, status, note)
                 VALUES (?, ?, ?, ?, 'active', ?)`,
                [employeeId, shiftId, effectiveDate, assignment.end_date, nextNote]
            );
            newAssignmentId = result.insertId;
        }

        await connection.commit();
        return { assignmentId: newAssignmentId, split: effectiveDate !== assignment.start_date };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
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
