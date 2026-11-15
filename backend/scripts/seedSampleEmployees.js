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
    { code: "NV005", name: "Hoàng Minh Đức", email: "duc.hoang@chronotime.vn", phone: "0901000005", department: "Kỹ thuật" }
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
                (employee_code, full_name, email, phone, department)
             VALUES (?, ?, ?, ?, ?)`,
            [
                employee.code,
                employee.name,
                employee.email,
                employee.phone,
                employee.department
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
