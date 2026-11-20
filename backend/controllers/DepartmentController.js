import * as DepartmentModel from "../models/DepartmentModel.js";

const validateName = (value) => {
    const name = typeof value === "string" ? value.trim() : "";
    return {
        name,
        error: !name || name.length > 100
            ? "Tên phòng ban là bắt buộc và không vượt quá 100 ký tự."
            : null
    };
};

const messages = {
    created: "Đã thêm phòng ban.",
    updated: "Đã cập nhật phòng ban và nhân viên trực thuộc.",
    deleted: "Đã xóa phòng ban.",
    duplicate: "Tên phòng ban đã tồn tại. Vui lòng chọn tên khác.",
    has_employees: "Không thể xóa phòng ban đang có nhân viên. Hãy chuyển nhân viên sang phòng ban khác trước."
};

const renderPage = async (req, res, { error = null, success = null, statusCode = 200 } = {}) => {
    try {
        const departments = await DepartmentModel.findAll();
        return res.status(statusCode).render("admin/departments", {
            user: req.session.user,
            departments,
            success,
            error
        });
    } catch (loadError) {
        console.error("Lỗi tải danh sách phòng ban:", loadError);
        return res.status(500).render("admin/departments", {
            user: req.session.user,
            departments: [],
            success: null,
            error: "Không thể tải danh sách phòng ban. Vui lòng thử lại."
        });
    }
};

export const index = async (req, res) => {
    const success = messages[String(req.query.success || "")] || null;
    const error = messages[String(req.query.error || "")] || null;
    return renderPage(req, res, { success, error });
};

export const create = async (req, res) => {
    const { name, error } = validateName(req.body.department_name);
    if (error) return renderPage(req, res, { error, statusCode: 400 });

    try {
        await DepartmentModel.create(name);
        return res.redirect("/admin/departments?success=created");
    } catch (createError) {
        if (createError.code === "ER_DUP_ENTRY") {
            return renderPage(req, res, { error: messages.duplicate, statusCode: 409 });
        }
        console.error("Lỗi thêm phòng ban:", createError);
        return renderPage(req, res, { error: "Không thể thêm phòng ban. Vui lòng thử lại.", statusCode: 500 });
    }
};

export const update = async (req, res) => {
    const id = Number(req.params.id);
    const { name, error } = validateName(req.body.department_name);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return renderPage(req, res, { error: "Mã phòng ban không hợp lệ.", statusCode: 400 });
    }
    if (error) return renderPage(req, res, { error, statusCode: 400 });

    try {
        const updated = await DepartmentModel.renameById(id, name);
        if (!updated) return renderPage(req, res, { error: "Không tìm thấy phòng ban.", statusCode: 404 });
        return res.redirect("/admin/departments?success=updated");
    } catch (updateError) {
        if (updateError.code === "ER_DUP_ENTRY") {
            return renderPage(req, res, { error: messages.duplicate, statusCode: 409 });
        }
        console.error("Lỗi cập nhật phòng ban:", updateError);
        return renderPage(req, res, { error: "Không thể cập nhật phòng ban. Vui lòng thử lại.", statusCode: 500 });
    }
};

export const remove = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return renderPage(req, res, { error: "Mã phòng ban không hợp lệ.", statusCode: 400 });
    }

    try {
        const result = await DepartmentModel.removeById(id);
        if (result.reason === "not_found") {
            return renderPage(req, res, { error: "Không tìm thấy phòng ban.", statusCode: 404 });
        }
        if (result.reason === "has_employees") {
            return renderPage(req, res, { error: messages.has_employees, statusCode: 409 });
        }
        return res.redirect("/admin/departments?success=deleted");
    } catch (deleteError) {
        console.error("Lỗi xóa phòng ban:", deleteError);
        return renderPage(req, res, { error: "Không thể xóa phòng ban. Vui lòng thử lại.", statusCode: 500 });
    }
};
