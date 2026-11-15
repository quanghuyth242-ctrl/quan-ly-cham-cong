import { db } from "../config/db.js";

const BASE_SELECT = `
    SELECT s.id,
           s.shift_code,
           s.shift_name,
           TIME_FORMAT(s.morning_start, '%H:%i') AS morning_start,
           TIME_FORMAT(s.morning_end, '%H:%i') AS morning_end,
           TIME_FORMAT(s.afternoon_start, '%H:%i') AS afternoon_start,
           TIME_FORMAT(s.afternoon_end, '%H:%i') AS afternoon_end,
           s.status,
           s.created_at,
           (SELECT GROUP_CONCAT(sw.weekday ORDER BY sw.weekday)
              FROM shift_workdays sw
             WHERE sw.shift_id = s.id) AS workdays,
           (SELECT COUNT(*)
              FROM employee_shift_assignments a
             WHERE a.shift_id = s.id) AS assignment_count
      FROM work_shifts s
`;

const mapShift = (row) => ({
    ...row,
    status: Number(row.status),
    assignment_count: Number(row.assignment_count || 0),
    workdays: row.workdays
        ? String(row.workdays).split(",").map(Number)
        : []
});

export const findAll = async ({ search = "", status = "" } = {}) => {
    const conditions = [];
    const params = [];

    if (search) {
        conditions.push("(s.shift_code LIKE ? OR s.shift_name LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }

    if (status === "1" || status === "0") {
        conditions.push("s.status = ?");
        params.push(Number(status));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `${BASE_SELECT} ${where} ORDER BY s.status DESC, s.shift_name ASC`;

    const [rows] = await db.execute(sql, params);
    return rows.map(mapShift);
};

export const findById = async (id) => {
    const sql = `${BASE_SELECT} WHERE s.id = ?`;
    const [rows] = await db.execute(sql, [id]);
    return rows.length > 0 ? mapShift(rows[0]) : null;
};

export const findByCode = async (shiftCode, excludeId = null) => {
    const sql = `
        SELECT id
          FROM work_shifts
         WHERE shift_code = ?
           AND (? IS NULL OR id <> ?)
         LIMIT 1
    `;
    const [rows] = await db.execute(sql, [shiftCode, excludeId, excludeId]);
    return rows[0] || null;
};

export const findActive = async () => {
    const sql = `${BASE_SELECT} WHERE s.status = 1 ORDER BY s.shift_name ASC`;
    const [rows] = await db.execute(sql);
    return rows.map(mapShift);
};

export const create = async (data) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO work_shifts
                (shift_code, shift_name, morning_start, morning_end,
                 afternoon_start, afternoon_end, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                data.shift_code,
                data.shift_name,
                data.morning_start,
                data.morning_end,
                data.afternoon_start,
                data.afternoon_end,
                data.status
            ]
        );

        for (const weekday of data.workdays) {
            await connection.execute(
                "INSERT INTO shift_workdays (shift_id, weekday) VALUES (?, ?)",
                [result.insertId, weekday]
            );
        }

        await connection.commit();
        return result.insertId;
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

        await connection.execute(
            `UPDATE work_shifts
                SET shift_code = ?,
                    shift_name = ?,
                    morning_start = ?,
                    morning_end = ?,
                    afternoon_start = ?,
                    afternoon_end = ?,
                    status = ?
              WHERE id = ?`,
            [
                data.shift_code,
                data.shift_name,
                data.morning_start,
                data.morning_end,
                data.afternoon_start,
                data.afternoon_end,
                data.status,
                id
            ]
        );

        await connection.execute(
            "DELETE FROM shift_workdays WHERE shift_id = ?",
            [id]
        );

        for (const weekday of data.workdays) {
            await connection.execute(
                "INSERT INTO shift_workdays (shift_id, weekday) VALUES (?, ?)",
                [id, weekday]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const remove = async (id) => {
    await db.execute("DELETE FROM work_shifts WHERE id = ?", [id]);
};

export const setStatus = async (id, status) => {
    await db.execute(
        "UPDATE work_shifts SET status = ? WHERE id = ?",
        [status, id]
    );
};

export const countAssignments = async (id) => {
    const [rows] = await db.execute(
        "SELECT COUNT(*) AS total FROM employee_shift_assignments WHERE shift_id = ?",
        [id]
    );
    return Number(rows[0].total);
};

export const getStats = async () => {
    const [rows] = await db.execute(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(status = 1), 0) AS active,
               COALESCE(SUM(status = 0), 0) AS inactive
          FROM work_shifts
    `);

    return {
        total: Number(rows[0].total),
        active: Number(rows[0].active),
        inactive: Number(rows[0].inactive)
    };
};
