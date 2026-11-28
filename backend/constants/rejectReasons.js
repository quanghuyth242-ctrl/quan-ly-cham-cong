// Lý do gợi ý khi admin từ chối đơn. Dùng chung cho modal danh sách và trang chi tiết.
const COMMON_REASONS = [
    "Thông tin trong đơn chưa đầy đủ, vui lòng bổ sung rõ lý do trước khi gửi lại.",
    "Lý do chưa phù hợp với quy định của công ty, vui lòng kiểm tra lại.",
    "Vui lòng liên hệ quản lý trực tiếp để được hướng dẫn cụ thể hơn."
];

export const REJECT_REASON_TEMPLATES = {
    default: [
        "Đơn chưa đáp ứng điều kiện theo quy định hiện hành, vui lòng bổ sung thông tin.",
        ...COMMON_REASONS
    ],
    leave: [
        "Khoảng nghỉ chưa có người bàn giao công việc, vui lòng sắp xếp lại trước khi gửi.",
        "Số ngày nghỉ vượt quá hạn mức hiện có, vui lòng điều chỉnh hoặc liên hệ nhân sự.",
        "Lý do nghỉ chưa rõ, vui lòng ghi cụ thể thời gian và công việc cần bàn giao.",
        ...COMMON_REASONS
    ],
    resignation: [
        "Vui lòng bàn giao đầy đủ công việc và thiết bị trước khi gửi đơn nghỉ việc.",
        "Thời điểm nghỉ việc chưa phù hợp với kế hoạch nhân sự, vui lòng trao đổi lại với quản lý.",
        ...COMMON_REASONS
    ],
    explanation: [
        "Giải trình chưa nêu rõ nguyên nhân và thời gian phát sinh, vui lòng bổ sung.",
        "Chưa có minh chứng phù hợp cho nội dung giải trình, vui lòng cung cấp thêm.",
        ...COMMON_REASONS
    ],
    late_explanation: [
        "Lý do đi muộn chưa rõ, vui lòng nêu cụ thể nguyên nhân và khung giờ thực tế.",
        "Đi muộn lần này chưa có xác nhận từ quản lý trực tiếp, vui lòng bổ sung.",
        ...COMMON_REASONS
    ],
    early_leave_explanation: [
        "Lý do về sớm chưa rõ, vui lòng nêu cụ thể nguyên nhân và thời gian rời làm.",
        "Việc về sớm chưa có xác nhận từ quản lý trực tiếp, vui lòng bổ sung.",
        ...COMMON_REASONS
    ],
    business_trip: [
        "Lịch công tác bị trùng với ca làm việc đã phân, vui lòng điều chỉnh thời gian.",
        "Nội dung công tác chưa rõ địa điểm và mục đích, vui lòng bổ sung.",
        ...COMMON_REASONS
    ],
    overtime: [
        "Khung giờ tăng ca chưa khớp với kế hoạch phân ca, vui lòng kiểm tra lại.",
        "Khối lượng công việc chưa đủ căn cứ để phê duyệt tăng ca, vui lòng bổ sung.",
        ...COMMON_REASONS
    ]
};

/** Chọn nhóm lý do gợi ý theo loại đơn/category của một bản ghi. */
export const getRejectReasonTemplates = (request = {}) => {
    const type = request.type || request.request_type || "";
    const category = request.category || "";
    if (type === "explanation" && category === "late") return REJECT_REASON_TEMPLATES.late_explanation;
    if (type === "explanation" && category === "early_leave") return REJECT_REASON_TEMPLATES.early_leave_explanation;
    if (type === "explanation") return REJECT_REASON_TEMPLATES.explanation;
    if (type === "resignation") return REJECT_REASON_TEMPLATES.resignation;
    return REJECT_REASON_TEMPLATES[type] || REJECT_REASON_TEMPLATES.default;
};
