import { db } from "../config/db.js";
import { validateFaceDescriptor } from "../services/FaceService.js";

const FACE_STATUS_FILTERS = ["all", "registered", "unregistered"];

export const normalizeFaceStatus = (status) => {
    const value = String(status || "all").toLowerCase();

    return FACE_STATUS_FILTERS.includes(value) ? value : "all";
};

// Đăng ký dữ liệu khuôn mặt (ghi mới hoặc cập nhật nếu nhân viên đã có hồ sơ)
export const createFaceProfile = async (employeeId, descriptor) => {
    if (!validateFaceDescriptor(descriptor)) {
        throw new Error("Dữ liệu khuôn mặt không hợp lệ (cần mảng 128 số).");
    }

    const faceEmbedding = Buffer.from(
        JSON.stringify(descriptor),
        "utf8"
    );

    const existing = await getFaceProfileByEmployeeId(employeeId);

    if (existing) {
        const [result] = await db.execute(
            `UPDATE face_profiles
             SET face_embedding = ?, consent_at = CURRENT_TIMESTAMP
             WHERE employee_id = ?`,
            [faceEmbedding, employeeId]
        );

        return result;
    }

    const [result] = await db.execute(
        `INSERT INTO face_profiles
         (employee_id, face_embedding, consent_at, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [employeeId, faceEmbedding]
    );

    return result;
};

// Lấy dữ liệu khuôn mặt theo nhân viên (chỉ dùng phía server)
export const getFaceProfileByEmployeeId = async (employeeId) => {
    const sql = `
        SELECT
            id,
            employee_id,
            face_embedding,
            consent_at,
            created_at
        FROM face_profiles
        WHERE employee_id = ?
        LIMIT 1
    `;

    const [rows] = await db.execute(sql, [employeeId]);

    return rows[0] || null;
};

// Lấy danh sách dữ liệu khuôn mặt để đối chiếu (không trả về trình duyệt)
export const getAllFaceProfiles = async () => {
    const sql = `
        SELECT
            fp.employee_id,
            fp.face_embedding,
            e.employee_code,
            e.full_name,
            e.department
        FROM face_profiles fp
        INNER JOIN employees e
            ON fp.employee_id = e.id
        ORDER BY fp.employee_id ASC
    `;

    const [rows] = await db.execute(sql);

    return rows;
};

// Danh sách nhân viên kèm trạng thái đăng ký khuôn mặt
export const getEmployeesWithFaceStatus = async ({
    search = "",
    status = "all",
    department = ""
} = {}) => {
    const keyword = String(search || "").trim();
    const statusFilter = normalizeFaceStatus(status);
    const departmentFilter = String(department || "").trim().slice(0, 100);

    const sql = `
        SELECT
            e.id,
            e.employee_code,
            e.full_name,
            e.email,
            e.department,
            fp.id AS face_profile_id,
            DATE_FORMAT(fp.consent_at, '%d/%m/%Y %H:%i') AS consent_at,
            DATE_FORMAT(fp.created_at, '%d/%m/%Y') AS face_created_at
        FROM employees e
        LEFT JOIN face_profiles fp
            ON fp.employee_id = e.id
        WHERE (
                ? = ''
                OR e.employee_code LIKE CONCAT('%', ?, '%')
                OR e.full_name LIKE CONCAT('%', ?, '%')
            )
            AND (
                ? = 'all'
                OR (? = 'registered' AND fp.id IS NOT NULL)
                OR (? = 'unregistered' AND fp.id IS NULL)
            )
            AND (
                ? = ''
                OR e.department = ?
            )
        ORDER BY e.employee_code ASC
    `;

    const [rows] = await db.execute(sql, [
        keyword,
        keyword,
        keyword,
        statusFilter,
        statusFilter,
        statusFilter,
        departmentFilter,
        departmentFilter
    ]);

    return rows;
};

// Thống kê số lượng nhân viên đã / chưa đăng ký khuôn mặt
export const getFaceRegistrationStats = async () => {
    const sql = `
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN fp.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS registered,
            COALESCE(SUM(CASE WHEN fp.id IS NULL THEN 1 ELSE 0 END), 0) AS unregistered
        FROM employees e
        LEFT JOIN face_profiles fp
            ON fp.employee_id = e.id
    `;

    const [rows] = await db.execute(sql);
    const stats = rows[0] || {};

    const total = Number(stats.total || 0);
    const registered = Number(stats.registered || 0);

    return {
        total,
        registered,
        unregistered: Number(stats.unregistered || 0),
        registrationRate: total > 0 ? Math.round((registered / total) * 100) : 0
    };
};

// Chi tiết trạng thái đăng ký của một nhân viên (không lấy face_embedding)
export const getEmployeeFaceDetail = async (employeeId) => {
    const sql = `
        SELECT
            e.id,
            e.employee_code,
            e.full_name,
            e.email,
            e.phone,
            e.department,
            fp.id AS face_profile_id,
            DATE_FORMAT(fp.consent_at, '%d/%m/%Y %H:%i') AS consent_at,
            DATE_FORMAT(fp.created_at, '%d/%m/%Y %H:%i') AS face_created_at
        FROM employees e
        LEFT JOIN face_profiles fp
            ON fp.employee_id = e.id
        WHERE e.id = ?
        LIMIT 1
    `;

    const [rows] = await db.execute(sql, [employeeId]);

    return rows[0] || null;
};

// Xóa dữ liệu khuôn mặt của nhân viên
export const deleteFaceProfile = async (employeeId) => {
    const sql = `
        DELETE FROM face_profiles
        WHERE employee_id = ?
    `;

    const [result] = await db.execute(sql, [employeeId]);

    return result;
};

// Kiểm tra nhân viên đã đăng ký khuôn mặt chưa
export const checkFaceProfile = async (employeeId) => {
    const sql = `
        SELECT id
        FROM face_profiles
        WHERE employee_id = ?
        LIMIT 1
    `;

    const [rows] = await db.execute(sql, [employeeId]);

    return rows.length > 0;
};
