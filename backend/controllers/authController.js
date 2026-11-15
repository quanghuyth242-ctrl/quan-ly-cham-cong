
import { findByUsername } from "../models/user.js";
import bcrypt from "bcryptjs";

// Xử lý đăng nhập
export const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.render("auth", {
                error: "Vui lòng nhập đầy đủ thông tin đăng nhập!"
            });
        }

        const user = await findByUsername(username);

        if (!user) {
            return res.render("auth", {
                error: "Tài khoản hoặc mật khẩu không chính xác!"
            });
        }

        if (user.status !== "active") {
            return res.render("auth", {
                error: "Tài khoản chưa được kích hoạt hoặc đã bị khóa!"
            });
        }

        const checkPassword = await bcrypt.compare(
            password,
            user.password
        );

        if (!checkPassword) {
            return res.render("auth", {
                error: "Tài khoản hoặc mật khẩu không chính xác!"
            });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            employee_id: user.employee_id,
            role: user.role
        };

        res.redirect("/");

    } catch (error) {
        console.log(error);

        res.render("auth", {
            error: "Có lỗi xảy ra, vui lòng thử lại!"
        });
    }
};

// Xử lý đăng xuất
export const logout = (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.log(error);
            return res.redirect("/");
        }

        // Xóa cookie session trên trình duyệt
        res.clearCookie("connect.sid");

        res.redirect("/login?loggedOut=1");
    });
};
