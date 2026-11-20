import { db } from "../config/db.js";

export const ONLINE_WINDOW_MINUTES = 5;

export const findAll = async () => {
    const [rows] = await db.execute(
        `SELECT id,
                device_code,
                name,
                location,
                server_url,
                heartbeat_interval_seconds,
                sync_mode,
                auto_sync_enabled,
                sync_interval_minutes,
                device_type,
                DATE_FORMAT(last_seen_at, '%Y-%m-%d %H:%i:%s') AS last_seen_at,
                DATE_FORMAT(last_sync_at, '%Y-%m-%d %H:%i:%s') AS last_sync_at,
                last_sync_count,
                is_active,
                is_sample,
                CASE
                    WHEN is_active = 1
                     AND last_seen_at >= TIMESTAMPADD(SECOND, -GREATEST(${ONLINE_WINDOW_MINUTES} * 60, heartbeat_interval_seconds * 3), NOW(6))
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
        is_online: Boolean(Number(row.is_online)),
        heartbeat_interval_seconds: Number(row.heartbeat_interval_seconds || 60),
        auto_sync_enabled: Boolean(Number(row.auto_sync_enabled)),
        sync_interval_minutes: Number(row.sync_interval_minutes || 5),
        last_sync_count: Number(row.last_sync_count || 0)
    }));
};

export const findStatuses = async () => {
    const [rows] = await db.execute(
        `SELECT id,
                is_active,
                heartbeat_interval_seconds,
                DATE_FORMAT(last_seen_at, '%Y-%m-%d %H:%i:%s') AS last_seen_at,
                CASE
                    WHEN is_active = 1
                     AND last_seen_at >= TIMESTAMPADD(SECOND, -GREATEST(${ONLINE_WINDOW_MINUTES} * 60, heartbeat_interval_seconds * 3), NOW(6))
                    THEN 1
                    ELSE 0
                END AS is_online
           FROM attendance_devices`
    );

    return rows.map((row) => ({
        ...row,
        is_active: Boolean(Number(row.is_active)),
        is_online: Boolean(Number(row.is_online)),
        heartbeat_interval_seconds: Number(row.heartbeat_interval_seconds || 60)
    }));
};

export const create = async (data) => {
    const [result] = await db.execute(
        `INSERT INTO attendance_devices
            (device_code, name, location, server_url, heartbeat_interval_seconds, sync_mode, auto_sync_enabled, sync_interval_minutes, device_type, token_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.device_code,
            data.name,
            data.location || null,
            data.server_url || null,
            data.heartbeat_interval_seconds || 60,
            data.sync_mode || "events",
            data.auto_sync_enabled === undefined ? 1 : (data.auto_sync_enabled ? 1 : 0),
            data.sync_interval_minutes || 5,
            data.device_type,
            data.token_hash
        ]
    );

    return result.insertId;
};

export const update = async (id, data) => {
    const [result] = await db.execute(
        `UPDATE attendance_devices
            SET name = ?, location = ?, server_url = ?, heartbeat_interval_seconds = ?, sync_mode = ?, auto_sync_enabled = ?, sync_interval_minutes = ?, device_type = ?, is_active = ?
          WHERE id = ?`,
        [
            data.name,
            data.location || null,
            data.server_url || null,
            data.heartbeat_interval_seconds,
            data.sync_mode,
            data.auto_sync_enabled ? 1 : 0,
            data.sync_interval_minutes,
            data.device_type,
            data.is_active ? 1 : 0,
            id
        ]
    );

    return result.affectedRows > 0;
};

export const existsById = async (id) => {
    const [rows] = await db.execute(
        "SELECT id FROM attendance_devices WHERE id = ? LIMIT 1",
        [id]
    );

    return rows.length > 0;
};

export const removeById = async (id) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        await connection.execute(
            "DELETE FROM attendance_device_events WHERE device_id = ?",
            [id]
        );
        const [result] = await connection.execute(
            "DELETE FROM attendance_devices WHERE id = ?",
            [id]
        );
        await connection.commit();

        return result.affectedRows > 0;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const findByCode = async (deviceCode) => {
    const [rows] = await db.execute(
        `SELECT id,
                device_code,
                token_hash,
                is_active,
                server_url,
                heartbeat_interval_seconds,
                sync_mode,
                auto_sync_enabled,
                sync_interval_minutes
           FROM attendance_devices
          WHERE device_code = ?
          LIMIT 1`,
        [deviceCode]
    );

    if (!rows[0]) return null;

    return {
        ...rows[0],
        is_active: Boolean(Number(rows[0].is_active)),
        heartbeat_interval_seconds: Number(rows[0].heartbeat_interval_seconds || 60),
        auto_sync_enabled: Boolean(Number(rows[0].auto_sync_enabled)),
        sync_interval_minutes: Number(rows[0].sync_interval_minutes || 5)
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
