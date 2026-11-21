
import {
    getEmployeesWithFaceStatus,
    getFaceRegistrationStats,
    getEmployeeFaceDetail,
    deleteFaceProfile,
    createFaceProfile,
    getAllFaceProfiles,
    getFaceProfileByEmployeeId
} from "../models/FaceModel.js";
import {
    isFaceDescriptorUsable,
    findMatchingEmployee
} from "../services/FaceService.js";
import { writeFaceAuditLog } from "../services/faceAuditService.js";
import { getDepartments } from "../models/EmployeeModel.js";

// Danh sách nhân viên và trạng thái khuôn mặt
export const getFaceEmployees = async (req, res) => {
    try {
        const search = String(req.query.search || "").trim().slice(0, 100);
        const { status = "all" } = req.query;
        const department = String(req.query.department || "").trim().slice(0, 100);
        const includeMeta = String(req.query.includeMeta || "").toLowerCase() !== "false";

        const [employees, metadata] = await Promise.all([
            getEmployeesWithFaceStatus({ search, status, department }),
            includeMeta
                ? Promise.all([getFaceRegistrationStats(), getDepartments()])
                : Promise.resolve(null)
        ]);

        const response = {
            success: true,
            employees
        };

        if (metadata) {
            const [stats, departments] = metadata;
            response.stats = stats;
            response.departments = departments;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error("Lỗi lấy danh sách khuôn mặt:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy danh sách nhân viên"
        });
    }
};

// Chi tiết đăng ký khuôn mặt
export const getFaceEmployeeDetail = async (req, res) => {
    try {
        const employeeId = Number(req.params.employeeId);

        if (!Number.isInteger(employeeId) || employeeId <= 0) {
            return res.status(400).json({
                success: false,
                message: "ID nhân viên không hợp lệ"
            });
        }

        const employee = await getEmployeeFaceDetail(employeeId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy nhân viên"
            });
        }

        return res.status(200).json({
            success: true,
            employee
        });
    } catch (error) {
        console.error("Lỗi lấy chi tiết khuôn mặt:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể lấy thông tin nhân viên"
        });
    }
};

// Lưu descriptor khuôn mặt cho đăng ký mới hoặc cập nhật hồ sơ.
// Chỉ nhận descriptor 128 số đã được kiểm tra và yêu cầu xác nhận đồng ý.
const saveFaceProfile = async (req, res, mode) => {
    try {
        const employeeId = Number(req.params.employeeId);

        if (!Number.isInteger(employeeId) || employeeId <= 0) {
            return res.status(400).json({
                success: false,
                message: "ID nhân viên không hợp lệ"
            });
        }

        const { descriptor, consent } = req.body || {};

        if (consent !== true) {
            return res.status(400).json({
                success: false,
                message: "Cần xác nhận sự đồng ý của nhân viên trước khi lưu dữ liệu khuôn mặt."
            });
        }

        if (!isFaceDescriptorUsable(descriptor)) {
            return res.status(400).json({
                success: false,
                message: "Dữ liệu khuôn mặt không hợp lệ. Vui lòng chụp lại."
            });
        }

        const employee = await getEmployeeFaceDetail(employeeId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy nhân viên"
            });
        }

        const hasProfile = Boolean(employee.face_profile_id);

        if (mode === "register" && hasProfile) {
            return res.status(409).json({
                success: false,
                message: "Nhân viên đã có hồ sơ khuôn mặt. Vui lòng dùng chức năng cập nhật."
            });
        }

        if (mode === "update" && !hasProfile) {
            return res.status(404).json({
                success: false,
                message: "Nhân viên chưa có hồ sơ khuôn mặt. Vui lòng đăng ký trước."
            });
        }

        // Không cho phép một khuôn mặt được đăng ký cho nhiều nhân viên.
        const allProfiles = await getAllFaceProfiles();
        const otherProfiles = allProfiles.filter(
            (profile) => Number(profile.employee_id) !== employeeId
        );
        const duplicate = findMatchingEmployee(descriptor, otherProfiles);

        if (duplicate.matched && duplicate.employee) {
            return res.status(409).json({
                success: false,
                message: `Khuôn mặt này đã được đăng ký cho nhân viên ${duplicate.employee.employee_code} - ${duplicate.employee.full_name}.`
            });
        }

        await createFaceProfile(employeeId, descriptor, mode);

        // Không ghi descriptor vào log, chỉ ghi thao tác và nhân viên liên quan.
        await writeFaceAuditLog({
            action: mode === "register"
                ? "register_face_profile"
                : "update_face_profile",
            actor: req.session.user,
            employee: {
                id: employee.id,
                employee_code: employee.employee_code,
                full_name: employee.full_name
            },
            detail: mode === "register"
                ? "Đăng ký dữ liệu khuôn mặt."
                : "Cập nhật dữ liệu khuôn mặt.",
            req
        });

        return res.status(200).json({
            success: true,
            message: mode === "register"
                ? "Đăng ký khuôn mặt thành công"
                : "Cập nhật khuôn mặt thành công"
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY" && mode === "register") {
            return res.status(409).json({
                success: false,
                message: "Nhân viên vừa được đăng ký khuôn mặt ở một thao tác khác. Vui lòng tải lại danh sách."
            });
        }

        console.error(
            `Lỗi ${mode === "register" ? "đăng ký" : "cập nhật"} khuôn mặt:`,
            error
        );

        return res.status(500).json({
            success: false,
            message: mode === "register"
                ? "Không thể đăng ký khuôn mặt"
                : "Không thể cập nhật khuôn mặt"
        });
    }
};

// Đăng ký khuôn mặt mới
export const registerFaceProfile = (req, res) => {
    return saveFaceProfile(req, res, "register");
};

// Cập nhật khuôn mặt đã đăng ký
export const updateFaceProfile = (req, res) => {
    return saveFaceProfile(req, res, "update");
};

export const recognizeFaceProfile = async (req, res) => {
    try {
        const { descriptor, consent } = req.body || {};

        if (consent !== true) {
            return res.status(400).json({
                success: false,
                message: "Cần xác nhận sự đồng ý của người được nhận diện."
            });
        }

        if (!isFaceDescriptorUsable(descriptor)) {
            return res.status(400).json({
                success: false,
                message: "Dữ liệu khuôn mặt không hợp lệ. Vui lòng chụp lại."
            });
        }

        const profiles = await getAllFaceProfiles();
        const result = findMatchingEmployee(descriptor, profiles);

        if (!result.matched || !result.employee) {
            return res.status(200).json({
                success: true,
                matched: false,
                message: "Không tìm thấy hồ sơ khuôn mặt phù hợp."
            });
        }

        const employee = result.employee;

        await writeFaceAuditLog({
            action: "recognize_face_profile",
            actor: req.session.user,
            employee: {
                id: employee.employee_id,
                employee_code: employee.employee_code,
                full_name: employee.full_name
            },
            detail: "Đã nhận diện hồ sơ khuôn mặt.",
            req
        });

        return res.status(200).json({
            success: true,
            matched: true,
            employee: {
                employee_code: employee.employee_code,
                full_name: employee.full_name,
                department: employee.department
            },
            distance: result.distance
        });
    } catch (error) {
        console.error("Lỗi nhận diện khuôn mặt:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể nhận diện khuôn mặt. Vui lòng thử lại."
        });
    }
};

// Xác minh khuôn mặt với hồ sơ của đúng nhân viên được chọn, không tìm kiếm toàn bộ nhân sự.
export const verifyFaceIdentity = async (req, res) => {
    try {
        const employeeId = Number(req.params.employeeId);
        const { descriptor, consent } = req.body || {};

        if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
            return res.status(400).json({ success: false, message: "ID nhân viên không hợp lệ." });
        }
        if (consent !== true) {
            return res.status(400).json({ success: false, message: "Cần xác nhận người được xác minh đồng ý xử lý khuôn mặt." });
        }
        if (!isFaceDescriptorUsable(descriptor)) {
            return res.status(400).json({ success: false, message: "Dữ liệu khuôn mặt không hợp lệ. Vui lòng chụp lại." });
        }

        const [employee, profile] = await Promise.all([
            getEmployeeFaceDetail(employeeId),
            getFaceProfileByEmployeeId(employeeId)
        ]);
        if (!employee) {
            return res.status(404).json({ success: false, message: "Không tìm thấy nhân viên." });
        }
        if (!profile) {
            return res.status(404).json({ success: false, message: "Nhân viên chưa có hồ sơ khuôn mặt để xác minh." });
        }

        const result = findMatchingEmployee(descriptor, [{
            ...profile,
            employee_code: employee.employee_code,
            full_name: employee.full_name,
            department: employee.department
        }]);
        const verified = Boolean(result.matched);
        await writeFaceAuditLog({
            action: verified ? "verify_face_identity_success" : "verify_face_identity_failed",
            actor: req.session.user,
            employee: { id: employee.id, employee_code: employee.employee_code, full_name: employee.full_name },
            detail: verified ? `Đã xác minh danh tính (độ lệch ${result.distance}).` : "Khuôn mặt không khớp hồ sơ nhân viên được chọn.",
            req
        });

        return res.status(200).json({
            success: true,
            verified,
            employee: { employee_code: employee.employee_code, full_name: employee.full_name, department: employee.department },
            distance: result.distance,
            message: verified ? "Xác thực danh tính thành công." : "Khuôn mặt không khớp với hồ sơ nhân viên được chọn."
        });
    } catch (error) {
        console.error("Lỗi xác thực danh tính khuôn mặt:", error);
        return res.status(500).json({ success: false, message: "Không thể xác thực danh tính. Vui lòng thử lại." });
    }
};

// Xóa hồ sơ khuôn mặt
export const removeFaceProfile = async (req, res) => {
    try {
        const employeeId = Number(req.params.employeeId);

        if (!Number.isInteger(employeeId) || employeeId <= 0) {
            return res.status(400).json({
                success: false,
                message: "ID nhân viên không hợp lệ"
            });
        }

        const employee = await getEmployeeFaceDetail(employeeId);

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy nhân viên"
            });
        }

        if (!employee.face_profile_id) {
            return res.status(404).json({
                success: false,
                message: "Nhân viên chưa có hồ sơ khuôn mặt"
            });
        }

        const result = await deleteFaceProfile(employeeId);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Nhân viên chưa có hồ sơ khuôn mặt"
            });
        }

        // Ghi nhận thao tác xóa dữ liệu sinh trắc học.
        await writeFaceAuditLog({
            action: "delete_face_profile",
            actor: req.session.user,
            employee: {
                id: employee.id,
                employee_code: employee.employee_code,
                full_name: employee.full_name
            },
            detail: "Xóa dữ liệu khuôn mặt của nhân viên.",
            req
        });

        return res.status(200).json({
            success: true,
            message: "Đã xóa hồ sơ khuôn mặt thành công"
        });
    } catch (error) {
        console.error("Lỗi xóa hồ sơ khuôn mặt:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể xóa hồ sơ khuôn mặt"
        });
    }
};

export const renderFacePage = (req, res) => {
    res.render("admin/faces", {
        user: req.session.user,
        pageTitle: "Quản lý khuôn mặt",
        activePage: "faces"
    });
};
