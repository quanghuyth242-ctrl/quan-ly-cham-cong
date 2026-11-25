import { db } from "../config/db.js";

/**
 * Tạo dữ liệu chấm công mẫu TRÔNG THẬT cho tất cả nhân viên đang hoạt động.
 * Chạy:  node backend/scripts/seedRealisticAttendance.js 30     (30 = số ngày gần nhất, mặc định 30)
 *
 * - Bám theo ca được phân công: chỉ chấm công vào ngày làm việc của ca, giờ vào/ra quanh giờ ca.
 * - Mỗi người có thói quen riêng (phần lớn đúng giờ, một số hay đi muộn).
 * - Có đi muộn, về sớm, nghỉ phép, công tác, vắng không phép với tỉ lệ hợp lý.
 * - Người ở lại muộn: một phần có ĐƠN TĂNG CA được duyệt (tính là tăng ca), phần còn lại chỉ ra muộn
 *   mà không có đơn (KHÔNG tính tăng ca).
 * - Có vài đơn nghỉ/giải trình/tăng ca đang chờ duyệt cho mục "Cần xử lý gấp".
 * - Hôm nay chỉ có người đã đến theo GIỜ HIỆN TẠI; người chưa ra về thì chưa có giờ ra.
 * CẢNH BÁO: xóa chấm công của các ngày trong khoảng này rồi tạo lại.
 */

const DAYS = Math.max(1, Number(process.argv[2]) || 30);
const OFFICE = { lat: 21.0285, lng: 105.8542 };

const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const stamp = (date, minutes, rnd) => `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(Math.floor(rnd() * 60))}`;
const between = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

const rng = (seed) => {
    let t = (seed >>> 0) + 0x6d2b79f5;
    return () => {
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

const main = async () => {
    const [employees] = await db.execute("SELECT id, employee_code FROM employees WHERE is_active = 1 ORDER BY id");
    const [assignments] = await db.execute(
        `SELECT sa.employee_id, DATE_FORMAT(sa.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(sa.end_date, '%Y-%m-%d') AS end_date,
                ws.id AS shift_id, TIME_FORMAT(ws.morning_start, '%H:%i') AS shift_start, TIME_FORMAT(ws.afternoon_end, '%H:%i') AS shift_end
           FROM employee_shift_assignments sa
           JOIN work_shifts ws ON ws.id = sa.shift_id AND ws.status = 1
          WHERE sa.status = 'active'
          ORDER BY sa.start_date DESC, sa.id DESC`
    );
    const [workdayRows] = await db.execute("SELECT shift_id, weekday FROM shift_workdays");

    const workdays = new Map();
    workdayRows.forEach((r) => { if (!workdays.has(r.shift_id)) workdays.set(r.shift_id, new Set()); workdays.get(r.shift_id).add(Number(r.weekday)); });
    const byEmployee = new Map();
    assignments.forEach((a) => { if (!byEmployee.has(a.employee_id)) byEmployee.set(a.employee_id, []); byEmployee.get(a.employee_id).push(a); });

    const [gpsCol] = await db.execute("SHOW COLUMNS FROM attendance LIKE 'check_in_latitude'");
    const hasGps = gpsCol.length > 0;

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = fmtDate(now);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (DAYS - 1));
    const startStr = fmtDate(startDate);

    await db.execute("DELETE FROM attendance WHERE work_date >= ?", [startStr]);
    await db.execute("DELETE FROM attendance_day_statuses WHERE work_date >= ? AND note LIKE '[Mẫu]%'", [startStr]);
    await db.execute("DELETE FROM attendance_requests WHERE request_code LIKE 'MAU-%' AND from_date >= ?", [startStr]);

    const attendanceRows = [];
    const statusRows = [];
    const requestRows = [];
    const stats = { workdays: 0, present: 0, late: 0, early: 0, overtime: 0, stayedLate: 0, absent: 0, leave: 0, trip: 0 };

    for (const employee of employees) {
        const habit = rng(employee.id * 7919)();
        const profile = habit < 0.6 ? { lateProb: 0.015, early: [5, 30] }
            : habit < 0.9 ? { lateProb: 0.06, early: [0, 20] }
            : { lateProb: 0.18, early: [-3, 8] };
        let remaining = 0;
        let remainingType = null;

        for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
            const day = new Date(now);
            day.setDate(day.getDate() - offset);
            const dateStr = fmtDate(day);
            const weekday = day.getDay() === 0 ? 7 : day.getDay();
            const isToday = dateStr === todayStr;
            const rnd = rng(employee.id * 100003 + Math.floor(day.getTime() / 86400000));

            // Tìm ca đang áp dụng đúng ngày (giống cách trang Tổng quan chọn ca).
            const shift = (byEmployee.get(employee.id) || []).find((a) =>
                a.start_date <= dateStr && a.end_date >= dateStr && workdays.get(a.shift_id)?.has(weekday));
            const hasAnyAssignment = (byEmployee.get(employee.id) || []).some((a) => a.start_date <= dateStr && a.end_date >= dateStr);
            let schedule = null;
            if (shift) schedule = { start: toMin(shift.shift_start), end: toMin(shift.shift_end) };
            else if (!hasAnyAssignment && weekday <= 5) schedule = { start: 8 * 60 + 30, end: 17 * 60 + 30 };
            if (!schedule) continue;
            stats.workdays += 1;

            // Nghỉ phép / công tác kéo dài nhiều ngày làm việc liên tiếp.
            if (remaining > 0) {
                remaining -= 1;
                statusRows.push([employee.id, dateStr, remainingType, remainingType === "leave" ? "[Mẫu] Nghỉ phép" : "[Mẫu] Đi công tác", "Dữ liệu mẫu"]);
                stats[remainingType === "leave" ? "leave" : "trip"] += 1;
                continue;
            }
            const roll = rnd();
            if (roll < 0.025) {
                const isSick = rnd() < 0.4;
                remaining = rnd() < 0.7 ? 0 : 1;
                remainingType = "leave";
                statusRows.push([employee.id, dateStr, "leave", isSick ? "[Mẫu] Nghỉ ốm" : "[Mẫu] Nghỉ phép năm", "Dữ liệu mẫu"]);
                stats.leave += 1;
                continue;
            }
            if (roll < 0.033) {
                remaining = between(rnd, 1, 2);
                remainingType = "business_trip";
                statusRows.push([employee.id, dateStr, "business_trip", "[Mẫu] Đi công tác", "Dữ liệu mẫu"]);
                stats.trip += 1;
                continue;
            }
            if (!isToday && roll < 0.045) {
                attendanceRows.push([employee.id, dateStr, null, null, "absent", "manual", null, null, null, null, null, null]);
                stats.absent += 1;
                continue;
            }

            // Giờ vào: đúng giờ thì đến sớm 0-30 phút, đi muộn thì trễ vài phút đến vài chục phút.
            let inMin;
            if (rnd() < profile.lateProb) inMin = schedule.start + 3 + Math.min(70, Math.floor(-Math.log(1 - rnd()) * 12));
            else inMin = schedule.start - between(rnd, profile.early[0], profile.early[1]);
            if (isToday && inMin > nowMin) continue; // chưa đến giờ này nên chưa chấm công

            // Giờ ra: phần lớn đúng giờ, một ít về sớm, một ít tăng ca.
            const r2 = rnd();
            let outMin;
            if (r2 < 0.05) outMin = schedule.end - between(rnd, 12, 70);
            else if (r2 < 0.6) outMin = schedule.end + between(rnd, 0, 12);
            else if (r2 < 0.88) outMin = schedule.end + between(rnd, 13, 28);
            else outMin = schedule.end + between(rnd, 30, 150);
            if (outMin <= inMin + 120) outMin = inMin + 480;
            // Ở lại từ 30 phút trở lên: 60% có đơn tăng ca được duyệt, 40% chỉ ra muộn không đơn.
            if (outMin - schedule.end >= 30) {
                if (rnd() < 0.6) {
                    const otEnd = Math.ceil(outMin / 30) * 30;
                    requestRows.push([`MAU-OT-${employee.id}-${dateStr}`, employee.id, dateStr, dateStr, "[Mẫu] Hoàn thành công việc dự án", `${pad(Math.floor(schedule.end / 60))}:${pad(schedule.end % 60)}:00`, `${pad(Math.floor(otEnd / 60))}:${pad(otEnd % 60)}:00`]);
                    statusRows.push([employee.id, dateStr, "overtime", "[Mẫu] Tăng ca", "Dữ liệu mẫu"]);
                    if (!(isToday && outMin > nowMin)) stats.overtime += 1;
                } else if (!(isToday && outMin > nowMin)) stats.stayedLate += 1;
            }
            const hasOut = !(isToday && outMin > nowMin);

            const late = inMin > schedule.start;
            stats.present += 1;
            if (late) stats.late += 1;
            if (hasOut && outMin < schedule.end) stats.early += 1;

            const gps = hasGps && rnd() < 0.3;
            const geo = () => {
                const lat = OFFICE.lat + (rnd() - 0.5) * 0.0012;
                const lng = OFFICE.lng + (rnd() - 0.5) * 0.0012;
                return { lat: lat.toFixed(7), lng: lng.toFixed(7), acc: (5 + rnd() * 25).toFixed(2), dist: Math.round(Math.hypot((lat - OFFICE.lat) * 111000, (lng - OFFICE.lng) * 103000)) };
            };
            const g1 = gps ? geo() : null;
            const g2 = gps && hasOut ? geo() : null;
            attendanceRows.push([
                employee.id, dateStr, stamp(dateStr, inMin, rnd), hasOut ? stamp(dateStr, outMin, rnd) : null,
                late ? "late" : "present", gps ? "manual" : "device",
                g1 && g1.lat, g1 && g1.lng, g1 && g1.acc, g1 && g1.dist, g2 && g2.lat, g2 && g2.lng
            ]);
        }
    }

    // Vài đơn đang chờ duyệt để mục "Cần xử lý gấp" có dữ liệu.
    const pendingTexts = [
        ["leave", "Xin nghỉ phép để giải quyết việc gia đình"],
        ["leave", "Xin nghỉ ốm có giấy khám"],
        ["explanation", "Giải trình quên chấm công buổi sáng"],
        ["explanation", "Giải trình đi muộn do kẹt xe"],
        ["overtime", "Xin tăng ca để kịp tiến độ báo cáo"],
        ["overtime", "Xin tăng ca hỗ trợ khách hàng"]
    ];
    const pendingFrom = fmtDate(new Date(now.getTime() + 86400000));
    pendingTexts.forEach(([type, reason], i) => {
        const employee = employees[Math.floor(rng(i + 11)() * employees.length)];
        if (employee) requestRows.push([`MAU-P-${i + 1}-${todayStr}`, employee.id, pendingFrom, pendingFrom, `[Mẫu] ${reason}`, type === "overtime" ? "17:00:00" : null, type === "overtime" ? "20:00:00" : null, type]);
    });

    const cols = hasGps
        ? "(employee_id, work_date, check_in, check_out, status, record_source, check_in_latitude, check_in_longitude, check_in_accuracy_m, check_in_distance_m, check_out_latitude, check_out_longitude)"
        : "(employee_id, work_date, check_in, check_out, status, record_source)";
    for (const part of chunk(attendanceRows, 500)) {
        await db.query(`INSERT INTO attendance ${cols} VALUES ?`, [hasGps ? part : part.map((r) => r.slice(0, 6))]);
    }
    for (const part of chunk(statusRows, 500)) {
        await db.query("INSERT IGNORE INTO attendance_day_statuses (employee_id, work_date, status, note, updated_by) VALUES ?", [part]);
    }

    for (const part of chunk(requestRows, 200)) {
        const approved = part.filter((r) => r.length === 7);
        const pending = part.filter((r) => r.length === 8);
        if (approved.length) {
            await db.query(
                `INSERT IGNORE INTO attendance_requests (request_code, employee_id, request_type, category, from_date, to_date, reason, overtime_start_time, overtime_end_time, status, created_by)
                 VALUES ?`,
                [approved.map((r) => [r[0], r[1], "overtime", "overtime", r[2], r[3], r[4], r[5], r[6], "approved", "Dữ liệu mẫu"])]
            );
        }
        if (pending.length) {
            await db.query(
                `INSERT IGNORE INTO attendance_requests (request_code, employee_id, request_type, category, from_date, to_date, reason, overtime_start_time, overtime_end_time, status, created_by)
                 VALUES ?`,
                [pending.map((r) => [r[0], r[1], r[7], r[7], r[2], r[3], r[4], r[5], r[6], "pending", "Dữ liệu mẫu"])]
            );
        }
    }

    const pct = (n) => (stats.workdays ? `${Math.round((n / stats.workdays) * 1000) / 10}%` : "0%");
    console.log(`Đã tạo ${attendanceRows.length} bản ghi chấm công và ${statusRows.length} ngày nghỉ/công tác/tăng ca cho ${employees.length} nhân viên (${DAYS} ngày gần nhất).`);
    console.log(`Tỉ lệ trên các ngày làm việc: có mặt ${pct(stats.present)}, đi muộn ${pct(stats.late)}, về sớm ${pct(stats.early)}, tăng ca có đơn ${pct(stats.overtime)}, ở lại muộn không đơn ${pct(stats.stayedLate)}, nghỉ phép ${pct(stats.leave)}, công tác ${pct(stats.trip)}, vắng không phép ${pct(stats.absent)}.`);
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi tạo dữ liệu chấm công mẫu:", error.message);
    await db.end();
    process.exit(1);
});