import { createHash } from "node:crypto";
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
           a.status,
           CASE WHEN sw.shift_id IS NOT NULL THEN 1 ELSE 0 END AS has_schedule,
           CASE WHEN sw.shift_id IS NOT NULL THEN ws.shift_name ELSE NULL END AS shift_name,
           CASE WHEN sw.shift_id IS NOT NULL THEN ws.shift_code ELSE NULL END AS shift_code,
           CASE WHEN sw.shift_id IS NOT NULL THEN TIME_FORMAT(ws.morning_start, '%H:%i') ELSE NULL END AS scheduled_start,
           CASE WHEN sw.shift_id IS NOT NULL THEN TIME_FORMAT(ws.afternoon_end, '%H:%i') ELSE NULL END AS scheduled_end,
           CASE
               WHEN sw.shift_id IS NOT NULL
                AND a.check_in IS NOT NULL
                AND LOWER(COALESCE(a.status, '')) NOT IN ('absent', 'vắng mặt')
               THEN GREATEST(
                   TIMESTAMPDIFF(MINUTE, TIMESTAMP(a.work_date, ws.morning_start), a.check_in),
                   0
               )
               ELSE NULL
           END AS late_minutes,
           CASE
               WHEN sw.shift_id IS NOT NULL
                AND a.check_out IS NOT NULL
                AND LOWER(COALESCE(a.status, '')) NOT IN ('absent', 'vắng mặt')
               THEN GREATEST(
                   TIMESTAMPDIFF(MINUTE, a.check_out, TIMESTAMP(a.work_date, ws.afternoon_end)),
                   0
               )
               ELSE NULL
           END AS early_leave_minutes
      FROM attendance a
      INNER JOIN employees e ON e.id = a.employee_id
      LEFT JOIN employee_shift_assignments sa
        ON sa.employee_id = a.employee_id
       AND sa.status = 'active'
       AND a.work_date BETWEEN sa.start_date AND sa.end_date
      LEFT JOIN work_shifts ws
        ON ws.id = sa.shift_id
       AND ws.status = 1
      LEFT JOIN shift_workdays sw
        ON sw.shift_id = ws.id
       AND sw.weekday = WEEKDAY(a.work_date) + 1
`;

const mapRecord = (row) => {
    const rawStatus = String(row.status || "");
    const normalizedStatus = STATUS_VALUES[rawStatus.trim().toLocaleLowerCase()] || rawStatus;

    return {
        ...row,
        status: normalizedStatus,
        status_label: STATUS_LABELS[normalizedStatus] || rawStatus || "Chưa xác định",
        total_hours: Number(row.total_hours || 0),
        has_schedule: Boolean(Number(row.has_schedule)),
        late_minutes: row.late_minutes === null ? null : Number(row.late_minutes),
        early_leave_minutes: row.early_leave_minutes === null
            ? null
            : Number(row.early_leave_minutes)
    };
};

export const findAll = async () => {
    const [rows] = await db.execute(
        `${BASE_SELECT} ORDER BY e.employee_code DESC, a.work_date DESC, a.id DESC`
    );
    const latestByEmployee = new Map();

    for (const row of rows) {
        if (!latestByEmployee.has(row.employee_id)) {
            latestByEmployee.set(row.employee_id, mapRecord(row));
        }
    }

    return [...latestByEmployee.values()].sort((left, right) =>
        String(right.employee_code).localeCompare(String(left.employee_code), "en", { numeric: true })
    );
};

export const findById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id, employee_id, work_date FROM attendance WHERE id = ? LIMIT 1",
        [id]
    );
    return rows[0] || null;
};

export const findEmployeeDetailsById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id, employee_code, full_name FROM employees WHERE id = ? LIMIT 1",
        [id]
    );
    return rows[0] || null;
};

export const findHistoryByEmployee = async (employeeId) => {
    const [rows] = await db.execute(
        `SELECT a.id,
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
                a.status,
                CASE WHEN sw.shift_id IS NOT NULL THEN 1 ELSE 0 END AS has_schedule,
                CASE WHEN sw.shift_id IS NOT NULL THEN ws.shift_name ELSE NULL END AS shift_name,
                CASE WHEN sw.shift_id IS NOT NULL THEN ws.shift_code ELSE NULL END AS shift_code,
                CASE WHEN sw.shift_id IS NOT NULL THEN TIME_FORMAT(ws.morning_start, '%H:%i') ELSE NULL END AS scheduled_start,
                CASE WHEN sw.shift_id IS NOT NULL THEN TIME_FORMAT(ws.afternoon_end, '%H:%i') ELSE NULL END AS scheduled_end,
                CASE
                    WHEN sw.shift_id IS NOT NULL
                     AND a.check_in IS NOT NULL
                     AND LOWER(COALESCE(a.status, '')) NOT IN ('absent', 'vắng mặt')
                    THEN GREATEST(TIMESTAMPDIFF(MINUTE, TIMESTAMP(a.work_date, ws.morning_start), a.check_in), 0)
                    ELSE NULL
                END AS late_minutes,
                CASE
                    WHEN sw.shift_id IS NOT NULL
                     AND a.check_out IS NOT NULL
                     AND LOWER(COALESCE(a.status, '')) NOT IN ('absent', 'vắng mặt')
                    THEN GREATEST(TIMESTAMPDIFF(MINUTE, a.check_out, TIMESTAMP(a.work_date, ws.afternoon_end)), 0)
                    ELSE NULL
                END AS early_leave_minutes
           FROM attendance a
           INNER JOIN employees e ON e.id = a.employee_id
           LEFT JOIN employee_shift_assignments sa
             ON sa.employee_id = a.employee_id
            AND sa.status = 'active'
            AND a.work_date BETWEEN sa.start_date AND sa.end_date
           LEFT JOIN work_shifts ws
             ON ws.id = sa.shift_id
            AND ws.status = 1
           LEFT JOIN shift_workdays sw
             ON sw.shift_id = ws.id
            AND sw.weekday = WEEKDAY(a.work_date) + 1
          WHERE a.employee_id = ?
          ORDER BY a.work_date DESC, a.id DESC`,
        [employeeId]
    );

    return rows.map((row) => {
        const rawStatus = String(row.status || "");
        const status = STATUS_VALUES[rawStatus.trim().toLocaleLowerCase()] || rawStatus;
        return {
            ...row,
            status,
            status_label: STATUS_LABELS[status] || rawStatus || "Chưa xác định",
            total_hours: Number(row.total_hours || 0),
            has_schedule: Boolean(Number(row.has_schedule)),
            late_minutes: row.late_minutes === null ? null : Number(row.late_minutes),
            early_leave_minutes: row.early_leave_minutes === null ? null : Number(row.early_leave_minutes)
        };
    });
};

export const exportAllHistory = async (fromDate = null, toDate = null) => {
    const conditions = [];
    const params = [];
    if (fromDate && toDate) {
        conditions.push("a.work_date BETWEEN ? AND ?");
        params.push(fromDate, toDate);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await db.execute(`
        SELECT e.employee_code,
               e.full_name,
               DATE_FORMAT(a.work_date, '%Y-%m-%d') AS work_date,
               TIME_FORMAT(a.check_in, '%H:%i') AS check_in,
               TIME_FORMAT(a.check_out, '%H:%i') AS check_out,
               LOWER(COALESCE(a.status, '')) AS status
          FROM attendance a
          INNER JOIN employees e ON e.id = a.employee_id
         ${whereClause}
         ORDER BY e.employee_code DESC, a.work_date DESC, a.id DESC
    `, params);
    return [rows];
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
        "SELECT id FROM employees WHERE id = ? AND is_active = 1 LIMIT 1",
        [id]
    );
    return rows[0] || null;
};

export const getEmployees = async () => {
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         WHERE is_active = 1
         ORDER BY full_name ASC
    `);
    return rows;
};

export const getScheduledAttendanceStatus = async (employeeId, workDate, checkIn) => {
    const [rows] = await db.execute(
        `SELECT TIME_FORMAT(ws.morning_start, '%H:%i') AS scheduled_start
           FROM employee_shift_assignments sa
           INNER JOIN work_shifts ws
             ON ws.id = sa.shift_id
            AND ws.status = 1
           INNER JOIN shift_workdays sw
             ON sw.shift_id = ws.id
            AND sw.weekday = WEEKDAY(?) + 1
          WHERE sa.employee_id = ?
            AND sa.status = 'active'
            AND ? BETWEEN sa.start_date AND sa.end_date
          ORDER BY sa.start_date DESC
          LIMIT 1`,
        [workDate, employeeId, workDate]
    );

    return rows[0] && checkIn > rows[0].scheduled_start ? "late" : "present";
};

export const getReportSummary = async (fromDate, toDate) => {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS total_records,
                COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('present', 'on_time', 'đúng giờ')), 0) AS present,
                COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('late', 'đi muộn')), 0) AS late,
                COALESCE(SUM(LOWER(COALESCE(status, '')) IN ('absent', 'vắng mặt')), 0) AS absent,
                COALESCE(ROUND(SUM(
                    CASE
                        WHEN check_in IS NOT NULL AND check_out IS NOT NULL
                        THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, check_in, check_out)) / 60
                        ELSE 0
                    END
                ), 2), 0) AS total_hours
           FROM attendance
          WHERE work_date BETWEEN ? AND ?`,
        [fromDate, toDate]
    );

    return {
        total_records: Number(rows[0].total_records),
        present: Number(rows[0].present),
        late: Number(rows[0].late),
        absent: Number(rows[0].absent),
        total_hours: Number(rows[0].total_hours)
    };
};

export const getEmployeeReport = async (fromDate, toDate) => {
    const [rows] = await db.execute(
        `SELECT e.id,
                e.employee_code,
                e.full_name,
                e.department,
                COUNT(a.id) AS total_records,
                COALESCE(SUM(LOWER(COALESCE(a.status, '')) IN ('present', 'on_time', 'đúng giờ')), 0) AS present,
                COALESCE(SUM(LOWER(COALESCE(a.status, '')) IN ('late', 'đi muộn')), 0) AS late,
                COALESCE(SUM(LOWER(COALESCE(a.status, '')) IN ('absent', 'vắng mặt')), 0) AS absent,
                COALESCE(ROUND(SUM(
                    CASE
                        WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL
                        THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, a.check_in, a.check_out)) / 60
                        ELSE 0
                    END
                ), 2), 0) AS total_hours
           FROM employees e
           LEFT JOIN attendance a
             ON a.employee_id = e.id
            AND a.work_date BETWEEN ? AND ?
          GROUP BY e.id, e.employee_code, e.full_name, e.department
         HAVING COUNT(a.id) > 0
          ORDER BY absent DESC, late DESC, e.full_name ASC`,
        [fromDate, toDate]
    );

    return rows.map((row) => {
        const totalRecords = Number(row.total_records);
        const present = Number(row.present);
        const late = Number(row.late);

        return {
            ...row,
            total_records: totalRecords,
            present,
            late,
            absent: Number(row.absent),
            total_hours: Number(row.total_hours),
            attendance_rate: totalRecords > 0
                ? Math.round(((present + late) / totalRecords) * 100)
                : 0
        };
    });
};

const toDateTime = (workDate, time) => time ? `${workDate} ${time}:00` : null;

export const create = async (data) => {
    const [result] = await db.execute(
        `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, record_source)
         VALUES (?, ?, ?, ?, ?, 'manual')`,
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
            SET work_date = ?,
                check_in = ?,
                check_out = ?,
                status = ?,
                record_source = 'manual'
          WHERE id = ?`,
        [
            data.work_date,
            toDateTime(data.work_date, data.check_in),
            toDateTime(data.work_date, data.check_out),
            data.status,
            id
        ]
    );
};

export const syncDeviceRecords = async (deviceId, records) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const employeeCodes = [...new Set(records.map((record) => record.employee_code))];
        const placeholders = employeeCodes.map(() => "?").join(", ");
        const [employeeRows] = await connection.execute(
            `SELECT id, employee_code
               FROM employees
              WHERE employee_code IN (${placeholders})
                AND is_active = 1`,
            employeeCodes
        );
        const employeeIds = new Map(
            employeeRows.map((employee) => [String(employee.employee_code).toUpperCase(), employee.id])
        );
        const unknownEmployeeCodes = employeeCodes.filter(
            (code) => !employeeIds.has(code.toUpperCase())
        );

        if (unknownEmployeeCodes.length > 0) {
            const error = new Error("Một hoặc nhiều mã nhân viên không tồn tại.");
            error.code = "UNKNOWN_EMPLOYEES";
            error.employeeCodes = unknownEmployeeCodes;
            throw error;
        }

        const mappedRecords = records
            .map((record) => ({
                ...record,
                employee_id: employeeIds.get(record.employee_code.toUpperCase())
            }))
            .sort((left, right) => left.employee_id - right.employee_id
                || left.work_date.localeCompare(right.work_date));
        const result = {
            received: records.length,
            inserted: 0,
            updated: 0,
            unchanged: 0,
            preserved_manual: 0
        };
        const recordPlaceholders = mappedRecords.map(() => "(?, ?)").join(", ");
        const recordParams = mappedRecords.flatMap((record) => [
            record.employee_id,
            record.work_date
        ]);
        const [existingRows] = await connection.execute(
            `SELECT id,
                    employee_id,
                    DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
                    TIME_FORMAT(check_in, '%H:%i') AS check_in,
                    TIME_FORMAT(check_out, '%H:%i') AS check_out,
                    status,
                    record_source
               FROM attendance
              WHERE (employee_id, work_date) IN (${recordPlaceholders})
              ORDER BY employee_id, work_date
              FOR UPDATE`,
            recordParams
        );
        const existingByKey = new Map(
            existingRows.map((row) => [`${row.employee_id}:${row.work_date}`, row])
        );
        const pendingInserts = [];
        const pendingUpdates = [];

        for (const record of mappedRecords) {
            const existing = existingByKey.get(`${record.employee_id}:${record.work_date}`);
            const checkIn = record.check_in
                ? `${record.work_date} ${record.check_in}:00`
                : null;
            const checkOut = record.check_out
                ? `${record.work_date} ${record.check_out}:00`
                : null;

            if (!existing) {
                pendingInserts.push({
                    employee_id: record.employee_id,
                    work_date: record.work_date,
                    check_in: checkIn,
                    check_out: checkOut,
                    status: record.status
                });
                result.inserted += 1;
                continue;
            }

            if (existing.record_source !== "device") {
                result.preserved_manual += 1;
                continue;
            }

            const unchanged = existing.check_in === (record.check_in || null)
                && existing.check_out === (record.check_out || null)
                && String(existing.status || "").toLowerCase() === record.status;

            if (unchanged) {
                result.unchanged += 1;
                continue;
            }

            pendingUpdates.push({
                id: existing.id,
                check_in: checkIn,
                check_out: checkOut,
                status: record.status
            });
            result.updated += 1;
        }

        if (pendingInserts.length > 0) {
            const insertPlaceholders = pendingInserts
                .map(() => "(?, ?, ?, ?, ?, 'device')")
                .join(", ");
            const insertParams = pendingInserts.flatMap((record) => [
                record.employee_id,
                record.work_date,
                record.check_in,
                record.check_out,
                record.status
            ]);
            await connection.execute(
                `INSERT INTO attendance
                    (employee_id, work_date, check_in, check_out, status, record_source)
                 VALUES ${insertPlaceholders}`,
                insertParams
            );
        }

        if (pendingUpdates.length > 0) {
            const updateCases = (column) =>
                `${column} = CASE id ${pendingUpdates.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${column} END`;
            const updateParams = ["check_in", "check_out", "status"].flatMap((field) =>
                pendingUpdates.flatMap((record) => [record.id, record[field]])
            );
            updateParams.push(...pendingUpdates.map((record) => record.id));
            await connection.execute(
                `UPDATE attendance
                    SET ${updateCases("check_in")},
                        ${updateCases("check_out")},
                        ${updateCases("status")}
                  WHERE id IN (${pendingUpdates.map(() => "?").join(", ")})`,
                updateParams
            );
        }

        await connection.execute(
            `UPDATE attendance_devices
                SET last_seen_at = NOW(6),
                    last_sync_at = NOW(6),
                    last_sync_count = ?
              WHERE id = ? AND is_active = 1`,
            [records.length, deviceId]
        );

        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const syncDeviceEvents = async (deviceId, events) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const employeeCodes = [...new Set(events.map((event) => event.employee_code))];
        const employeePlaceholders = employeeCodes.map(() => "?").join(", ");
        const [employeeRows] = await connection.execute(
            `SELECT id, employee_code
               FROM employees
              WHERE employee_code IN (${employeePlaceholders})
                AND is_active = 1`,
            employeeCodes
        );
        const employeeIds = new Map(
            employeeRows.map((employee) => [String(employee.employee_code).toUpperCase(), employee.id])
        );
        const unknownEmployeeCodes = employeeCodes.filter(
            (code) => !employeeIds.has(code.toUpperCase())
        );

        if (unknownEmployeeCodes.length > 0) {
            const error = new Error("Một hoặc nhiều mã nhân viên không tồn tại.");
            error.code = "UNKNOWN_EMPLOYEES";
            error.employeeCodes = unknownEmployeeCodes;
            throw error;
        }

        const mappedEvents = events
            .map((event) => {
                const employeeId = employeeIds.get(event.employee_code.toUpperCase());
                const fingerprintSource = event.event_id
                    ? `event:${event.event_id}`
                    : `punch:${employeeId}:${event.occurred_at}:${event.direction}`;

                return {
                    ...event,
                    employee_id: employeeId,
                    work_date: event.occurred_at.slice(0, 10),
                    event_fingerprint: createHash("sha256")
                        .update(`${deviceId}:${fingerprintSource}`)
                        .digest("hex")
                };
            })
            .sort((left, right) => left.employee_id - right.employee_id
                || left.work_date.localeCompare(right.work_date)
                || left.occurred_at.localeCompare(right.occurred_at));
        const eventPlaceholders = mappedEvents.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        const eventParams = mappedEvents.flatMap((event) => [
            deviceId,
            event.employee_id,
            event.work_date,
            event.occurred_at,
            event.direction,
            event.event_fingerprint
        ]);
        const [insertResult] = await connection.execute(
            `INSERT IGNORE INTO attendance_device_events
                (device_id, employee_id, work_date, punched_at, direction, event_fingerprint)
             VALUES ${eventPlaceholders}`,
            eventParams
        );
        const affectedDays = [...new Map(mappedEvents.map((event) => [
            `${event.employee_id}:${event.work_date}`,
            { employee_id: event.employee_id, work_date: event.work_date }
        ])).values()];
        const dayPlaceholders = affectedDays.map(() => "(?, ?)").join(", ");
        const dayParams = affectedDays.flatMap((day) => [day.employee_id, day.work_date]);
        const [dailyRows] = await connection.execute(
            `SELECT daily.employee_id,
                    DATE_FORMAT(daily.work_date, '%Y-%m-%d') AS work_date,
                    DATE_FORMAT(daily.check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
                    DATE_FORMAT(daily.check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
                    CASE
                        WHEN daily.check_in > (
                            SELECT TIMESTAMP(daily.work_date, ws.morning_start)
                              FROM employee_shift_assignments sa
                              INNER JOIN work_shifts ws
                                ON ws.id = sa.shift_id
                               AND ws.status = 1
                              INNER JOIN shift_workdays sw
                                ON sw.shift_id = ws.id
                               AND sw.weekday = WEEKDAY(daily.work_date) + 1
                             WHERE sa.employee_id = daily.employee_id
                               AND sa.status = 'active'
                               AND daily.work_date BETWEEN sa.start_date AND sa.end_date
                             ORDER BY sa.start_date DESC
                             LIMIT 1
                        ) THEN 'late'
                        ELSE 'present'
                    END AS status
               FROM (
                    SELECT employee_id,
                           work_date,
                           MIN(CASE WHEN direction = 'in' THEN punched_at END) AS check_in,
                           MAX(CASE WHEN direction = 'out' THEN punched_at END) AS check_out
                      FROM attendance_device_events
                     WHERE (employee_id, work_date) IN (${dayPlaceholders})
                     GROUP BY employee_id, work_date
               ) daily
              ORDER BY daily.employee_id, daily.work_date`,
            dayParams
        );
        const [existingRows] = await connection.execute(
            `SELECT id,
                    employee_id,
                    DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date,
                    DATE_FORMAT(check_in, '%Y-%m-%d %H:%i:%s') AS check_in,
                    DATE_FORMAT(check_out, '%Y-%m-%d %H:%i:%s') AS check_out,
                    status,
                    record_source
               FROM attendance
              WHERE (employee_id, work_date) IN (${dayPlaceholders})
              ORDER BY employee_id, work_date
              FOR UPDATE`,
            dayParams
        );
        const existingByKey = new Map(
            existingRows.map((row) => [`${row.employee_id}:${row.work_date}`, row])
        );
        const pendingInserts = [];
        const pendingUpdates = [];
        const result = {
            received_events: events.length,
            inserted_events: Number(insertResult.affectedRows),
            duplicate_events: events.length - Number(insertResult.affectedRows),
            created_records: 0,
            updated_records: 0,
            unchanged_records: 0,
            preserved_manual_records: 0
        };

        for (const dailyRecord of dailyRows) {
            const existing = existingByKey.get(`${dailyRecord.employee_id}:${dailyRecord.work_date}`);
            if (!existing) {
                pendingInserts.push(dailyRecord);
                result.created_records += 1;
                continue;
            }

            if (existing.record_source !== "device") {
                result.preserved_manual_records += 1;
                continue;
            }

            if (existing.check_in === dailyRecord.check_in
                && existing.check_out === dailyRecord.check_out
                && String(existing.status || "").toLowerCase() === dailyRecord.status) {
                result.unchanged_records += 1;
                continue;
            }

            pendingUpdates.push({ ...dailyRecord, id: existing.id });
            result.updated_records += 1;
        }

        if (pendingInserts.length > 0) {
            const insertPlaceholders = pendingInserts.map(() => "(?, ?, ?, ?, ?, 'device')").join(", ");
            const insertParams = pendingInserts.flatMap((record) => [
                record.employee_id,
                record.work_date,
                record.check_in,
                record.check_out,
                record.status
            ]);
            await connection.execute(
                `INSERT INTO attendance
                    (employee_id, work_date, check_in, check_out, status, record_source)
                 VALUES ${insertPlaceholders}`,
                insertParams
            );
        }

        if (pendingUpdates.length > 0) {
            const updateCases = (column) =>
                `${column} = CASE id ${pendingUpdates.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${column} END`;
            const updateParams = ["check_in", "check_out", "status"].flatMap((field) =>
                pendingUpdates.flatMap((record) => [record.id, record[field]])
            );
            updateParams.push(...pendingUpdates.map((record) => record.id));
            await connection.execute(
                `UPDATE attendance
                    SET ${updateCases("check_in")},
                        ${updateCases("check_out")},
                        ${updateCases("status")}
                  WHERE id IN (${pendingUpdates.map(() => "?").join(", ")})`,
                updateParams
            );
        }

        await connection.execute(
            `UPDATE attendance_devices
                SET last_seen_at = NOW(6),
                    last_sync_at = NOW(6),
                    last_sync_count = ?
              WHERE id = ? AND is_active = 1`,
            [events.length, deviceId]
        );

        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};