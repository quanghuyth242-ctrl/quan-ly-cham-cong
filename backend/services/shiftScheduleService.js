import { db } from "../config/db.js";

/**
 * Tiện ích tích hợp lịch phân ca vào chức năng chấm công.
 * Không thay đổi bảng/controller chấm công hiện tại, chỉ cung cấp
 * các hàm truy vấn để nơi khác có thể tái sử dụng.
 */

const toMinutes = (time) => {
    if (!time) return null;

    const [hour, minute] = String(time).split(":").map(Number);
    return hour * 60 + minute;
};

// Chuyển ngày dạng YYYY-MM-DD sang thứ theo chuẩn ISO (1 = Thứ 2, 7 = Chủ nhật)
const getIsoWeekday = (dateString) => {
    const date = new Date(`${dateString}T00:00:00Z`);
    const day = date.getUTCDay();
    return day === 0 ? 7 : day;
};

const toDateObject = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;

    const normalized = String(value).replace("T", " ").slice(0, 19);
    const date = new Date(normalized.replace(" ", "T"));

    return Number.isNaN(date.getTime()) ? null : date;
};

const getTimeInMinutes = (dateObject) => {
    if (!dateObject) return null;
    return dateObject.getHours() * 60 + dateObject.getMinutes();
};

const overlapMinutes = (rangeStart, rangeEnd, partStart, partEnd) => {
    const start = Math.max(rangeStart, partStart);
    const end = Math.min(rangeEnd, partEnd);
    return Math.max(0, end - start);
};

/**
 * Lấy ca làm việc đang có hiệu lực của một nhân viên trong một ngày.
 */
export const getShiftForDate = async (employeeId, workDate) => {
    const [rows] = await db.execute(
        `SELECT a.id AS assignment_id,
                DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
                s.id AS shift_id,
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
           INNER JOIN work_shifts s ON s.id = a.shift_id AND s.status = 1
          WHERE a.employee_id = ?
            AND a.status = 'active'
            AND ? BETWEEN a.start_date AND a.end_date
          ORDER BY a.start_date DESC, a.id DESC
          LIMIT 1`,
        [employeeId, workDate]
    );

    if (rows.length === 0) return null;

    const row = rows[0];

    return {
        ...row,
        workdays: row.workdays
            ? String(row.workdays).split(",").map(Number)
            : []
    };
};

export const getShiftSchedulesForEmployeesOnDate = async (employeeIds, workDate) => {
    const uniqueEmployeeIds = [...new Set(employeeIds)];
    if (uniqueEmployeeIds.length === 0) return new Map();

    const placeholders = uniqueEmployeeIds.map(() => "?").join(", ");
    const [rows] = await db.execute(
        `SELECT a.employee_id,
                a.id AS assignment_id,
                a.start_date,
                a.end_date,
                s.id AS shift_id,
                s.shift_code,
                s.shift_name,
                TIME_FORMAT(s.morning_start, '%H:%i') AS morning_start,
                TIME_FORMAT(s.morning_end, '%H:%i') AS morning_end,
                TIME_FORMAT(s.afternoon_start, '%H:%i') AS afternoon_start,
                TIME_FORMAT(s.afternoon_end, '%H:%i') AS afternoon_end,
                sw.weekday
           FROM employee_shift_assignments a
           INNER JOIN work_shifts s ON s.id = a.shift_id AND s.status = 1
           LEFT JOIN shift_workdays sw ON sw.shift_id = s.id
          WHERE a.employee_id IN (${placeholders})
            AND a.status = 'active'
            AND ? BETWEEN a.start_date AND a.end_date
          ORDER BY a.employee_id ASC, a.start_date DESC, a.id DESC, sw.weekday ASC`,
        [...uniqueEmployeeIds, workDate]
    );

    const shiftsByEmployee = new Map();

    for (const row of rows) {
        let shift = shiftsByEmployee.get(row.employee_id);

        if (!shift) {
            shift = {
                assignment_id: row.assignment_id,
                start_date: row.start_date,
                end_date: row.end_date,
                shift_id: row.shift_id,
                shift_code: row.shift_code,
                shift_name: row.shift_name,
                morning_start: row.morning_start,
                morning_end: row.morning_end,
                afternoon_start: row.afternoon_start,
                afternoon_end: row.afternoon_end,
                workdays: []
            };
            shiftsByEmployee.set(row.employee_id, shift);
        }

        if (shift.assignment_id === row.assignment_id && row.weekday !== null) {
            shift.workdays.push(Number(row.weekday));
        }
    }

    return shiftsByEmployee;
};

export const getShiftSchedulesForEmployeeRange = async (employeeId, fromDate, toDate) => {
    const [rows] = await db.execute(
        `SELECT a.id AS assignment_id,
                DATE_FORMAT(a.start_date, '%Y-%m-%d') AS start_date,
                DATE_FORMAT(a.end_date, '%Y-%m-%d') AS end_date,
                s.id AS shift_id,
                s.shift_code,
                s.shift_name,
                TIME_FORMAT(s.morning_start, '%H:%i') AS morning_start,
                TIME_FORMAT(s.morning_end, '%H:%i') AS morning_end,
                TIME_FORMAT(s.afternoon_start, '%H:%i') AS afternoon_start,
                TIME_FORMAT(s.afternoon_end, '%H:%i') AS afternoon_end,
                sw.weekday
           FROM employee_shift_assignments a
           INNER JOIN work_shifts s ON s.id = a.shift_id AND s.status = 1
           LEFT JOIN shift_workdays sw ON sw.shift_id = s.id
          WHERE a.employee_id = ?
            AND a.status = 'active'
            AND a.start_date <= ?
            AND a.end_date >= ?
          ORDER BY a.start_date DESC, a.id DESC, sw.weekday ASC`,
        [employeeId, toDate, fromDate]
    );
    const schedules = new Map();
    for (const row of rows) {
        let schedule = schedules.get(row.assignment_id);
        if (!schedule) {
            schedule = {
                assignment_id: row.assignment_id,
                start_date: row.start_date,
                end_date: row.end_date,
                shift_id: row.shift_id,
                shift_code: row.shift_code,
                shift_name: row.shift_name,
                morning_start: row.morning_start,
                morning_end: row.morning_end,
                afternoon_start: row.afternoon_start,
                afternoon_end: row.afternoon_end,
                workdays: []
            };
            schedules.set(row.assignment_id, schedule);
        }
        if (row.weekday !== null) schedule.workdays.push(Number(row.weekday));
    }
    return [...schedules.values()];
};

export const buildAttendanceSchedule = (shift, workDate) => {
    const weekday = getIsoWeekday(workDate);

    if (!shift) {
        return {
            assigned: false,
            isWorkingDay: false,
            weekday,
            shift: null
        };
    }

    return {
        assigned: true,
        isWorkingDay: shift.workdays.includes(weekday),
        weekday,
        shift
    };
};

/**
 * Kiểm tra một ngày có phải ngày làm việc theo lịch phân ca hay không.
 */
export const isWorkingDay = async (employeeId, workDate) => {
    const shift = await getShiftForDate(employeeId, workDate);
    return buildAttendanceSchedule(shift, workDate);
};

/**
 * Đánh giá một bản ghi chấm công dựa trên ca được phân.
 * Trả về giờ vào/ra dự kiến, số phút đi muộn, về sớm và thời gian làm việc thực tế.
 */
export const evaluateAttendance = async ({
    employeeId,
    workDate,
    checkIn = null,
    checkOut = null,
    schedule: suppliedSchedule = null
}) => {
    const schedule = suppliedSchedule || await isWorkingDay(employeeId, workDate);
    const shift = schedule.shift;

    if (!shift) {
        return {
            ...schedule,
            expectedStart: null,
            expectedEnd: null,
            isLate: false,
            lateMinutes: 0,
            isEarlyLeave: false,
            earlyLeaveMinutes: 0,
            workMinutes: 0,
            suggestedStatus: "no_shift"
        };
    }

    const expectedStart = shift.morning_start;
    const expectedEnd = shift.afternoon_end;

    if (!schedule.isWorkingDay) {
        return {
            ...schedule,
            expectedStart,
            expectedEnd,
            isLate: false,
            lateMinutes: 0,
            isEarlyLeave: false,
            earlyLeaveMinutes: 0,
            workMinutes: 0,
            suggestedStatus: "day_off"
        };
    }

    const checkInDate = toDateObject(checkIn);
    const checkOutDate = toDateObject(checkOut);

    if (!checkInDate) {
        return {
            ...schedule,
            expectedStart,
            expectedEnd,
            isLate: false,
            lateMinutes: 0,
            isEarlyLeave: false,
            earlyLeaveMinutes: 0,
            workMinutes: 0,
            suggestedStatus: "absent"
        };
    }

    const checkInMinutes = getTimeInMinutes(checkInDate);
    const checkOutMinutes = checkOutDate ? getTimeInMinutes(checkOutDate) : null;

    const startMinutes = toMinutes(expectedStart);
    const morningEndMinutes = toMinutes(shift.morning_end);
    const afternoonStartMinutes = toMinutes(shift.afternoon_start);
    const endMinutes = toMinutes(expectedEnd);

    const lateMinutes = Math.max(0, checkInMinutes - startMinutes);
    const earlyLeaveMinutes = checkOutMinutes === null
        ? 0
        : Math.max(0, endMinutes - checkOutMinutes);

    let workMinutes = 0;

    if (checkOutMinutes !== null && checkOutMinutes > checkInMinutes) {
        workMinutes += overlapMinutes(
            checkInMinutes,
            checkOutMinutes,
            startMinutes,
            morningEndMinutes
        );
        workMinutes += overlapMinutes(
            checkInMinutes,
            checkOutMinutes,
            afternoonStartMinutes,
            endMinutes
        );
    }

    let suggestedStatus = "present";

    if (lateMinutes > 0 && earlyLeaveMinutes > 0) {
        suggestedStatus = "late_and_early_leave";
    } else if (lateMinutes > 0) {
        suggestedStatus = "late";
    } else if (earlyLeaveMinutes > 0) {
        suggestedStatus = "early_leave";
    }

    return {
        ...schedule,
        expectedStart,
        expectedEnd,
        isLate: lateMinutes > 0,
        lateMinutes,
        isEarlyLeave: earlyLeaveMinutes > 0,
        earlyLeaveMinutes,
        workMinutes,
        suggestedStatus
    };
};
