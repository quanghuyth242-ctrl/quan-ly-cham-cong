import { createHash, randomBytes } from "node:crypto";
import { db } from "../config/db.js";

const sampleDevices = [
    {
        device_code: "SAMPLE-BIO-01",
        name: "Máy chấm công mẫu - Sảnh chính",
        location: "Sảnh chính",
        device_type: "biometric",
        last_seen: "online"
    },
    {
        device_code: "SAMPLE-BIO-02",
        name: "Máy chấm công mẫu - Tầng 2",
        location: "Tầng 2",
        device_type: "biometric",
        last_seen: "online"
    },
    {
        device_code: "SAMPLE-CAM-01",
        name: "Camera mẫu - Cổng",
        location: "Cổng chính",
        device_type: "camera",
        last_seen: "offline"
    },
    {
        device_code: "SAMPLE-NET-01",
        name: "Thiết bị mạng mẫu",
        location: "Phòng kỹ thuật",
        device_type: "network",
        last_seen: null
    }
];

const getLastSeenSql = (lastSeen) => {
    if (lastSeen === "online") return "NOW(6)";
    if (lastSeen === "offline") return "DATE_SUB(NOW(6), INTERVAL 15 MINUTE)";
    return "NULL";
};

const main = async () => {
    let inserted = 0;
    let skipped = 0;

    for (const device of sampleDevices) {
        const [existing] = await db.execute(
            "SELECT id FROM attendance_devices WHERE device_code = ? LIMIT 1",
            [device.device_code]
        );

        if (existing.length > 0) {
            skipped += 1;
            continue;
        }

        const tokenHash = createHash("sha256")
            .update(randomBytes(32))
            .digest("hex");

        await db.execute(
            `INSERT INTO attendance_devices
                (device_code, name, location, device_type, token_hash, last_seen_at, is_active, is_sample)
             VALUES (?, ?, ?, ?, ?, ${getLastSeenSql(device.last_seen)}, 1, 1)`,
            [
                device.device_code,
                device.name,
                device.location,
                device.device_type,
                tokenHash
            ]
        );
        inserted += 1;
    }

    console.log(`Đã thêm ${inserted} thiết bị mẫu; bỏ qua ${skipped} thiết bị đã tồn tại.`);
    await db.end();
};

main().catch(async (error) => {
    console.error("Lỗi thêm thiết bị mẫu:", error.message);
    await db.end();
    process.exit(1);
});
