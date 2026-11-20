import { db } from "../config/db.js";

const SETTINGS_ID = 1;
const MIN_RADIUS_METERS = 20;
const MAX_RADIUS_METERS = 5000;
const MAX_LOCATION_ACCURACY_METERS = 150;

const mapSettings = (row) => row ? {
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    radius_m: Number(row.radius_m),
    configured: row.latitude !== null && row.longitude !== null
} : {
    latitude: null,
    longitude: null,
    radius_m: 100,
    configured: false
};

const isCoordinate = (value, min, max) => (
    Number.isFinite(value) && value >= min && value <= max
);

export class AttendanceGpsError extends Error {
    constructor(message, statusCode = 400, code = "GPS_ATTENDANCE_ERROR") {
        super(message);
        this.name = "AttendanceGpsError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

export const getSettings = async () => {
    const [rows] = await db.execute(
        `SELECT latitude, longitude, radius_m
           FROM attendance_gps_settings
          WHERE id = ?
          LIMIT 1`,
        [SETTINGS_ID]
    );

    return mapSettings(rows[0]);
};

export const saveSettings = async ({ latitude, longitude, radiusMeters, updatedBy }) => {
    if (!isCoordinate(latitude, -90, 90) || !isCoordinate(longitude, -180, 180)) {
        throw new AttendanceGpsError("Tọa độ cơ sở không hợp lệ.", 400, "INVALID_GPS_SETTINGS");
    }

    if (
        !Number.isInteger(radiusMeters)
        || radiusMeters < MIN_RADIUS_METERS
        || radiusMeters > MAX_RADIUS_METERS
    ) {
        throw new AttendanceGpsError(
            `Bán kính cho phép từ ${MIN_RADIUS_METERS} đến ${MAX_RADIUS_METERS} mét.`,
            400,
            "INVALID_GPS_RADIUS"
        );
    }

    await db.execute(
        `INSERT INTO attendance_gps_settings
            (id, latitude, longitude, radius_m, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            radius_m = VALUES(radius_m),
            updated_by = VALUES(updated_by)`,
        [SETTINGS_ID, latitude, longitude, radiusMeters, updatedBy || null]
    );

    return getSettings();
};

const distanceBetweenMeters = (latitudeA, longitudeA, latitudeB, longitudeB) => {
    const earthRadiusMeters = 6371000;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(latitudeB - latitudeA);
    const longitudeDelta = toRadians(longitudeB - longitudeA);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(toRadians(latitudeA))
        * Math.cos(toRadians(latitudeB))
        * Math.sin(longitudeDelta / 2) ** 2;

    return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
};

export const validateLocation = async ({ latitude, longitude, accuracy }) => {
    if (
        !isCoordinate(latitude, -90, 90)
        || !isCoordinate(longitude, -180, 180)
        || !Number.isFinite(accuracy)
        || accuracy < 0
    ) {
        throw new AttendanceGpsError(
            "Vị trí GPS không hợp lệ. Vui lòng cho phép định vị và thử lại.",
            400,
            "INVALID_GPS_LOCATION"
        );
    }

    if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
        throw new AttendanceGpsError(
            `GPS hiện chưa đủ chính xác (±${Math.round(accuracy)} m). Hãy bật định vị chính xác và thử lại.`,
            422,
            "GPS_ACCURACY_TOO_LOW"
        );
    }

    const settings = await getSettings();

    if (!settings.configured) {
        throw new AttendanceGpsError(
            "Chưa cấu hình vị trí cơ sở. Vui lòng thiết lập GPS trước khi chấm công.",
            409,
            "GPS_NOT_CONFIGURED"
        );
    }

    const distanceMeters = distanceBetweenMeters(
        settings.latitude,
        settings.longitude,
        latitude,
        longitude
    );

    if (distanceMeters > settings.radius_m) {
        throw new AttendanceGpsError(
            `Bạn đang cách cơ sở khoảng ${Math.round(distanceMeters)} m, vượt bán kính ${settings.radius_m} m.`,
            403,
            "OUTSIDE_GEOFENCE"
        );
    }

    return {
        latitude,
        longitude,
        accuracy,
        distance_m: Math.round(distanceMeters),
        radius_m: settings.radius_m
    };
};
