import { db } from "../config/db.js";

export const ONLINE_WINDOW_MINUTES = 5;

export const findAll = async () => {
    const [rows] = await db.execute(
        `SELECT id,
                device_code,
                name,
                location,
                device_type,
                DATE_FORMAT(last_seen_at, '%Y-%m-%d %H:%i:%s') AS last_seen_at,
                is_active,
                is_sample,
                CASE
                    WHEN is_active = 1
                     AND last_seen_at >= DATE_SUB(NOW(6), INTERVAL ${ONLINE_WINDOW_MINUTES} MINUTE)
                    THEN 1
                    ELSE 0
                END AS is_online
           FROM attendance_devices
          ORDER BY is_active DESC, name ASC`
    );

    return rows.map((row) => ({
        ...row,
        is_active: Boolean(Number(row.is_active)),
        is_sample: Boolean(Number(row.is_sample)),
        is_online: Boolean(Number(row.is_online))
    }));
};

export const create = async (data) => {
    const [result] = await db.execute(
        `INSERT INTO attendance_devices
            (device_code, name, location, device_type, token_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [data.device_code, data.name, data.location || null, data.device_type, data.token_hash]
    );

    return result.insertId;
};

export const findByCode = async (deviceCode) => {
    const [rows] = await db.execute(
        `SELECT id, token_hash, is_active
           FROM attendance_devices
          WHERE device_code = ?
          LIMIT 1`,
        [deviceCode]
    );

    if (!rows[0]) return null;

    return {
        ...rows[0],
        is_active: Boolean(Number(rows[0].is_active))
    };
};

export const markHeartbeat = async (id) => {
    await db.execute(
        `UPDATE attendance_devices
            SET last_seen_at = NOW(6)
          WHERE id = ? AND is_active = 1`,
        [id]
    );
};
