// Middleware kiểm tra đăng nhập
export const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    next();
};

// Middleware kiểm tra quyền quản trị
export const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    if (req.session.user.role !== "admin") {
        return res.status(403).send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="utf-8">
                <title>Không có quyền truy cập</title>
            </head>
            <body style="font-family: Inter, sans-serif; padding: 40px; text-align: center;">
                <h1>403 - Không có quyền truy cập</h1>
                <p>Chỉ quản trị viên mới được sử dụng chức năng này.</p>
                <p><a href="/">Quay về trang chủ</a></p>
            </body>
            </html>
        `);
    }

    next();
};
