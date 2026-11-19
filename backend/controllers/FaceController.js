
import {
    getEmployeesWithFaceStatus,
    getFaceRegistrationStats,
    getEmployeeFaceDetail,
    deleteFaceProfile,
    createFaceProfile,
    getAllFaceProfiles
} from "../models/FaceModel.js";
import {
    isFaceDescriptorUsable,
    findMatchingEmployee
} from "../services/FaceService.js";
import { writeFaceAuditLog } from "../services/faceAuditService.js";

// Danh sách nhân viên và trạng thái khuôn mặt
export const getFaceEmployees = async (req, res) => {
    try {
        const { search = "", status = "all" } = req.query;

        const [employees, stats] = await Promise.all([
            getEmployeesWithFaceStatus({ search, status }),
            getFaceRegistrationStats()
        ]);

        return res.status(200).json({
            success: true,
            employees,
            stats
        });
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

        // Thời điểm đồng ý do server ghi nhận, không tin tưởng thời gian từ client.
        const consentAt = new Date();

        await createFaceProfile(employeeId, descriptor, consentAt);

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
