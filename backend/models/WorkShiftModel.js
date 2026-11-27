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
    const sql = `${BASE_SELECT} ${where} ORDER BY s.shift_code ASC`;

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

export const findAvailableCode = async (baseCode) => {
    const [rows] = await db.execute(
        `SELECT shift_code
           FROM work_shifts
          WHERE shift_code = ?
             OR shift_code LIKE ?`,
        [baseCode, `${baseCode}-%`]
    );
    const usedCodes = new Set(rows.map((row) => String(row.shift_code || "").toUpperCase()));
    if (!usedCodes.has(baseCode)) return baseCode;

    let suffix = 2;
    while (usedCodes.has(`${baseCode}-${suffix}`)) suffix += 1;
    return `${baseCode}-${suffix}`;
};

export const findNextSequentialCode = async (prefix = "CA") => {
    const [rows] = await db.execute(
        "SELECT shift_code FROM work_shifts WHERE shift_code LIKE ?",
        [`${prefix}%`]
    );
    const usedNumbers = new Set(
        rows.flatMap((row) => {
            const match = String(row.shift_code || "").toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`));
            return match ? [Number(match[1])] : [];
        })
    );

    let sequence = 1;
    while (usedNumbers.has(sequence)) sequence += 1;
    return `${prefix}${String(sequence).padStart(3, "0")}`;
};

export const findActive = async () => {
    const sql = `${BASE_SELECT} WHERE s.status = 1 ORDER BY s.shift_code ASC`;
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
    const [result] = await db.execute(
        `DELETE FROM work_shifts
          WHERE id = ?
            AND NOT EXISTS (
                SELECT 1
                  FROM employee_shift_assignments
                 WHERE shift_id = work_shifts.id
            )`,
        [id]
    );

    if (result.affectedRows > 0) {
        return { deleted: true, reason: null };
    }

    const shift = await findById(id);
    if (!shift) {
        return { deleted: false, reason: "not_found" };
    }

    return { deleted: false, reason: "has_assignments", assignmentCount: await countAssignments(id) };
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

let syncRevisionModeChecked = false;
let syncRevisionUsesUpdatedAt = false;

// DB hiện tại có thể chưa có cột updated_at dù script init đã định nghĩa.
// Thử phát hiện một lần, sau đó chọn đường tính revision phù hợp.
const ensureSyncRevisionMode = async () => {
    if (syncRevisionModeChecked) return;

    try {
        const [columns] = await db.execute(`
            SELECT COUNT(DISTINCT TABLE_NAME) AS total
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN ('work_shifts', 'employee_shift_assignments')
              AND COLUMN_NAME = 'updated_at'
        `);
        syncRevisionUsesUpdatedAt = Number(columns[0]?.total || 0) === 2;
    } catch {
        syncRevisionUsesUpdatedAt = false;
    }

    syncRevisionModeChecked = true;
};

export const getScheduleSyncRevision = async () => {
    await ensureSyncRevisionMode();

    if (syncRevisionUsesUpdatedAt) {
        // Đường nhanh khi schema đã có updated_at: count + mốc cập nhật/id lớn nhất.
        const [rows] = await db.execute(`
            SELECT CONCAT(
                (SELECT COUNT(*) FROM work_shifts), ':',
                COALESCE((SELECT CONCAT(UNIX_TIMESTAMP(MAX(updated_at)), ':', COALESCE(MAX(id), 0))
                    FROM work_shifts), '0:0'), ':',
                (SELECT COUNT(*) FROM employee_shift_assignments), ':',
                COALESCE((SELECT CONCAT(UNIX_TIMESTAMP(MAX(updated_at)), ':', COALESCE(MAX(id), 0))
                    FROM employee_shift_assignments), '0:0')
            ) AS revision
        `);
        return String(rows[0]?.revision || "");
    }

    // Fallback tương thích DB cũ: CRC32 nội dung như trước.
    const [rows] = await db.execute(`
        SELECT CONCAT(
            (SELECT COUNT(*) FROM work_shifts), ':',
            COALESCE((SELECT SUM(CRC32(CONCAT_WS('|', id, shift_code, shift_name,
                morning_start, morning_end, afternoon_start, afternoon_end, status)))
                FROM work_shifts), 0), ':',
            (SELECT COUNT(*) FROM employee_shift_assignments), ':',
            COALESCE((SELECT SUM(CRC32(CONCAT_WS('|', id, employee_id, shift_id,
                start_date, end_date, status, note)))
                FROM employee_shift_assignments), 0)
        ) AS revision
    `);
    return String(rows[0]?.revision || "");
};
