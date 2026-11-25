import { db } from "../config/db.js";

/**
 * Dữ liệu thông báo mẫu cho module đơn nghỉ & giải trình.
 * Module này hiện chưa có bảng dữ liệu riêng nên dùng dữ liệu mẫu
 * để phần tổng quan vẫn hiển thị đầy đủ thông báo.
 */
const DEMO_LEAVE_NOTIFICATIONS = [
    {
        id: "leave-001",
        type: "leave",
        title: "Đơn giải trình đi muộn",
        message: "Lê Thúy An (Sales B2B) gửi giải trình đi muộn 19 phút.",
        time: "08:52",
        href: "#",
        icon: "event_note",
        priority: "high",
        unread: true
    },
    {
        id: "leave-002",
        type: "leave",
        title: "Đơn xin nghỉ phép đột xuất",
        message: "Trịnh Gia Huy (Kỹ thuật) xin nghỉ nửa buổi sáng vì việc gia đình.",
        time: "07:30",
        href: "#",
        icon: "event_busy",
        priority: "high",
        unread: true
    },
    {
        id: "leave-003",
        type: "leave",
        title: "Đơn nghỉ phép năm",
        message: "Phạm Thanh Thảo (Tài chính Kế toán) đăng ký nghỉ 1 ngày.",
        time: "Hôm qua",
        href: "#",
        icon: "description",
        priority: "normal",
        unread: false
    }
];

/**
 * Dữ liệu thông báo mẫu cho bảng chấm công.
 * Được dùng khi bảng attendance chưa có dữ liệu của ngày hôm nay.
 */
const DEMO_ATTENDANCE_NOTIFICATIONS = [
    {
        id: "attendance-late",
        type: "attendance",
        title: "Đi muộn / về sớm",
        message: "8 nhân viên đi muộn hoặc về sớm trong hôm nay.",
        time: "Hôm nay",
        href: "#",
        icon: "alarm_on",
        priority: "high",
        unread: true
    },
    {
        id: "attendance-absent",
        type: "attendance",
        title: "Vắng mặt / nghỉ phép",
        message: "5 nhân viên vắng mặt, trong đó 2 trường hợp chưa báo cáo.",
        time: "Hôm nay",
        href: "#",
        icon: "person_off",
        priority: "normal",
        unread: true
    },
    {
        id: "attendance-missing-checkout",
        type: "attendance",
        title: "Chưa check-out",
        message: "3 nhân viên đã check-in nhưng chưa ghi nhận giờ ra.",
        time: "Hôm nay",
        href: "#",
        icon: "timelapse",
        priority: "normal",
        unread: false
    }
];

const normalizeStatus = (status) => String(status || "").toLowerCase();

const isLateStatus = (status) => {
    const value = normalizeStatus(status);
    return value.includes("late") || value.includes("muộn");
};

const isAbsentStatus = (status) => {
    const value = normalizeStatus(status);
    return value.includes("absent") || value.includes("vắng");
};

const isLateCheckIn = (checkIn) => {
    if (!checkIn) return false;

    const date = checkIn instanceof Date ? checkIn : new Date(checkIn);

    if (Number.isNaN(date.getTime())) return false;

    return date.getHours() * 60 + date.getMinutes() > 8 * 60 + 30;
};

const formatTime = (value) => {
    if (!value) return "Hôm nay";

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) return "Hôm nay";

    return date.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit"
    });
};

const buildAttendanceNotifications = (rows) => {
    const lateRows = rows.filter((row) => isLateStatus(row.status) || isLateCheckIn(row.check_in));
    const absentRows = rows.filter((row) => isAbsentStatus(row.status));
    const missingCheckoutRows = rows.filter((row) => row.check_in && !row.check_out);
    const presentRows = rows.filter((row) => row.check_in);

    const notifications = [];

    if (lateRows.length > 0) {
        notifications.push({
            id: "attendance-late",
            type: "attendance",
            title: "Đi muộn / về sớm",
            message: `${lateRows.length} nhân viên đi muộn hoặc về sớm trong hôm nay.`,
            time: formatTime(lateRows[0].check_in),
            href: "#",
            icon: "alarm_on",
            priority: "high",
            unread: true
        });
    }

    if (absentRows.length > 0) {
        notifications.push({
            id: "attendance-absent",
            type: "attendance",
            title: "Vắng mặt / nghỉ phép",
            message: `${absentRows.length} nhân viên vắng mặt trong bảng chấm công hôm nay.`,
            time: "Hôm nay",
            href: "#",
            icon: "person_off",
            priority: "normal",
            unread: true
        });
    }

    if (missingCheckoutRows.length > 0) {
        notifications.push({
            id: "attendance-missing-checkout",
            type: "attendance",
            title: "Chưa check-out",
            message: `${missingCheckoutRows.length} nhân viên đã check-in nhưng chưa ghi nhận giờ ra.`,
            time: "Hôm nay",
            href: "#",
            icon: "timelapse",
            priority: "normal",
            unread: false
        });
    }

    if (notifications.length === 0 && presentRows.length > 0) {
        notifications.push({
            id: "attendance-summary",
            type: "attendance",
            title: "Chấm công hôm nay",
            message: `${presentRows.length} nhân viên đã check-in, chưa ghi nhận bất thường.`,
            time: "Hôm nay",
            href: "#",
            icon: "fact_check",
            priority: "normal",
            unread: false
        });
    }

    return notifications;
};

const getAttendanceNotifications = async () => {
    try {
        const [rows] = await db.execute(
            `SELECT a.employee_id, e.full_name, e.employee_code,
                    a.check_in, a.check_out, a.status
             FROM attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE a.work_date = CURDATE()`
        );

        if (rows.length === 0) {
            return DEMO_ATTENDANCE_NOTIFICATIONS;
        }

        const notifications = buildAttendanceNotifications(rows);

        return notifications.length > 0 ? notifications : DEMO_ATTENDANCE_NOTIFICATIONS;
    } catch (error) {
        console.warn("Không tải được thông báo chấm công:", error.message);
        return DEMO_ATTENDANCE_NOTIFICATIONS;
    }
};

/**
 * Lấy danh sách thông báo hiển thị ở trang tổng quan.
 * Gồm 2 nhóm: đơn nghỉ & giải trình, bảng chấm công.
 */
export const getOverviewNotifications = async () => {
    const attendanceNotifications = await getAttendanceNotifications();
    const leaveNotifications = DEMO_LEAVE_NOTIFICATIONS;

    const notifications = [...leaveNotifications, ...attendanceNotifications].sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return 0;
    });

    return {
        notifications,
        leaveNotifications,
        attendanceNotifications,
        unreadCount: notifications.filter((item) => item.unread).length
    };
};

export const getOverviewData = async () => {
    const today = new Date();
    const yyyyMmDd = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const todayDate = yyyyMmDd(today);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayDate = yyyyMmDd(yesterday);

    const emptyData = {
        todayDate,
        activeEmployees: 0,
        presentEmployees: 0,
        onTimeEmployees: 0,
        lateOrEarlyEmployees: 0,
        lateEmployees: 0,
        earlyLeaveEmployees: 0,
        overtimeEmployees: 0,
        leaveEmployees: 0,
        absentEmployees: 0,
        attendanceRate: 0,
        yesterdayAttendanceRate: 0,
        onTimeRate: 0,
        averageLateMinutes: 0,
        reportedLeaveEmployees: 0,
        unreportedAbsentEmployees: 0,
        departments: 0,
        liveRows: [],
        people: [],
        pendingRequests: [],
        weeklyRates: []
    };

    try {
        const [employeeRows] = await db.execute(
            `SELECT COUNT(*) AS total,
                    COUNT(DISTINCT department) AS departments
               FROM employees
              WHERE is_active = 1`
        );
        const activeEmployees = Number(employeeRows[0]?.total || 0);
        const departments = Number(employeeRows[0]?.departments || 0);

        const [attendanceRows] = await db.execute(
            `SELECT e.id, e.employee_code, e.full_name, e.department, e.position,
                    (SELECT TIME_FORMAT(ws.morning_start, '%H:%i')
                       FROM employee_shift_assignments sa
                       INNER JOIN work_shifts ws ON ws.id = sa.shift_id AND ws.status = 1
                       INNER JOIN shift_workdays sw ON sw.shift_id = ws.id AND sw.weekday = WEEKDAY(?) + 1
                      WHERE sa.employee_id = e.id AND sa.status = 'active'
                        AND ? BETWEEN sa.start_date AND sa.end_date
                      ORDER BY sa.start_date DESC LIMIT 1) AS shift_start,
                    (SELECT TIME_FORMAT(ws.afternoon_end, '%H:%i')
                       FROM employee_shift_assignments sa
                       INNER JOIN work_shifts ws ON ws.id = sa.shift_id AND ws.status = 1
                       INNER JOIN shift_workdays sw ON sw.shift_id = ws.id AND sw.weekday = WEEKDAY(?) + 1
                      WHERE sa.employee_id = e.id AND sa.status = 'active'
                        AND ? BETWEEN sa.start_date AND sa.end_date
                      ORDER BY sa.start_date DESC LIMIT 1) AS shift_end,
                    a.check_in, a.check_out, a.status, a.record_source,
                    a.check_in_latitude, a.check_in_longitude,
                    ds.status AS day_status, ds.note AS day_status_note
               FROM employees e
               LEFT JOIN attendance a
                 ON a.employee_id = e.id
                AND a.work_date = ?
               LEFT JOIN attendance_day_statuses ds
                 ON ds.employee_id = e.id
                AND ds.work_date = ?
              WHERE e.is_active = 1
              ORDER BY (a.check_in IS NULL) ASC,
                       a.check_in DESC,
                       e.employee_code ASC
              LIMIT 500`,
            [todayDate, todayDate, todayDate, todayDate, todayDate, todayDate]
        );

        const leaveEmployees = attendanceRows.filter((row) =>
            ["leave", "business_trip", "overtime"].includes(String(row.day_status || "").toLowerCase())
        ).length;
        const presentEmployees = attendanceRows.filter((row) => row.check_in).length;

        const OVERTIME_AFTER_MINUTES = 30; // ra muộn từ 30 phút sau giờ tan ca thì tính là tăng ca
        const toMinutes = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
        const dateMinutes = (v) => {
            if (!v) return null;
            const d = v instanceof Date ? v : new Date(v);
            return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
        };
        const dayLabels = { leave: "Nghỉ phép", business_trip: "Công tác", overtime: "Tăng ca" };
        // Phân loại 1 nhân viên theo ca được phân công (không có ca thì mặc định vào 08:30).
        const analyze = (row) => {
            const inM = dateMinutes(row.check_in);
            const outM = dateMinutes(row.check_out);
            const startM = row.shift_start ? toMinutes(row.shift_start) : 8 * 60 + 30;
            const endM = row.shift_end ? toMinutes(row.shift_end) : null;
            const status = String(row.status || "").toLowerCase();
            const lateMinutes = inM !== null ? Math.max(0, inM - startM) : 0;
            const earlyMinutes = outM !== null && endM !== null ? Math.max(0, endM - outM) : 0;
            const overtimeMinutes = outM !== null && endM !== null ? Math.max(0, outM - endM) : 0;
            const late = inM !== null && (lateMinutes > 0 || status.includes("late"));
            const early = outM !== null && (earlyMinutes > 0 || status.includes("early_leave"));
            const overtime = overtimeMinutes >= OVERTIME_AFTER_MINUTES || (inM !== null && row.day_status === "overtime");
            let displayStatus;
            if (inM === null) {
                displayStatus = row.day_status ? (dayLabels[row.day_status] || row.day_status) : "Vắng, chưa chấm công";
            } else {
                const parts = [];
                if (late) parts.push(lateMinutes > 0 ? `Đi muộn ${lateMinutes} phút` : "Đi muộn");
                if (early) parts.push(earlyMinutes > 0 ? `Về sớm ${earlyMinutes} phút` : "Về sớm");
                if (overtime) parts.push(overtimeMinutes > 0 ? `Tăng ca ${overtimeMinutes} phút` : "Tăng ca");
                if (!parts.length) parts.push(outM === null ? "Đang làm việc" : "Đúng giờ");
                displayStatus = parts.join(" • ");
            }
            return { late, early, overtime, late_minutes: lateMinutes, early_minutes: earlyMinutes, overtime_minutes: overtimeMinutes, displayStatus };
        };
        attendanceRows.forEach((row) => Object.assign(row, analyze(row)));
        const lateEmployees = attendanceRows.filter((row) => row.late).length;
        const earlyLeaveEmployees = attendanceRows.filter((row) => row.early).length;
        const overtimeEmployees = attendanceRows.filter((row) => row.overtime).length;
        const lateOrEarlyEmployees = attendanceRows.filter((row) => row.late || row.early).length;
        const onTimeEmployees = attendanceRows.filter((row) => row.check_in && !row.late && !row.early).length;
        const lateList = attendanceRows.filter((row) => row.late && row.late_minutes > 0);
        const averageLateMinutes = lateList.length
            ? Math.round(lateList.reduce((sum, row) => sum + row.late_minutes, 0) / lateList.length)
            : 0;

        const absentEmployees = Math.max(0, activeEmployees - presentEmployees - leaveEmployees);
        const attendanceRate = activeEmployees
            ? Math.round((presentEmployees / activeEmployees) * 1000) / 10
            : 0;
        const onTimeRate = presentEmployees
            ? Math.round((onTimeEmployees / presentEmployees) * 1000) / 10
            : 0;

        const [yesterdayRows] = await db.execute(
    `SELECT COUNT(DISTINCT employee_id) AS present
       FROM attendance
      WHERE work_date = ?
        AND check_in IS NOT NULL`,
    [yesterdayDate]
);
        const yesterdayPresent = Number(yesterdayRows[0]?.present || 0);
        const yesterdayAttendanceRate = activeEmployees
            ? Math.round((yesterdayPresent / activeEmployees) * 1000) / 10
            : 0;

        const [requestRows] = await db.execute(
            `SELECT r.id, r.request_code, r.request_type, r.reason, r.category,
                    r.destination, r.created_at,
                    DATE_FORMAT(r.created_at, '%H:%i') AS created_time,
                    e.full_name, e.department
               FROM attendance_requests r
               JOIN employees e ON e.id = r.employee_id
              WHERE r.status = 'pending'
              ORDER BY r.created_at DESC
              LIMIT 5`
        );

        const liveRows = attendanceRows
            .filter((row) => row.check_in || row.day_status)
            .slice(0, 6)
            .map((row) => {
                return {
                    ...row,
                    initials: String(row.full_name || "")
                        .trim()
                        .split(/\s+/)
                        .slice(-2)
                        .map((word) => word[0])
                        .join("")
                        .toUpperCase(),
                };
            });

        const people = attendanceRows.map((row) => {
            return {
                id: row.id,
                employee_code: row.employee_code,
                full_name: row.full_name,
                department: row.department,
                check_in: row.check_in,
                check_out: row.check_out,
                late: row.late,
                early: row.early,
                overtime: row.overtime,
                late_minutes: row.late_minutes,
                early_minutes: row.early_minutes,
                overtime_minutes: row.overtime_minutes,
                has_check_in: Boolean(row.check_in),
                day_status: row.day_status || null,
                displayStatus: row.displayStatus
            };
        });

        const monday = new Date(today);
        const weekday = (today.getDay() + 6) % 7;
        monday.setDate(today.getDate() - weekday);
        const weeklyRates = [];
        for (let index = 0; index < 5; index += 1) {
            const date = new Date(monday);
            date.setDate(monday.getDate() + index);
            const dateText = yyyyMmDd(date);
            const [rows] = await db.execute(
                `SELECT COUNT(DISTINCT employee_id) AS present
                   FROM attendance
                  WHERE work_date = ?
                    AND check_in IS NOT NULL`,
                [dateText]
            );
            weeklyRates.push({
                date: dateText,
                label: ["T2", "T3", "T4", "T5", "T6"][index],
                rate: activeEmployees
                    ? Math.round((Number(rows[0]?.present || 0) / activeEmployees) * 100)
                    : 0
            });
        }

        return {
            todayDate,
            activeEmployees,
            presentEmployees,
            onTimeEmployees,
            lateOrEarlyEmployees,
            lateEmployees,
            earlyLeaveEmployees,
            overtimeEmployees,
            leaveEmployees,
            absentEmployees,
            attendanceRate,
            yesterdayAttendanceRate,
            onTimeRate,
            averageLateMinutes,
            reportedLeaveEmployees: leaveEmployees,
            unreportedAbsentEmployees: absentEmployees,
            departments,
            liveRows,
            people,
            pendingRequests: requestRows,
            weeklyRates
        };
    } catch (error) {
        console.warn("Không tải được dữ liệu tổng quan:", error.message);
        return emptyData;
    }
};