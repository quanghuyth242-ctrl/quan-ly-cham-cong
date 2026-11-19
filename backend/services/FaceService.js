
const FACE_DISTANCE_THRESHOLD = 0.5;

// Kiểm tra dữ liệu khuôn mặt
export const validateFaceDescriptor = (descriptor) => {
    if (!Array.isArray(descriptor)) {
        return false;
    }

    if (descriptor.length !== 128) {
        return false;
    }

    return descriptor.every(
        value => typeof value === "number" && Number.isFinite(value)
    );
};

// Kiểm tra chất lượng descriptor trước khi lưu vào database.
// Hàm này không thay thế validateFaceDescriptor mà bổ sung các kiểm tra
// nhằm loại bỏ mảng rỗng, mảng hằng số hoặc giá trị bất thường.
export const isFaceDescriptorUsable = (descriptor) => {
    if (!validateFaceDescriptor(descriptor)) {
        return false;
    }

    if (descriptor.every(value => value === 0)) {
        return false;
    }

    if (descriptor.some(value => Math.abs(value) > 10)) {
        return false;
    }

    const uniqueValues = new Set(
        descriptor.map(value => value.toFixed(6))
    );

    return uniqueValues.size >= 16;
};

// Tính khoảng cách giữa hai khuôn mặt
export const calculateFaceDistance = (face1, face2) => {
    if (
        !validateFaceDescriptor(face1) ||
        !validateFaceDescriptor(face2)
    ) {
        throw new Error("Dữ liệu khuôn mặt không hợp lệ");
    }

    let sum = 0;

    for (let i = 0; i < 128; i++) {
        sum += Math.pow(face1[i] - face2[i], 2);
    }

    return Math.sqrt(sum);
};

// So sánh hai khuôn mặt
export const compareFaces = (face1, face2) => {
    const distance = calculateFaceDistance(face1, face2);

    return {
        matched: distance <= FACE_DISTANCE_THRESHOLD,
        distance: Number(distance.toFixed(4))
    };
};

// Tìm nhân viên khớp nhất
export const findMatchingEmployee = (inputDescriptor, employees) => {
    if (!validateFaceDescriptor(inputDescriptor)) {
        throw new Error("Dữ liệu khuôn mặt đầu vào không hợp lệ");
    }

    let bestMatch = null;
    let minDistance = Infinity;

    for (const employee of employees) {
        let storedDescriptor = employee.face_embedding;

        if (Buffer.isBuffer(storedDescriptor)) {
            storedDescriptor = storedDescriptor.toString("utf8");
        }

        if (typeof storedDescriptor === "string") {
            try {
                storedDescriptor = JSON.parse(storedDescriptor);
            } catch {
                continue;
            }
        }

        if (!validateFaceDescriptor(storedDescriptor)) {
            continue;
        }

        const distance = calculateFaceDistance(
            inputDescriptor,
            storedDescriptor
        );

        if (distance < minDistance) {
            minDistance = distance;
            bestMatch = employee;
        }
    }

    if (
        !bestMatch ||
        minDistance > FACE_DISTANCE_THRESHOLD
    ) {
        return {
            matched: false,
            employee: null,
            distance: null
        };
    }

    return {
        matched: true,
        employee: bestMatch,
        distance: Number(minDistance.toFixed(4))
    };
};
