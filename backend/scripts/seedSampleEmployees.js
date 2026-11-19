import { db } from "../config/db.js";

/**
 * Script tạo dữ liệu nhân viên mẫu để thử nghiệm chức năng phân ca.
 * Có thể chạy lại nhiều lần: bỏ qua nhân viên đã tồn tại (theo employee_code).
 * Chạy: node backend/scripts/seedSampleEmployees.js
 */

const employees = [
    { code: "NV001", name: "Nguyễn Văn An", email: "an.nguyen@chronotime.vn", phone: "0901000001", department: "Kỹ thuật" },
    { code: "NV002", name: "Trần Thị Bình", email: "binh.tran@chronotime.vn", phone: "0901000002", department: "Kinh doanh" },
    { code: "NV003", name: "Lê Hoàng Cường", email: "cuong.le@chronotime.vn", phone: "0901000003", department: "Kế toán" },
    { code: "NV004", name: "Phạm Thu Dung", email: "dung.pham@chronotime.vn", phone: "0901000004", department: "Nhân sự" },
    { code: "NV005", name: "Hoàng Minh Đức", email: "duc.hoang@chronotime.vn", phone: "0901000005", department: "Kỹ thuật" },
    { code: "NV006", name: "Vũ Thanh Hà", email: "ha.vu@chronotime.vn", phone: "0901000006", department: "Marketing", active: 1 },
    { code: "NV007", name: "Đặng Quốc Huy", email: "huy.dang@chronotime.vn", phone: "0901000007", department: "Kinh doanh", active: 1 },
    { code: "NV008", name: "Bùi Ngọc Lan", email: "lan.bui@chronotime.vn", phone: "0901000008", department: "Nhân sự", active: 1 },
    { code: "NV009", name: "Ngô Văn Long", email: "long.ngo@chronotime.vn", phone: "0901000009", department: "Hành chính", active: 1 },
    { code: "NV010", name: "Đỗ Thị Mai", email: "mai.do@chronotime.vn", phone: "0901000010", department: "Kế toán", active: 1 },
    { code: "NV011", name: "Phan Minh Nam", email: "nam.phan@chronotime.vn", phone: "0901000011", department: "Kỹ thuật", active: 1 },
    { code: "NV012", name: "Lý Thảo Nguyên", email: "nguyen.ly@chronotime.vn", phone: "0901000012", department: "Marketing", active: 1 },
    { code: "NV013", name: "Trương Gia Phúc", email: "phuc.truong@chronotime.vn", phone: "0901000013", department: "Hành chính", active: 1 },
    { code: "NV014", name: "Cao Minh Quân", email: "quan.cao@chronotime.vn", phone: "0901000014", department: "Kỹ thuật", active: 0 },
    { code: "NV015", name: "Võ Bảo Trâm", email: "tram.vo@chronotime.vn", phone: "0901000015", department: "Kinh doanh", active: 0 }
];

const main = async () => {
    let inserted = 0;

    for (const employee of employees) {
        const [existing] = await db.execute(
            "SELECT id FROM employees WHERE employee_code = ? LIMIT 1",
            [employee.code]
        );

        if (existing.length > 0) continue;

        await db.execute(
            `INSERT INTO employees
                (employee_code, full_name, email, phone, department, is_active, deactivated_at)
             VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 0 THEN NOW() ELSE NULL END)`,
            [
                employee.code,
                employee.name,
                employee.email,
                employee.phone,
                employee.department,
                employee.active ?? 1,
                employee.active ?? 1
            ]
        );

        inserted += 1;
    }

    console.log(`Đã thêm ${inserted} nhân viên mẫu (bỏ qua ${employees.length - inserted} nhân viên đã tồn tại).`);
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi tạo dữ liệu mẫu:", error.message);
    await db.end();
    process.exit(1);
});
