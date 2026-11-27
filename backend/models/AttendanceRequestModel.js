import { db } from "../config/db.js";

export const getEmployees = async () => {
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         WHERE is_active = 1
         ORDER BY full_name ASC
    `);
    return rows;
};

export const findAll = async () => {
    const [rows] = await db.execute(`
        SELECT r.id, r.request_code, r.request_type, r.category,
               DATE_FORMAT(r.from_date, '%Y-%m-%d') AS from_date,
               DATE_FORMAT(r.to_date, '%Y-%m-%d') AS to_date,
               r.reason, r.destination,
               TIME_FORMAT(r.overtime_start_time, '%H:%i') AS overtime_start_time,
               TIME_FORMAT(r.overtime_end_time, '%H:%i') AS overtime_end_time,
               r.status, r.created_at, r.reviewed_by, DATE_FORMAT(r.reviewed_at, '%Y-%m-%d %H:%i') AS reviewed_date, r.review_note,
               r.employee_response, r.employee_responded_at, r.employee_response_note,
               e.id AS employee_id, e.employee_code, e.full_name AS employee_name,
               e.department, DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS created_date, u.username AS reviewer_name
          FROM attendance_requests r
          JOIN employees e ON e.id = r.employee_id
          LEFT JOIN users u ON u.id = r.reviewed_by
         ORDER BY FIELD(r.status, 'pending', 'awaiting_employee', 'approved', 'rejected'), r.created_at DESC
    `);
    return rows;
};

export const findById = async (id) => {
    const [rows] = await db.execute(
        `SELECT id, request_code, request_type, category, employee_id, reason, destination,
                DATE_FORMAT(from_date, '%Y-%m-%d') AS from_date,
                DATE_FORMAT(to_date, '%Y-%m-%d') AS to_date,
                TIME_FORMAT(overtime_start_time, '%H:%i') AS overtime_start_time,
                TIME_FORMAT(overtime_end_time, '%H:%i') AS overtime_end_time, status, reviewed_by, review_note,
                DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i') AS reviewed_date,
                employee_response, employee_response_note
           FROM attendance_requests WHERE id = ? LIMIT 1`,
        [id]
    );
    if (!rows[0]) return null;
    return rows[0];
};

export const findEmployeeForUser = async (user) => {
    if (!user) return null;
    const accountId = String(user.employee_id ?? "").trim();
    const username = String(user.username ?? "").trim();
    const [rows] = await db.execute(`
        SELECT id, employee_code, full_name, department
          FROM employees
         WHERE is_active = 1 AND (
            (? <> '' AND (CAST(id AS CHAR) = ? OR employee_code = ?))
            OR (? <> '' AND (employee_code = ? OR email = ?))
         )
         LIMIT 1
    `, [accountId, accountId, accountId, username, username, username]);
    return rows[0] || null;
};

export const findByEmployee = async (employeeId, requestType = "overtime") => {
    const [rows] = await db.execute(`
        SELECT r.id, r.request_code, r.request_type,
               DATE_FORMAT(r.from_date, '%Y-%m-%d') AS from_date,
               DATE_FORMAT(r.to_date, '%Y-%m-%d') AS to_date,
               r.reason, r.destination,
               TIME_FORMAT(r.overtime_start_time, '%H:%i') AS overtime_start_time,
               TIME_FORMAT(r.overtime_end_time, '%H:%i') AS overtime_end_time,
               r.status, r.employee_response, r.employee_responded_at, r.employee_response_note, r.review_note,
               DATE_FORMAT(r.reviewed_at, '%Y-%m-%d %H:%i') AS reviewed_date, u.username AS reviewer_name,
               DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS created_date
          FROM attendance_requests r
          LEFT JOIN users u ON u.id = r.reviewed_by
         WHERE r.employee_id = ? AND r.request_type = ?
         ORDER BY r.created_at DESC
         LIMIT 50
    `, [employeeId, requestType]);
    return rows;
};

export const findEmployeeLeaveRequests = async (employeeId) => {
    const [rows] = await db.execute(`
        SELECT r.id, r.request_code, r.request_type, r.category,
               DATE_FORMAT(r.from_date, '%Y-%m-%d') AS from_date,
               DATE_FORMAT(r.to_date, '%Y-%m-%d') AS to_date,
               r.reason, r.status, r.employee_response, r.employee_response_note, r.review_note,
               DATE_FORMAT(r.reviewed_at, '%Y-%m-%d %H:%i') AS reviewed_date, u.username AS reviewer_name,
               DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') AS created_date
          FROM attendance_requests r
          LEFT JOIN users u ON u.id = r.reviewed_by
         WHERE r.employee_id = ? AND r.request_type IN ('leave', 'resignation')
         ORDER BY r.created_at DESC
         LIMIT 50
    `, [employeeId]);
    return rows;
};

export const createEmployeeLeave = async (request) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [overlaps] = await connection.execute(`
            SELECT id FROM attendance_requests
             WHERE employee_id = ? AND request_type IN ('leave', 'business_trip', 'overtime', 'resignation')
               AND status IN ('pending', 'awaiting_employee', 'approved')
               AND from_date <= ? AND to_date >= ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.toDate, request.fromDate]);
        const [statusOverlaps] = await connection.execute(`
            SELECT id FROM attendance_day_statuses
             WHERE employee_id = ? AND status IN ('leave', 'business_trip', 'overtime')
               AND work_date BETWEEN ? AND ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.fromDate, request.toDate]);
        if (overlaps.length || statusOverlaps.length) {
            await connection.rollback();
            return { success: false, reason: "overlap" };
        }

        const [result] = await connection.execute(`
            INSERT INTO attendance_requests
                (employee_id, request_type, category, from_date, to_date, reason, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [request.employeeId, request.type, request.category, request.fromDate, request.toDate,
            request.reason, request.createdBy || null]);
        const prefix = request.type === "resignation" ? "TV" : "NP";
        const requestCode = `${prefix}-${new Date().getFullYear()}-${String(result.insertId).padStart(6, "0")}`;
        await connection.execute("UPDATE attendance_requests SET request_code = ? WHERE id = ?", [requestCode, result.insertId]);
        await connection.commit();
        return { success: true, id: result.insertId, requestCode };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const create = async (request) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(`
            INSERT INTO attendance_requests
                (employee_id, request_type, category, from_date, to_date, reason, destination, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [request.employeeId, request.type, request.category, request.fromDate, request.toDate,
            request.reason, request.destination || null, request.createdBy || null]);
        const requestCode = `YC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, "0")}`;
        await connection.execute("UPDATE attendance_requests SET request_code = ? WHERE id = ?", [requestCode, result.insertId]);
        await connection.commit();
        return { id: result.insertId, requestCode };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// Giải trình dùng các cột sẵn có nên không cần migrate database.
// subject -> destination, thời gian liên quan -> overtime_start_time/end_time.
export const createExplanation = async (request) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(`
            INSERT INTO attendance_requests
                (employee_id, request_type, category, from_date, to_date, reason,
                 destination, overtime_start_time, overtime_end_time, status, created_by)
            VALUES (?, 'explanation', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [request.employeeId, request.category, request.incidentDate, request.incidentDate,
            request.reason, request.subject, request.startTime || null, request.endTime || null,
            request.createdBy || null]);
        const requestCode = `GT-${new Date().getFullYear()}-${String(result.insertId).padStart(6, "0")}`;
        await connection.execute("UPDATE attendance_requests SET request_code = ? WHERE id = ?", [requestCode, result.insertId]);
        await connection.commit();
        return { success: true, id: result.insertId, requestCode };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const createBusinessTrip = async (request) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [overlaps] = await connection.execute(`
            SELECT id FROM attendance_requests
             WHERE employee_id = ? AND request_type IN ('leave', 'business_trip', 'overtime')
               AND status IN ('pending', 'awaiting_employee', 'approved') AND from_date <= ? AND to_date >= ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.toDate, request.fromDate]);
        if (overlaps.length) {
            await connection.rollback();
            return { success: false, reason: "overlap" };
        }
        const [statusOverlaps] = await connection.execute(`
            SELECT id FROM attendance_day_statuses
             WHERE employee_id = ? AND status IN ('leave', 'business_trip', 'overtime')
               AND work_date BETWEEN ? AND ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.fromDate, request.toDate]);
        if (statusOverlaps.length) {
            await connection.rollback();
            return { success: false, reason: "overlap" };
        }
        if (request.approveImmediately && !request.schedules?.length) {
            await connection.rollback();
            return { success: false, reason: "no_scheduled_days" };
        }

        const requestStatus = request.requireEmployeeConsent
            ? "awaiting_employee"
            : request.approveImmediately ? "approved" : "pending";
        const [result] = await connection.execute(`
            INSERT INTO attendance_requests
                (employee_id, request_type, category, from_date, to_date, reason, destination,
                 status, created_by, reviewed_by, reviewed_at)
            VALUES (?, 'business_trip', 'business_trip', ?, ?, ?, ?, ?, ?, IF(? = 'approved', CURRENT_TIMESTAMP, NULL))
        `, [request.employeeId, request.fromDate, request.toDate, request.reason, request.destination,
            requestStatus, request.createdBy || null,
            request.approveImmediately ? request.reviewerId || null : null,
            requestStatus]);
        const requestCode = `CT-${new Date().getFullYear()}-${String(result.insertId).padStart(6, "0")}`;
        await connection.execute("UPDATE attendance_requests SET request_code = ? WHERE id = ?", [requestCode, result.insertId]);

        if (requestStatus !== "approved") {
            await connection.commit();
            return { success: true, requestCode, appliedDays: 0, status: requestStatus };
        }

        for (const day of request.schedules) {
            const [existingAttendance] = await connection.execute(`
                SELECT id FROM attendance
                 WHERE employee_id = ? AND work_date = ?
                 ORDER BY id DESC LIMIT 1 FOR UPDATE
            `, [request.employeeId, day.date]);
            if (existingAttendance[0]) {
                await connection.execute(`
                    UPDATE attendance
                       SET check_in = CONCAT(?, ' ', ?, ':00'),
                           check_out = CONCAT(?, ' ', ?, ':00'),
                           status = 'present', record_source = 'manual'
                     WHERE id = ?
                `, [day.date, day.start, day.date, day.end, existingAttendance[0].id]);
            } else {
                await connection.execute(`
                    INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, record_source)
                    VALUES (?, ?, CONCAT(?, ' ', ?, ':00'), CONCAT(?, ' ', ?, ':00'), 'present', 'manual')
                `, [request.employeeId, day.date, day.date, day.start, day.date, day.end]);
            }
            await connection.execute(`
                INSERT INTO attendance_day_statuses
                    (employee_id, work_date, status, note, updated_by, request_id)
                VALUES (?, ?, 'business_trip', ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    status = 'business_trip', note = VALUES(note),
                    updated_by = VALUES(updated_by), request_id = VALUES(request_id),
                    updated_at = CURRENT_TIMESTAMP
            `, [request.employeeId, day.date, `Theo don ${requestCode}`,
                String(request.reviewerId || ""), result.insertId]);
        }
        await connection.commit();
        return { success: true, requestCode, appliedDays: request.schedules.length };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const createOvertime = async (request) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [overlaps] = await connection.execute(`
            SELECT id FROM attendance_requests
             WHERE employee_id = ? AND request_type IN ('leave', 'business_trip', 'overtime')
               AND status IN ('pending', 'awaiting_employee', 'approved') AND from_date <= ? AND to_date >= ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.toDate, request.fromDate]);
        if (overlaps.length) {
            await connection.rollback();
            return { success: false, reason: "overlap" };
        }
        const [dayStatusOverlaps] = await connection.execute(`
            SELECT id FROM attendance_day_statuses
             WHERE employee_id = ? AND status IN ('leave', 'business_trip', 'overtime')
               AND work_date BETWEEN ? AND ?
             LIMIT 1 FOR UPDATE
        `, [request.employeeId, request.fromDate, request.toDate]);
        if (dayStatusOverlaps.length) {
            await connection.rollback();
            return { success: false, reason: "overlap" };
        }

        const status = request.requireEmployeeConsent
            ? "awaiting_employee"
            : request.approveImmediately ? "approved" : "pending";
        const [result] = await connection.execute(`
            INSERT INTO attendance_requests
                (employee_id, request_type, category, from_date, to_date, reason,
                 overtime_start_time, overtime_end_time, status, created_by, reviewed_by, reviewed_at)
            VALUES (?, 'overtime', 'overtime', ?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'approved', CURRENT_TIMESTAMP, NULL))
        `, [request.employeeId, request.fromDate, request.toDate, request.reason,
            request.startTime, request.endTime, status, request.createdBy || null,
            request.approveImmediately ? request.reviewerId || null : null, status]);
        const requestCode = `TC-${new Date().getFullYear()}-${String(result.insertId).padStart(6, "0")}`;
        await connection.execute("UPDATE attendance_requests SET request_code = ? WHERE id = ?", [requestCode, result.insertId]);
        let appliedDays = 0;
        if (status === "approved") {
            const current = new Date(`${request.fromDate}T00:00:00Z`);
            const last = new Date(`${request.toDate}T00:00:00Z`);
            while (current <= last) {
                const workDate = current.toISOString().slice(0, 10);
                await connection.execute(`
                    INSERT INTO attendance_day_statuses
                        (employee_id, work_date, status, note, updated_by, request_id)
                    VALUES (?, ?, 'overtime', ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        status = 'overtime', note = VALUES(note),
                        updated_by = VALUES(updated_by), request_id = VALUES(request_id),
                        updated_at = CURRENT_TIMESTAMP
                `, [request.employeeId, workDate, `Theo don ${requestCode}`,
                    String(request.reviewerId || ""), result.insertId]);
                appliedDays += 1;
                current.setUTCDate(current.getUTCDate() + 1);
            }
        }
        await connection.commit();
        return { success: true, requestCode, id: result.insertId, appliedDays, status };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const employeeRespond = async ({ id, employeeId, accepted, responseNote = null, schedules = [] }) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(`
            SELECT id, request_code, employee_id, request_type, from_date, to_date,
                   overtime_start_time, overtime_end_time, status
              FROM attendance_requests WHERE id = ? FOR UPDATE
        `, [id]);
        const request = rows[0];
        if (!request) {
            await connection.rollback();
            return { success: false, reason: "not_found" };
        }
        if (Number(request.employee_id) !== Number(employeeId)) {
            await connection.rollback();
            return { success: false, reason: "forbidden" };
        }
        if (request.status !== "awaiting_employee") {
            await connection.rollback();
            return { success: false, reason: "already_responded" };
        }

        let appliedDays = 0;
        if (accepted) {
            if (request.request_type === "business_trip" && schedules.length === 0) {
                await connection.rollback();
                return { success: false, reason: "no_scheduled_days" };
            }
            const [requestOverlaps] = await connection.execute(`
                SELECT id FROM attendance_requests
                 WHERE employee_id = ? AND id <> ?
                   AND request_type IN ('leave', 'business_trip', 'overtime')
                   AND status IN ('approved', 'awaiting_employee') AND from_date <= ? AND to_date >= ?
                 LIMIT 1 FOR UPDATE
            `, [employeeId, id, request.to_date, request.from_date]);
            const [statusOverlaps] = await connection.execute(`
                SELECT id FROM attendance_day_statuses
                 WHERE employee_id = ? AND status IN ('leave', 'business_trip', 'overtime')
                   AND work_date BETWEEN ? AND ?
                   AND (request_id IS NULL OR request_id <> ?)
                 LIMIT 1 FOR UPDATE
            `, [employeeId, request.from_date, request.to_date, id]);
            if (requestOverlaps.length || statusOverlaps.length) {
                await connection.rollback();
                return { success: false, reason: "overlap" };
            }

            let days = schedules;
            if (request.request_type === "overtime") {
                days = [];
                const current = new Date(`${request.from_date}T00:00:00Z`);
                const last = new Date(`${request.to_date}T00:00:00Z`);
                while (current <= last) {
                    days.push({ date: current.toISOString().slice(0, 10) });
                    current.setUTCDate(current.getUTCDate() + 1);
                }
            }

            for (const day of days) {
                if (request.request_type === "business_trip") {
                    const [attendanceRows] = await connection.execute(`
                        SELECT id FROM attendance
                         WHERE employee_id = ? AND work_date = ?
                         ORDER BY id DESC LIMIT 1 FOR UPDATE
                    `, [employeeId, day.date]);
                    if (attendanceRows[0]) {
                        await connection.execute(`
                            UPDATE attendance
                               SET check_in = CONCAT(?, ' ', ?, ':00'), check_out = CONCAT(?, ' ', ?, ':00'),
                                   status = 'present', record_source = 'manual'
                             WHERE id = ?
                        `, [day.date, day.start, day.date, day.end, attendanceRows[0].id]);
                    } else {
                        await connection.execute(`
                            INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, record_source)
                            VALUES (?, ?, CONCAT(?, ' ', ?, ':00'), CONCAT(?, ' ', ?, ':00'), 'present', 'manual')
                        `, [employeeId, day.date, day.date, day.start, day.date, day.end]);
                    }
                }

                const note = `Theo don ${request.request_code}`;
                await connection.execute(`
                    INSERT INTO attendance_day_statuses
                        (employee_id, work_date, status, note, updated_by, request_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        status = VALUES(status), note = VALUES(note),
                        updated_by = VALUES(updated_by), request_id = VALUES(request_id),
                        updated_at = CURRENT_TIMESTAMP
                `, [employeeId, day.date, request.request_type, note, String(employeeId), id]);
                appliedDays += 1;
            }
        }

        await connection.execute(`
            UPDATE attendance_requests
               SET status = ?, employee_response = ?, employee_responded_at = CURRENT_TIMESTAMP,
                   employee_response_note = ?
             WHERE id = ?
        `, [accepted ? "approved" : "rejected", accepted ? "accepted" : "rejected", responseNote, id]);
        await connection.commit();
        return { success: true, appliedDays };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const review = async ({ id, decision, reviewerId, reviewNote = null, schedules = [] }) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [requests] = await connection.execute(
            "SELECT id, request_code, employee_id, request_type, from_date, to_date, overtime_start_time, overtime_end_time, status FROM attendance_requests WHERE id = ? FOR UPDATE",
            [id]
        );
        const request = requests[0];
        if (!request) {
            await connection.rollback();
            return { success: false, reason: "not_found" };
        }
        if (request.status !== "pending") {
            await connection.rollback();
            return { success: false, reason: "already_reviewed" };
        }

        let autoAttendanceDays = 0;
        if (decision === "approved" && ["business_trip", "leave", "overtime"].includes(request.request_type)) {
            const [overlaps] = await connection.execute(`
                SELECT id FROM attendance_requests
                 WHERE employee_id = ? AND id <> ? AND request_type IN ('business_trip', 'leave', 'overtime')
                   AND status IN ('approved', 'awaiting_employee') AND from_date <= ? AND to_date >= ?
                 LIMIT 1 FOR UPDATE
            `, [request.employee_id, id, request.to_date, request.from_date]);
            if (overlaps.length) {
                await connection.rollback();
                return { success: false, reason: "overlap" };
            }

            const statusDates = request.request_type === "overtime"
                ? [request.from_date, request.to_date]
                : [request.from_date, request.to_date];
            const [statusOverlaps] = await connection.execute(`
                SELECT id FROM attendance_day_statuses
                 WHERE employee_id = ? AND status IN ('leave', 'business_trip', 'overtime')
                   AND work_date BETWEEN ? AND ?
                   AND (request_id IS NULL OR request_id <> ?)
                 LIMIT 1 FOR UPDATE
            `, [request.employee_id, statusDates[0], statusDates[1], id]);
            if (statusOverlaps.length) {
                await connection.rollback();
                return { success: false, reason: "overlap" };
            }

            if (request.request_type === "business_trip" && schedules.length === 0) {
                await connection.rollback();
                return { success: false, reason: "no_scheduled_days" };
            }

            const statusDays = request.request_type === "overtime" ? (() => {
                const days = [];
                const current = new Date(`${request.from_date}T00:00:00Z`);
                const last = new Date(`${request.to_date}T00:00:00Z`);
                while (current <= last) {
                    days.push({ date: current.toISOString().slice(0, 10) });
                    current.setUTCDate(current.getUTCDate() + 1);
                }
                return days;
            })() : schedules;

            for (const day of statusDays) {
                if (request.request_type === "business_trip") {
                    const [existingAttendance] = await connection.execute(`
                        SELECT id FROM attendance
                         WHERE employee_id = ? AND work_date = ?
                         ORDER BY id DESC LIMIT 1 FOR UPDATE
                    `, [request.employee_id, day.date]);
                    if (existingAttendance[0]) {
                        await connection.execute(`
                            UPDATE attendance
                               SET check_in = CONCAT(?, ' ', ?, ':00'),
                                   check_out = CONCAT(?, ' ', ?, ':00'),
                                   status = 'present', record_source = 'manual'
                             WHERE id = ?
                        `, [day.date, day.start, day.date, day.end, existingAttendance[0].id]);
                    } else {
                        await connection.execute(`
                            INSERT INTO attendance
                                (employee_id, work_date, check_in, check_out, status, record_source)
                            VALUES (?, ?, CONCAT(?, ' ', ?, ':00'), CONCAT(?, ' ', ?, ':00'), 'present', 'manual')
                        `, [request.employee_id, day.date, day.date, day.start, day.date, day.end]);
                    }
                    autoAttendanceDays += 1;
                }

                await connection.execute(`
                    INSERT INTO attendance_day_statuses
                        (employee_id, work_date, status, note, updated_by, request_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        status = VALUES(status), note = VALUES(note),
                        updated_by = VALUES(updated_by), request_id = VALUES(request_id),
                        updated_at = CURRENT_TIMESTAMP
                `, [request.employee_id, day.date, request.request_type,
                    `Theo đơn ${request.request_code}`, String(reviewerId || ""), id]);
            }
            if (request.request_type === "overtime") autoAttendanceDays = statusDays.length;
        }

        await connection.execute(`
            UPDATE attendance_requests
               SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
             WHERE id = ?
        `, [decision, reviewerId || null, reviewNote, id]);
        await connection.commit();
        return { success: true, autoAttendanceDays, scheduledDays: schedules.length, appliedDays: autoAttendanceDays };
    } catch (error) {
        await connection.rollback();
        // Hai đơn duyệt cùng lúc có thể va nhau ở UNIQUE(employee_id, work_date).
        if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) {
            return { success: false, reason: "overlap" };
        }
        throw error;
    } finally {
        connection.release();
    }
};
