import * as EmployeeModel from "../models/EmployeeModel.js";

const EMPTY_STATS = { total: 0, departments: 0, unassignedDepartment: 0, active: 0, inactive: 0 };
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9._-]{1,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+\d().\-\s]+$/;

const parseId = (value) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const getFilters = (query = {}) => ({
    search: String(query.search || "").trim().slice(0, 100),
    department: String(query.department || "").trim().slice(0, 100),
    status: ["active", "inactive"].includes(String(query.status || "").trim())
        ? String(query.status).trim()
        : ""
});

const getPageData = async (filters) => {
    const [employees, departments, positions, stats, availableEmployeeCodes] = await Promise.all([
        EmployeeModel.findAll(filters),
        EmployeeModel.getDepartments(),
        EmployeeModel.getPositions(),
        EmployeeModel.getStats(),
        EmployeeModel.getAvailableEmployeeCodes()
    ]);

    return { employees, departments, positions, stats, availableEmployeeCodes };
};

const renderPage = async (req, res, {
    filters = getFilters(req.query),
    error = null,
    success = null,
    formValues = {},
    employeeModalOpen = false,
    formMode = "create",
    formEmployeeId = null,
    statusCode = 200
} = {}) => {
    try {
        const pageData = await getPageData(filters);
        return res.status(statusCode).render("admin/employees", {
            user: req.session.user,
            ...pageData,
            filters,
            formValues,
            employeeModalOpen,
            formMode,
            formEmployeeId,
            success,
            error
        });
    } catch (loadError) {
        console.error("Lỗi tải danh sách nhân sự:", loadError);
        return res.status(500).render("admin/employees", {
            user: req.session.user,
            employees: [],
            departments: [],
            positions: [],
            availableEmployeeCodes: [],
            stats: EMPTY_STATS,
            filters,
            formValues,
            employeeModalOpen,
            formMode,
            formEmployeeId,
            success: null,
            error: "Không thể tải danh sách nhân sự. Vui lòng thử lại."
        });
    }
};

const validateEmployee = (body = {}, employeeCode = null) => {
    const employee = {
        employee_code: String(employeeCode === null ? body.employee_code || "" : employeeCode)
            .trim()
            .toUpperCase(),
        full_name: String(body.full_name || "").trim(),
        email: String(body.email || "").trim().toLowerCase(),
        phone: String(body.phone || "").trim(),
        department: String(body.department || "").trim(),
        position: String(body.position || "").trim()
    };
    const errors = [];

    if (!EMPLOYEE_CODE_PATTERN.test(employee.employee_code)) {
        errors.push("Mã nhân viên được chọn không hợp lệ.");
    }
    if (!employee.full_name || employee.full_name.length > 150) {
        errors.push("Họ và tên là bắt buộc và không vượt quá 150 ký tự.");
    }
    if (employee.email.length > 150 || (employee.email && !EMAIL_PATTERN.test(employee.email))) {
        errors.push("Email không hợp lệ hoặc vượt quá 150 ký tự.");
    }
    if (employee.phone.length > 20 || (employee.phone && !PHONE_PATTERN.test(employee.phone))) {
        errors.push("Số điện thoại không hợp lệ hoặc vượt quá 20 ký tự.");
    }
    if (employee.department.length > 100) {
        errors.push("Tên phòng ban không vượt quá 100 ký tự.");
    }
    if (employee.position.length > 100) {
        errors.push("Tên chức vụ không vượt quá 100 ký tự.");
    }

    return {
        employee: {
            ...employee,
            email: employee.email || null,
            phone: employee.phone || null,
            department: employee.department || null,
            position: employee.position || null
        },
        errors
    };
};

export const index = async (req, res) => renderPage(req, res, {
    success: req.query.success === "created"
        ? "Đã thêm nhân viên mới."
        : req.query.success === "updated" ? "Đã cập nhật thông tin nhân viên."
        : req.query.success === "deactivated" ? "Đã ngừng hoạt động nhân viên."
        : req.query.success === "reactivated" ? "Đã khôi phục hoạt động nhân viên." : null,
    error: req.query.error ? String(req.query.error).replaceAll("+", " ") : null
});

export const profile = async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
        return res.status(400).render("admin/employeeProfile", {
            user: req.session.user,
            employee: null,
            error: "Mã nhân viên không hợp lệ."
        });
    }

    try {
        const employee = await EmployeeModel.findById(id);
        if (!employee) {
            return res.status(404).render("admin/employeeProfile", {
                user: req.session.user,
                employee: null,
                error: "Không tìm thấy hồ sơ nhân viên."
            });
        }

        return res.render("admin/employeeProfile", {
            user: req.session.user,
            employee,
            error: null
        });
    } catch (error) {
        console.error("Lỗi tải hồ sơ nhân viên:", error);
        return res.status(500).render("admin/employeeProfile", {
            user: req.session.user,
            employee: null,
            error: "Không thể tải hồ sơ nhân viên. Vui lòng thử lại."
        });
    }
};

export const refresh = async (req, res) => {
    try {
        const filters = getFilters(req.query);
        const [employees, stats, availableEmployeeCodes] = await Promise.all([
            EmployeeModel.findAll(filters),
            EmployeeModel.getStats(),
            EmployeeModel.getAvailableEmployeeCodes()
        ]);

        return res.render("admin/employeeRows", { employees }, (renderError, rowsHtml) => {
            if (renderError) {
                console.error("Lỗi tạo nội dung làm mới nhân sự:", renderError);
                return res.status(500).json({
                    error: "Không thể đồng bộ danh sách nhân viên. Vui lòng thử lại."
                });
            }

            return res.json({
                rowsHtml,
                stats,
                availableEmployeeCodes,
                refreshedAt: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error("Lỗi đồng bộ danh sách nhân viên:", error);
        return res.status(500).json({
            error: "Không thể đồng bộ danh sách nhân viên. Vui lòng thử lại."
        });
    }
};

export const create = async (req, res) => {
    const { employee, errors } = validateEmployee(req.body);

    if (errors.length === 0) {
        try {
            const [availableCodes, departments, positions] = await Promise.all([
                EmployeeModel.getAvailableEmployeeCodes(),
                EmployeeModel.getDepartments(),
                EmployeeModel.getPositions()
            ]);
            if (!availableCodes.includes(employee.employee_code)) {
                errors.push("Vui lòng chọn một mã nhân viên còn trống trong danh sách.");
            }
            if (employee.department && !departments.includes(employee.department)) {
                errors.push("Vui lòng chọn phòng ban có trong danh mục quản lý.");
            }
            if (employee.position && !positions.includes(employee.position)) {
                errors.push("Vui lòng chọn chức vụ có trong danh mục quản lý.");
            }
        } catch (error) {
            console.error("Lỗi kiểm tra mã nhân viên còn trống:", error);
            return renderPage(req, res, {
                filters: getFilters(),
                formValues: employee,
                employeeModalOpen: true,
                formMode: "create",
                error: "Không thể kiểm tra mã nhân viên. Vui lòng thử lại.",
                statusCode: 500
            });
        }
    }

    if (errors.length > 0) {
        return renderPage(req, res, {
            filters: getFilters(),
            formValues: employee,
            employeeModalOpen: true,
            formMode: "create",
            error: errors.join(" "),
            statusCode: 400
        });
    }

    try {
        await EmployeeModel.create(employee);
        return res.redirect("/admin/employees?success=created");
    } catch (error) {
        const isDuplicateCode = error.code === "ER_DUP_ENTRY";
        if (!isDuplicateCode) {
            console.error("Lỗi thêm nhân viên:", error);
        }

        return renderPage(req, res, {
            filters: getFilters(),
            formValues: employee,
            employeeModalOpen: true,
            formMode: "create",
            error: isDuplicateCode
                ? "Mã nhân viên vừa được sử dụng. Vui lòng chọn mã khác."
                : "Không thể thêm nhân viên. Vui lòng thử lại.",
            statusCode: isDuplicateCode ? 409 : 500
        });
    }
};

export const update = async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
        return renderPage(req, res, {
            error: "Mã nhân viên không hợp lệ.",
            statusCode: 400
        });
    }

    try {
        const existingEmployee = await EmployeeModel.findById(id);
        if (!existingEmployee) {
            return renderPage(req, res, {
                error: "Không tìm thấy nhân viên cần cập nhật.",
                statusCode: 404
            });
        }

        const { employee, errors } = validateEmployee(req.body, existingEmployee.employee_code);
        if (errors.length === 0 && employee.department) {
            const departments = await EmployeeModel.getDepartments();
            if (!departments.includes(employee.department)) {
                errors.push("Vui lòng chọn phòng ban có trong danh mục quản lý.");
            }
        }
        if (errors.length === 0 && employee.position) {
            const positions = await EmployeeModel.getPositions();
            if (!positions.includes(employee.position)) {
                errors.push("Vui lòng chọn chức vụ có trong danh mục quản lý.");
            }
        }
        if (errors.length > 0) {
            return renderPage(req, res, {
                filters: getFilters(),
                formValues: employee,
                employeeModalOpen: true,
                formMode: "edit",
                formEmployeeId: id,
                error: errors.join(" "),
                statusCode: 400
            });
        }

        await EmployeeModel.update(id, employee);
        return res.redirect("/admin/employees?success=updated");
    } catch (error) {
        console.error("Lỗi cập nhật thông tin nhân viên:", error);
        const existingEmployee = await EmployeeModel.findById(id).catch((loadError) => {
            console.error("Lỗi tải lại hồ sơ nhân viên sau khi cập nhật thất bại:", loadError);
            return null;
        });

        return renderPage(req, res, {
            filters: getFilters(),
            formValues: existingEmployee
                ? { ...existingEmployee, ...req.body, employee_code: existingEmployee.employee_code }
                : {},
            employeeModalOpen: Boolean(existingEmployee),
            formMode: "edit",
            formEmployeeId: existingEmployee ? id : null,
            error: "Không thể cập nhật thông tin nhân viên. Vui lòng thử lại.",
            statusCode: 500
        });
    }
};

export const toggleStatus = async (req, res) => {
    const id = parseId(req.params.id);
    const wantsJson = req.headers?.accept?.includes("application/json");
    if (!id) {
        if (wantsJson) return res.status(400).json({ error: "Mã nhân viên không hợp lệ." });
        return res.redirect("/admin/employees?error=M%C3%A3+nh%C3%A2n+vi%C3%AAn+kh%C3%B4ng+h%E1%BB%A3p+l%E1%BB%87.");
    }

    try {
        const employee = await EmployeeModel.findById(id);
        if (!employee) {
            if (wantsJson) return res.status(404).json({ error: "Không tìm thấy nhân viên." });
            return res.redirect("/admin/employees?error=Không+tìm+thấy+nhân+viên.");
        }

        const isActive = employee.is_active === 1 || employee.is_active === true;
        const updated = await EmployeeModel.setActiveStatus(id, !isActive);
        if (!updated) {
            if (wantsJson) return res.status(404).json({ error: "Không tìm thấy nhân viên." });
            return res.redirect("/admin/employees?error=Không+tìm+thấy+nhân+viên.");
        }

        if (wantsJson) {
            return res.json({
                success: true,
                employeeId: id,
                isActive: !isActive,
                message: isActive
                    ? "Đã ngừng hoạt động nhân viên."
                    : "Đã khôi phục hoạt động nhân viên."
            });
        }

        return res.redirect(
            `/admin/employees?success=${isActive ? "deactivated" : "reactivated"}`
        );
    } catch (error) {
        console.error("Lỗi cập nhật trạng thái nhân viên:", error);
        if (wantsJson) {
            return res.status(500).json({ error: "Không thể cập nhật trạng thái nhân viên." });
        }
        return res.redirect("/admin/employees?error=Không+thể+cập+nhật+trạng+thái+nhân+viên.");
    }
};

export const remove = async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: "Mã nhân viên không hợp lệ." });
    }

    try {
        const result = await EmployeeModel.removeById(id);
        if (!result.deleted) {
            if (result.reason === "not_found") {
                return res.status(404).json({ error: "Không tìm thấy nhân viên cần xóa." });
            }

            return res.status(409).json({
                error: "Không thể xóa nhân viên vì đang có dữ liệu chấm công, sự kiện thiết bị hoặc phân ca. Hãy ngừng hoạt động nhân viên để giữ lịch sử."
            });
        }

        return res.json({ success: true, message: "Đã xóa hồ sơ nhân viên." });
    } catch (error) {
        console.error("Lỗi xóa nhân viên:", error);
        if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
            return res.status(409).json({
                error: "Không thể xóa nhân viên vì còn dữ liệu liên quan. Hãy ngừng hoạt động nhân viên để giữ lịch sử."
            });
        }

        return res.status(500).json({ error: "Không thể xóa nhân viên. Vui lòng thử lại." });
    }
};
