import { db } from "../config/db.js";

/**
 * Tạo nhiều nhân viên mẫu (kèm phân ca) để demo hệ thống có hàng trăm nhân viên.
 * Chạy:  node backend/scripts/seedManyEmployees.js 120
 * (120 là số nhân viên muốn thêm, mặc định 120). Mã nhân viên bắt đầu từ NV101.
 * Chạy lại nhiều lần không bị trùng: nhân viên đã có mã đó sẽ được bỏ qua.
 * Sau đó chạy:  npm run seed:attendance  để tạo chấm công cho tất cả.
 */

const COUNT = Math.max(1, Number(process.argv[2]) || 120);
const START_NUMBER = 101;

const lastNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"];
const middleNames = ["Văn", "Thị", "Minh", "Quốc", "Thanh", "Ngọc", "Gia", "Hữu", "Bảo", "Thu", "Anh", "Đức", "Hoài", "Khánh"];
const firstNames = ["An", "Bình", "Cường", "Dung", "Đức", "Hà", "Huy", "Lan", "Long", "Mai", "Nam", "Nguyên", "Phúc", "Quân", "Trâm", "Linh", "Hùng", "Hạnh", "Tú", "Vy", "Khoa", "Thảo", "Sơn", "Yến", "Tâm", "Phương"];
const departments = ["Kỹ thuật", "Kinh doanh", "Kế toán", "Nhân sự", "Marketing", "Hành chính"];
const shiftMix = ["CA001", "CA001", "CA001", "CA001", "CA001", "CA001", "CA001", "CA002", "CA002", "CA003", "CA007"];

// Bộ sinh số giả ngẫu nhiên cố định theo số thứ tự: chạy lại vẫn ra đúng tên cũ.
const rng = (seed) => {
    let t = seed + 0x6d2b79f5;
    return () => {
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const slug = (text) => text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

const pick = (list, random) => list[Math.floor(random() * list.length)];

const buildEmployee = (number) => {
    const random = rng(number);
    const last = pick(lastNames, random);
    const middle = pick(middleNames, random);
    const first = pick(firstNames, random);
    return {
        code: `NV${number}`,
        name: `${last} ${middle} ${first}`,
        email: `${slug(first)}.${slug(last)}${number}@chronotime.vn`,
        phone: `0902${String(number).padStart(6, "0")}`,
        department: pick(departments, random),
        shiftCode: pick(shiftMix, random)
    };
};

const formatDate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
].join("-");

const main = async () => {
    const [shiftRows] = await db.execute("SELECT id, shift_code FROM work_shifts WHERE status = 1");
    const shiftIds = new Map(shiftRows.map((row) => [row.shift_code, row.id]));
    const fallbackShiftId = shiftIds.get("CA001") || shiftRows[0]?.id || null;

    const start = new Date();
    start.setDate(start.getDate() - 120);
    const end = new Date();
    end.setDate(end.getDate() + 365);

    let inserted = 0;
    let assigned = 0;

    for (let number = START_NUMBER; number < START_NUMBER + COUNT; number += 1) {
        const employee = buildEmployee(number);
        const [existing] = await db.execute(
            "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
            [employee.code]
        );
        if (existing.length > 0) continue;

        const [result] = await db.execute(
            `INSERT INTO employees (employee_code, full_name, email, phone, department, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [employee.code, employee.name, employee.email, employee.phone, employee.department]
        );
        inserted += 1;

        const shiftId = shiftIds.get(employee.shiftCode) || fallbackShiftId;
        if (!shiftId) continue;

        await db.execute(
            `INSERT INTO employee_shift_assignments (employee_id, shift_id, start_date, end_date, status, note)
             VALUES (?, ?, ?, ?, 'active', 'Phân ca mẫu')`,
            [result.insertId, shiftId, formatDate(start), formatDate(end)]
        );
        assigned += 1;
    }

    const [[total]] = await db.execute("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1");
    console.log(`Đã thêm ${inserted} nhân viên mẫu (${assigned} người được phân ca). Tổng nhân viên đang hoạt động: ${total.n}.`);
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi tạo nhân viên mẫu:", error.message);
    await db.end();
    process.exit(1);
});