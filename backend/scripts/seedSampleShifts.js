import { db } from "../config/db.js";

const sampleEmployees = [
    { code: "NV001", name: "Nguyễn Văn An", department: "Kỹ thuật" },
    { code: "NV002", name: "Trần Thị Bình", department: "Kinh doanh" },
    { code: "NV003", name: "Lê Hoàng Cường", department: "Kế toán" },
    { code: "NV004", name: "Phạm Thu Dung", department: "Nhân sự" },
    { code: "NV005", name: "Hoàng Minh Đức", department: "Kỹ thuật" }
];

const sampleShifts = [
    {
        code: "CA001",
        name: "Ca hành chính",
        morningStart: "08:00:00",
        morningEnd: "12:00:00",
        afternoonStart: "13:30:00",
        afternoonEnd: "17:30:00",
        workdays: [1, 2, 3, 4, 5, 6],
        status: 1
    },
    {
        code: "CA002",
        name: "Ca sáng",
        morningStart: "06:30:00",
        morningEnd: "11:30:00",
        afternoonStart: "12:00:00",
        afternoonEnd: "14:30:00",
        workdays: [1, 2, 3, 4, 5],
        status: 1
    },
    {
        code: "CA003",
        name: "Ca chiều",
        morningStart: "12:30:00",
        morningEnd: "17:00:00",
        afternoonStart: "17:30:00",
        afternoonEnd: "21:30:00",
        workdays: [1, 2, 3, 4, 5, 6],
        status: 1
    },
    {
        code: "CA004",
        name: "Ca linh hoạt",
        morningStart: "09:00:00",
        morningEnd: "12:30:00",
        afternoonStart: "13:30:00",
        afternoonEnd: "18:00:00",
        workdays: [1, 2, 3, 4, 5],
        status: 0
    },
    {
        code: "CA005",
        name: "Ca trực cuối tuần",
        morningStart: "07:30:00",
        morningEnd: "12:00:00",
        afternoonStart: "13:00:00",
        afternoonEnd: "17:00:00",
        workdays: [6, 7],
        status: 1
    },
    {
        code: "CA006",
        name: "Ca đêm",
        morningStart: "22:00:00",
        morningEnd: "02:00:00",
        afternoonStart: "02:30:00",
        afternoonEnd: "06:00:00",
        workdays: [1, 2, 3, 4, 5, 6, 7],
        status: 1
    },
    {
        code: "CA007",
        name: "Ca bán thời gian",
        morningStart: "08:00:00",
        morningEnd: "12:00:00",
        afternoonStart: "13:00:00",
        afternoonEnd: "15:00:00",
        workdays: [2, 4, 6],
        status: 1
    }
];

const SAMPLE_ATTENDANCE_DAYS = 14;

const main = async () => {
    let employeeInserted = 0;
    let shiftInserted = 0;
    let workdayInserted = 0;
    let assignmentInserted = 0;
    let assignmentUpdated = 0;

    for (const employee of sampleEmployees) {
        const [existing] = await db.execute(
            "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
            [employee.code]
        );

        if (existing.length > 0) continue;

        await db.execute(
            `INSERT INTO employees
                (employee_code, full_name, department, is_active)
             VALUES (?, ?, ?, 1)`,
            [employee.code, employee.name, employee.department]
        );
        employeeInserted += 1;
    }

    const shiftIds = new Map();

    for (const shift of sampleShifts) {
        const [existing] = await db.execute(
            "SELECT id FROM work_shifts WHERE shift_code = ? LIMIT 1",
            [shift.code]
        );

        let shiftId;
        if (existing.length > 0) {
            shiftId = existing[0].id;
            await db.execute(
                `UPDATE work_shifts
                    SET shift_name = ?,
                        morning_start = ?,
                        morning_end = ?,
                        afternoon_start = ?,
                        afternoon_end = ?,
                        status = ?
                  WHERE id = ?`,
                [
                    shift.name,
                    shift.morningStart,
                    shift.morningEnd,
                    shift.afternoonStart,
                    shift.afternoonEnd,
                    shift.status,
                    shiftId
                ]
            );
        } else {
            const [inserted] = await db.execute(
                `INSERT INTO work_shifts
                    (shift_code, shift_name, morning_start, morning_end,
                     afternoon_start, afternoon_end, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    shift.code,
                    shift.name,
                    shift.morningStart,
                    shift.morningEnd,
                    shift.afternoonStart,
                    shift.afternoonEnd,
                    shift.status
                ]
            );
            shiftId = inserted.insertId;
            shiftInserted += 1;
        }

        await db.execute("DELETE FROM shift_workdays WHERE shift_id = ?", [shiftId]);
        for (const weekday of shift.workdays) {
            await db.execute(
                "INSERT INTO shift_workdays (shift_id, weekday) VALUES (?, ?)",
                [shiftId, weekday]
            );
            workdayInserted += 1;
        }

        shiftIds.set(shift.code, shiftId);
    }

    const [dateRangeRows] = await db.execute(
        `SELECT DATE_FORMAT(
                    DATE_SUB(CURDATE(), INTERVAL ${SAMPLE_ATTENDANCE_DAYS} DAY),
                    '%Y-%m-%d'
                ) AS start_date,
                DATE_FORMAT(LAST_DAY(CURDATE()), '%Y-%m-%d') AS end_date`
    );
    const { start_date: startDate, end_date: endDate } = dateRangeRows[0];

    const assignments = [
        { employeeCode: "NV001", shiftCode: "CA001", note: "Phân ca hành chính theo tuần" },
        { employeeCode: "NV002", shiftCode: "CA001", note: "Phân ca hành chính theo tuần" },
        { employeeCode: "NV003", shiftCode: "CA002", note: "Phân ca buổi sáng" },
        { employeeCode: "NV004", shiftCode: "CA003", note: "Phân ca buổi chiều" },
        { employeeCode: "NV005", shiftCode: "CA001", note: "Phân ca kỹ thuật" },
        { employeeCode: "NV006", shiftCode: "CA005", note: "Phân ca trực cuối tuần" },
        { employeeCode: "NV007", shiftCode: "CA001", note: "Phân ca kinh doanh" },
        { employeeCode: "NV008", shiftCode: "CA002", note: "Phân ca nhân sự" },
        { employeeCode: "NV009", shiftCode: "CA007", note: "Phân ca bán thời gian" },
        { employeeCode: "NV010", shiftCode: "CA001", note: "Phân ca kế toán" },
        { employeeCode: "NV011", shiftCode: "CA002", note: "Phân ca kỹ thuật buổi sáng" },
        { employeeCode: "NV012", shiftCode: "CA003", note: "Phân ca marketing buổi chiều" },
        { employeeCode: "NV013", shiftCode: "CA001", note: "Phân ca hành chính" }
    ];

    for (const assignment of assignments) {
        const [employeeRows] = await db.execute(
            "SELECT id FROM employees WHERE employee_code = ? AND is_active = 1 LIMIT 1",
            [assignment.employeeCode]
        );
        if (employeeRows.length === 0) continue;

        const employeeId = employeeRows[0].id;
        const shiftId = shiftIds.get(assignment.shiftCode);
        if (!shiftId) continue;

        const [existing] = await db.execute(
            `SELECT id,
                    DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
                    DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
                    note
               FROM employee_shift_assignments
              WHERE employee_id = ?
                AND shift_id = ?
                AND status = 'active'
                AND start_date <= ?
                AND end_date >= ?
              ORDER BY start_date ASC, id ASC`,
            [employeeId, shiftId, endDate, startDate]
        );

        if (existing.length > 0) {
            const keeper = existing[0];
            const expandedStart = keeper.start_date < startDate ? keeper.start_date : startDate;
            const expandedEnd = keeper.end_date > endDate ? keeper.end_date : endDate;

            if (expandedStart !== keeper.start_date || expandedEnd !== keeper.end_date) {
                await db.execute(
                    `UPDATE employee_shift_assignments
                        SET start_date = ?, end_date = ?
                      WHERE id = ?`,
                    [expandedStart, expandedEnd, keeper.id]
                );
                assignmentUpdated += 1;
            }

            for (const duplicate of existing.slice(1)) {
                if (duplicate.note !== assignment.note) continue;
                await db.execute(
                    `UPDATE employee_shift_assignments
                        SET status = 'cancelled'
                      WHERE id = ? AND status = 'active'`,
                    [duplicate.id]
                );
            }
            continue;
        }

        await db.execute(
            `INSERT INTO employee_shift_assignments
                (employee_id, shift_id, start_date, end_date, status, note)
             VALUES (?, ?, ?, ?, 'active', ?)`,
            [employeeId, shiftId, startDate, endDate, assignment.note]
        );
        assignmentInserted += 1;
    }

    console.log(
        `Đã tạo dữ liệu mẫu ca/lịch trực: ${employeeInserted} nhân viên, ${shiftInserted} ca mới, ` +
        `${workdayInserted} ngày làm việc, ${assignmentInserted} phân ca mới và ` +
        `${assignmentUpdated} phân ca đã mở rộng cho lịch sử.`
    );
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi tạo dữ liệu mẫu ca/lịch trực:", error.message);
    await db.end();
    process.exit(1);
});
