// Thiết lập toàn bộ database bằng MỘT lệnh:
//   1) Nạp file .sql (đúng UTF-8) - XÓA database quanlynhansu hiện có
//   2) Tạo các bảng của code mới (phòng ban, chức vụ, GPS, đơn nghỉ, thiết bị, khuôn mặt, ca...)
//   3) Thêm nhân viên mẫu (kèm phân ca)
//   4) Tạo dữ liệu chấm công mẫu 14 ngày gần nhất
// Cách dùng:
//   node backend/scripts/setupDatabase.js "C:\duong\dan\quanlynhansu_full.sql" 120
// (120 là số nhân viên mẫu muốn thêm, bỏ trống = 120; ghi 0 để không thêm)
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sqlFile = process.argv[2];
const extra = process.argv[3] === undefined ? "120" : process.argv[3];

if (!sqlFile) {
    console.log('Thiếu đường dẫn file .sql. Cách dùng: node backend/scripts/setupDatabase.js "đường\\dẫn\\file.sql" 120');
    process.exit(1);
}

const steps = [
    ["Nạp file SQL (UTF-8)", "importSql.js", [sqlFile]],
    ["Bảng phòng ban", "initDepartmentModule.js"],
    ["Bảng chức vụ", "initPositionModule.js"],
    ["Trạng thái nhân viên", "initEmployeeStatusModule.js"],
    ["Chấm công GPS", "initGpsAttendance.js"],
    ["Trạng thái chấm công theo ngày", "initAttendanceDayStatuses.js"],
    ["Đơn nghỉ / công tác", "initAttendanceRequests.js"],
    ["Chỉ mục chấm công", "initAttendanceIndexes.js"],
    ["Thiết bị chấm công", "initDeviceModule.js"],
    ["Hồ sơ khuôn mặt", "initFaceProfiles.js"],
    ["Ca làm việc / phân ca", "initShiftModule.js"]
];
if (Number(extra) > 0) steps.push([`Thêm ${extra} nhân viên mẫu`, "seedManyEmployees.js", [extra]]);
steps.push(["Dữ liệu chấm công mẫu", "seedSampleAttendance.js"]);

for (let i = 0; i < steps.length; i += 1) {
    const [label, file, args = []] = steps[i];
    console.log(`\n[${i + 1}/${steps.length}] ${label}`);
    const result = spawnSync(process.execPath, [path.join(dir, file), ...args], { stdio: "inherit" });
    if (result.status !== 0) {
        console.log(`\nDừng ở bước "${label}" vì bị lỗi. Hãy copy dòng lỗi phía trên gửi người hỗ trợ.`);
        process.exit(1);
    }
}

console.log("\nXong! Database đã sẵn sàng. Chạy: npm run dev");