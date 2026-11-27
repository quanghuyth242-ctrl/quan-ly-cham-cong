// Phát tin realtime (SSE) tới các trang quản trị đang mở.
const clients = new Set();
let timer = null;

export const addClient = (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    res.write("retry: 3000\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
};

const broadcast = (type) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
    for (const res of clients) res.write(payload);
};

// Gộp nhiều thay đổi liên tiếp và chờ 400ms để transaction MySQL kịp commit.
export const notifyAttendanceChanged = () => {
    clearTimeout(timer);
    timer = setTimeout(() => broadcast("attendance"), 400);
};

// Duyệt đơn làm thay đổi cả chấm công lẫn danh sách đơn chờ xử lý.
// Trang chủ đã lắng nghe "attendance"; "requests" dành cho trang đơn mở song song.
let requestTimer = null;
export const notifyRequestsChanged = () => {
    clearTimeout(requestTimer);
    requestTimer = setTimeout(() => {
        broadcast("requests");
        broadcast("attendance");
    }, 400);
};