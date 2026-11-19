import { db } from "../config/db.js";

const formatDate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
].join("-");

const subtractDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
};

const toDateTime = (workDate, time) => `${workDate} ${time}:00`;

const main = async () => {
    const [employees] = await db.execute(`
        SELECT id, employee_code
          FROM employees
         WHERE is_active = 1
         ORDER BY employee_code ASC
    `);

    let inserted = 0;
    let skipped = 0;
    const today = new Date();

    for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex += 1) {
        const employee = employees[employeeIndex];

        for (let offset = 0; offset < 14; offset += 1) {
            const date = subtractDays(today, offset);
            const weekday = date.getDay();
            if (weekday === 0) continue;

            const workDate = formatDate(date);
            const [existing] = await db.execute(
                `SELECT id
                   FROM attendance
                  WHERE employee_id = ?
                    AND work_date = ?
                  LIMIT 1`,
                [employee.id, workDate]
            );

            if (existing.length > 0) {
                skipped += 1;
                continue;
            }

            const pattern = (offset + employeeIndex) % 8;
            let status = "present";
            let checkIn = "08:00";
            let checkOut = "17:30";

            if (pattern === 3) {
                status = "late";
                checkIn = "08:35";
            } else if (pattern === 6) {
                status = "late";
                checkIn = "08:20";
                checkOut = "17:00";
            } else if (pattern === 7) {
                status = "absent";
                checkIn = null;
                checkOut = null;
            }

            await db.execute(
                `INSERT INTO attendance
                    (employee_id, work_date, check_in, check_out, status, record_source)
                 VALUES (?, ?, ?, ?, ?, 'device')`,
                [
                    employee.id,
                    workDate,
                    checkIn ? toDateTime(workDate, checkIn) : null,
                    checkOut ? toDateTime(workDate, checkOut) : null,
                    status
                ]
            );
            inserted += 1;
        }
    }

    console.log(
        `Đã tạo ${inserted} bản ghi chấm công mẫu cho ${employees.length} nhân viên; ` +
        `bỏ qua ${skipped} bản ghi đã tồn tại.`
    );
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi tạo dữ liệu mẫu chấm công:", error.message);
    await db.end();
    process.exit(1);
});
