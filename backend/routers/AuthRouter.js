
import express from "express";
import { login, logout } from "../controllers/authController.js";

const router = express.Router();

router.get("/login", (req, res) => {
    // Nếu người dùng đã đăng nhập thì chuyển về trang chủ
    if (req.session.user) {
        return res.redirect("/");
    }

    res.render("auth", {
        error: null,
        message: req.query.loggedOut ? "Bạn đã đăng xuất khỏi hệ thống." : null
    });
});

router.post("/login", login);

// Hỗ trợ cả GET (đường dẫn trực tiếp) và POST (form/nút đăng xuất)
router.get("/logout", logout);
router.post("/logout", logout);

export default router;
