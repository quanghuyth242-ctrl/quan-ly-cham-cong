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
