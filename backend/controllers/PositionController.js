import * as PositionModel from "../models/PositionModel.js";

const text = {
    created: "Đã thêm chức vụ.", updated: "Đã cập nhật chức vụ và hồ sơ nhân viên.", deleted: "Đã xóa chức vụ.",
    duplicate: "Tên chức vụ đã tồn tại.", has_employees: "Không thể xóa chức vụ đang có nhân viên. Hãy chuyển nhân viên sang chức vụ khác trước."
};
const validate = (value) => {
    const name = typeof value === "string" ? value.trim() : "";
    return { name, error: !name || name.length > 100 ? "Tên chức vụ là bắt buộc và không vượt quá 100 ký tự." : null };
};
const renderPage = async (req, res, { error = null, success = null, status = 200 } = {}) => {
    try {
        const positions = await PositionModel.findAll();
        return res.status(status).render("admin/positions", { user: req.session.user, positions, error, success });
    } catch (cause) {
        console.error("Lỗi tải danh sách chức vụ:", cause);
        return res.status(500).render("admin/positions", { user: req.session.user, positions: [], error: "Không thể tải danh sách chức vụ.", success: null });
    }
};
export const index = (req, res) => renderPage(req, res, { success: text[String(req.query.success || "")] || null, error: text[String(req.query.error || "")] || null });
export const create = async (req, res) => {
    const { name, error } = validate(req.body.position_name);
    if (error) return renderPage(req, res, { error, status: 400 });
    try {
        await PositionModel.create(name);
        return res.redirect("/admin/positions?success=created");
    } catch (cause) {
        if (cause.code === "ER_DUP_ENTRY") return renderPage(req, res, { error: text.duplicate, status: 409 });
        console.error("Lỗi thêm chức vụ:", cause);
        return renderPage(req, res, { error: "Không thể thêm chức vụ.", status: 500 });
    }
};
export const update = async (req, res) => {
    const id = Number(req.params.id);
    const { name, error } = validate(req.body.position_name);
    if (!Number.isSafeInteger(id) || id <= 0) return renderPage(req, res, { error: "Mã chức vụ không hợp lệ.", status: 400 });
    if (error) return renderPage(req, res, { error, status: 400 });
    try {
        if (!await PositionModel.renameById(id, name)) return renderPage(req, res, { error: "Không tìm thấy chức vụ.", status: 404 });
        return res.redirect("/admin/positions?success=updated");
    } catch (cause) {
        if (cause.code === "ER_DUP_ENTRY") return renderPage(req, res, { error: text.duplicate, status: 409 });
        console.error("Lỗi cập nhật chức vụ:", cause);
        return renderPage(req, res, { error: "Không thể cập nhật chức vụ.", status: 500 });
    }
};
export const remove = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return renderPage(req, res, { error: "Mã chức vụ không hợp lệ.", status: 400 });
    try {
        const result = await PositionModel.removeById(id);
        if (result === "not_found") return renderPage(req, res, { error: "Không tìm thấy chức vụ.", status: 404 });
        if (result === "has_employees") return renderPage(req, res, { error: text.has_employees, status: 409 });
        return res.redirect("/admin/positions?success=deleted");
    } catch (cause) {
        console.error("Lỗi xóa chức vụ:", cause);
        return renderPage(req, res, { error: "Không thể xóa chức vụ.", status: 500 });
    }
};
