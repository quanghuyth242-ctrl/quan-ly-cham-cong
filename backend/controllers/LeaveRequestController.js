export const index = async (req, res) => {
    const success = req.query.success || null;
    const error = req.query.error || null;
    const activeTab = ["leave", "explanation", "list"].includes(req.query.tab)
        ? req.query.tab
        : "leave";

    // Dữ liệu mẫu để hiển thị giao diện (chưa kết nối CSDL)
    const requests = [
        {
            id: 1,
            code: "NP-2026-001",
            type: "leave",
            typeLabel: "Nghỉ phép",
            employeeName: req.session.user?.username || "Nguyễn Văn A",
            employeeId: req.session.user?.employee_id || "NV-0001",
            department: "Kỹ thuật",
            fromDate: "2026-11-20",
            toDate: "2026-11-21",
            reason: "Việc gia đình cần giải quyết.",
            status: "pending",
            statusLabel: "Chờ duyệt",
            createdAt: "2026-11-16 08:30"
        },
        {
            id: 2,
            code: "GT-2026-014",
            type: "explanation",
            typeLabel: "Giải trình đi muộn",
            employeeName: req.session.user?.username || "Nguyễn Văn A",
            employeeId: req.session.user?.employee_id || "NV-0001",
            department: "Kỹ thuật",
            fromDate: "2026-11-15",
            toDate: "2026-11-15",
            reason: "Kẹt xe đột xuất trên đường đi làm, đã check-in lúc 08:45.",
            status: "approved",
            statusLabel: "Đã duyệt",
            createdAt: "2026-11-15 09:10"
        },
        {
            id: 3,
            code: "NV-2026-002",
            type: "resignation",
            typeLabel: "Nghỉ việc",
            employeeName: "Trần Thị B",
            employeeId: "NV-0024",
            department: "Kinh doanh",
            fromDate: "2026-12-01",
            toDate: "2026-12-15",
            reason: "Chuyển công tác sang môi trường mới, bàn giao trong 14 ngày.",
            status: "rejected",
            statusLabel: "Từ chối",
            createdAt: "2026-11-10 14:20"
        }
    ];

    const stats = {
        total: requests.length,
        pending: requests.filter((item) => item.status === "pending").length,
        approved: requests.filter((item) => item.status === "approved").length,
        rejected: requests.filter((item) => item.status === "rejected").length
    };

    res.render("requests/index", {
        user: req.session.user,
        success,
        error,
        activeTab,
        requests,
        stats
    });
};

export const createLeave = async (req, res) => {
    // Giao diện demo: chưa lưu CSDL
    const params = new URLSearchParams({
        success: "Đã ghi nhận đơn nghỉ. (Giao diện demo, chưa lưu vào hệ thống)",
        tab: "list"
    });
    res.redirect(`/admin/requests?${params.toString()}`);
};

export const createExplanation = async (req, res) => {
    // Giao diện demo: chưa lưu CSDL
    const params = new URLSearchParams({
        success: "Đã ghi nhận đơn giải trình. (Giao diện demo, chưa lưu vào hệ thống)",
        tab: "list"
    });
    res.redirect(`/admin/requests?${params.toString()}`);
};
