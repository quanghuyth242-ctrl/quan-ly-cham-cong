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
            SET employee_id = ?,
                work_date = ?,
                check_in = ?,
                check_out = ?,
                status = ?,
                record_source = 'manual'
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

export const syncDeviceRecords = async (deviceId, records) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const employeeCodes = [...new Set(records.map((record) => record.employee_code))];
        const placeholders = employeeCodes.map(() => "?").join(", ");
        const [employeeRows] = await connection.execute(
            `SELECT id, employee_code
               FROM employees
              WHERE employee_code IN (${placeholders})`,
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

        for (const record of mappedRecords) {
            const [existingRows] = await connection.execute(
                `SELECT id,
                        TIME_FORMAT(check_in, '%H:%i') AS check_in,
                        TIME_FORMAT(check_out, '%H:%i') AS check_out,
                        status,
                        record_source
                   FROM attendance
                  WHERE employee_id = ? AND work_date = ?
                  LIMIT 1
                  FOR UPDATE`,
                [record.employee_id, record.work_date]
            );
            const existing = existingRows[0];
            const checkIn = record.check_in
                ? `${record.work_date} ${record.check_in}:00`
                : null;
            const checkOut = record.check_out
                ? `${record.work_date} ${record.check_out}:00`
                : null;

            if (!existing) {
                await connection.execute(
                    `INSERT INTO attendance
                        (employee_id, work_date, check_in, check_out, status, record_source)
                     VALUES (?, ?, ?, ?, ?, 'device')`,
                    [
                        record.employee_id,
                        record.work_date,
                        checkIn,
                        checkOut,
                        record.status
                    ]
                );
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

            await connection.execute(
                `UPDATE attendance
                    SET check_in = ?, check_out = ?, status = ?
                  WHERE id = ?`,
                [checkIn, checkOut, record.status, existing.id]
            );
            result.updated += 1;
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