import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { StandardEvent } from "../domain/events.js";

interface IdRow extends RowDataPacket {
  id: number;
}

export interface SessionContext {
  sessionId: string;
  roomDbId: number;
}

export interface DashboardSnapshot {
  session: Record<string, unknown> | null;
  counts: Record<string, number>;
  uniqueUsers: number;
  reconnects: number;
  online: number;
  trend: Array<{ minute: string; chat: number; enter: number; like: number; gift: number }>;
  recentEvents: Array<Record<string, unknown>>;
  topChatters: Array<{ nickname: string; count: number; level: number }>;
}

export interface SessionExport {
  sessionId: string;
  roomId: string;
  rows: Array<Record<string, unknown>>;
}

export interface LevelDashboardSummary {
  minLevel: number;
  counts: Record<string, number>;
  uniqueUsers: number;
  recentEvents: Array<Record<string, unknown>>;
  topChatters: Array<{ nickname: string; count: number; level: number }>;
}

export class MonitoringRepository {
  constructor(private readonly pool: Pool) {}

  async getOrCreateRoom(platformRoomId: string, roomUrl: string | null): Promise<number> {
    await this.pool.execute(
      `INSERT INTO live_rooms (platform_room_id, room_url)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE room_url = COALESCE(VALUES(room_url), room_url)`,
      [platformRoomId, roomUrl]
    );
    const [rows] = await this.pool.execute<IdRow[]>(
      "SELECT id FROM live_rooms WHERE platform_room_id = ?",
      [platformRoomId]
    );
    const room = rows[0];
    if (!room) throw new Error("创建直播间记录失败");
    return room.id;
  }

  async updateRoomStatus(
    roomDbId: number,
    status: string,
    liveName?: string,
    title?: string
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE live_rooms
       SET status = ?, anchor_nickname = COALESCE(?, anchor_nickname), title = COALESCE(?, title)
       WHERE id = ?`,
      [status, liveName ?? null, title ?? null, roomDbId]
    );
  }

  async startSession(roomDbId: number, collectorVersion: string): Promise<SessionContext> {
    const sessionId = randomUUID();
    await this.pool.execute(
      `INSERT INTO monitoring_sessions
       (id, room_id, status, started_at, collector_version, integrity_status)
       VALUES (?, ?, 'connecting', UTC_TIMESTAMP(3), ?, 'unknown')`,
      [sessionId, roomDbId, collectorVersion]
    );
    return { sessionId, roomDbId };
  }

  async finishSession(
    sessionId: string,
    status: "completed" | "failed",
    stopReason: string,
    lastError: string | null = null
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE monitoring_sessions
       SET status = ?, ended_at = UTC_TIMESTAMP(3), stop_reason = ?,
           integrity_status = ?, last_error = ?
       WHERE id = ?`,
      [status, stopReason, status === "completed" ? "partial" : "interrupted", lastError, sessionId]
    );
  }

  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    await this.pool.execute("UPDATE monitoring_sessions SET status = ? WHERE id = ?", [status, sessionId]);
  }

  async openConnectionInterval(sessionId: string, status: string, attempt = 0): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO connection_intervals (session_id, status, started_at, reconnect_attempt)
       VALUES (?, ?, UTC_TIMESTAMP(3), ?)`,
      [sessionId, status, attempt]
    );
    return result.insertId;
  }

  async closeConnectionInterval(id: number, code: number | null, reason: string | null): Promise<void> {
    await this.pool.execute(
      `UPDATE connection_intervals
       SET ended_at = UTC_TIMESTAMP(3), close_code = ?, reason = ?
       WHERE id = ? AND ended_at IS NULL`,
      [code, reason, id]
    );
  }

  async saveEvents(context: SessionContext, events: StandardEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    const columnsPerRow = 15;
    const placeholders = events.map(() => `(${new Array(columnsPerRow).fill("?").join(",")})`).join(",");
    const values = events.flatMap((event) => [
      event.eventId,
      event.platformMessageId,
      context.sessionId,
      context.roomDbId,
      event.eventType,
      event.eventTime,
      event.receivedAt,
      event.userIdHash,
      event.nickname,
      event.content,
      JSON.stringify(event.metrics),
      event.rawMethod,
      event.collectorVersion,
      JSON.stringify(event.payload),
      new Date()
    ]);

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO interaction_events
         (event_id, platform_message_id, session_id, room_id, event_type, event_time,
          received_at, user_id_hash, nickname, content, metrics_json, raw_method, collector_version,
          payload_json, created_at)
         VALUES ${placeholders}`,
        values
      );
      if (result.affectedRows > 0) {
        await connection.execute(
          "UPDATE monitoring_sessions SET event_count = event_count + ? WHERE id = ?",
          [result.affectedRows, context.sessionId]
        );
      }
      await connection.commit();
      return result.affectedRows;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async lastSessionSummary(): Promise<RowDataPacket | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.id, r.platform_room_id, s.status, s.started_at, s.ended_at, s.event_count,
              s.stop_reason, s.integrity_status
       FROM monitoring_sessions s
       JOIN live_rooms r ON r.id = s.room_id
       ORDER BY s.started_at DESC
       LIMIT 1`
    );
    return rows[0] ?? null;
  }

  async dashboardSnapshot(): Promise<DashboardSnapshot> {
    const [sessions] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.id, r.platform_room_id AS roomId, r.anchor_nickname AS anchorName,
              r.title, r.status AS roomStatus, s.status, s.started_at AS startedAt,
              s.ended_at AS endedAt, s.event_count AS eventCount
       FROM monitoring_sessions s
       JOIN live_rooms r ON r.id = s.room_id
       WHERE s.event_count > 0
       ORDER BY s.started_at DESC LIMIT 1`
    );
    const session = sessions[0];
    if (!session) {
      return { session: null, counts: {}, uniqueUsers: 0, reconnects: 0, online: 0, trend: [], recentEvents: [], topChatters: [] };
    }
    const sessionId = String(session.id);
    const [[countRows], [userRows], [connectionRows], [metricRows], [trendRows], [recentRows], [topRows]] = await Promise.all([
      this.pool.execute<RowDataPacket[]>(
        `SELECT event_type AS eventType,
                SUM(CASE WHEN event_type = 'like'
                    THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.count')) AS UNSIGNED), 1)
                    ELSE 1 END) AS count
         FROM interaction_events WHERE session_id = ? GROUP BY event_type`,
        [sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        "SELECT COUNT(DISTINCT user_id_hash) AS count FROM interaction_events WHERE session_id = ? AND user_id_hash IS NOT NULL",
        [sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        "SELECT GREATEST(COUNT(*) - 2, 0) AS count FROM connection_intervals WHERE session_id = ?",
        [sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.online')) AS UNSIGNED), 0) AS online
         FROM interaction_events WHERE session_id = ? AND event_type IN ('room_stats', 'audience')
         ORDER BY received_at DESC LIMIT 1`,
        [sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(received_at, '%Y-%m-%dT%H:%i:00Z') AS minute,
                SUM(event_type = 'chat') AS chat, SUM(event_type = 'enter') AS enter,
                SUM(event_type = 'like') AS likeCount, SUM(event_type = 'gift') AS gift
         FROM interaction_events WHERE session_id = ? AND received_at >=
           (SELECT MAX(received_at) FROM interaction_events WHERE session_id = ?) - INTERVAL 20 MINUTE
         GROUP BY DATE_FORMAT(received_at, '%Y-%m-%dT%H:%i:00Z') ORDER BY minute`,
        [sessionId, sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT event_id AS eventId, event_type AS eventType, received_at AS receivedAt,
                user_id_hash AS userIdHash, nickname, content, metrics_json AS metrics
         FROM interaction_events WHERE session_id = ? ORDER BY received_at DESC LIMIT 1000`,
        [sessionId]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(nickname, ''), '匿名用户') AS nickname, COUNT(*) AS count,
                MAX(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.userLevel')) AS UNSIGNED), 0)) AS level
         FROM interaction_events WHERE session_id = ? AND event_type = 'chat'
         GROUP BY user_id_hash, nickname ORDER BY count DESC LIMIT 8`,
        [sessionId]
      )
    ]);
    return {
      session: { ...session },
      counts: Object.fromEntries(countRows.map((row) => [String(row.eventType), Number(row.count)])),
      uniqueUsers: Number(userRows[0]?.count ?? 0),
      reconnects: Number(connectionRows[0]?.count ?? 0),
      online: Number(metricRows[0]?.online ?? 0),
      trend: trendRows.map((row) => ({
        minute: String(row.minute), chat: Number(row.chat), enter: Number(row.enter),
        like: Number(row.likeCount), gift: Number(row.gift)
      })),
      recentEvents: recentRows.map((row) => ({ ...row })),
      topChatters: topRows.map((row) => ({ nickname: String(row.nickname), count: Number(row.count), level: Number(row.level ?? 0) }))
    };
  }

  async latestSessionExport(): Promise<SessionExport | null> {
    const [sessions] = await this.pool.query<RowDataPacket[]>(
      `SELECT s.id, r.platform_room_id AS roomId
       FROM monitoring_sessions s
       JOIN live_rooms r ON r.id = s.room_id
       ORDER BY s.started_at DESC LIMIT 1`
    );
    const session = sessions[0];
    if (!session) return null;
    const sessionId = String(session.id);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT event_id AS eventId, platform_message_id AS platformMessageId,
              event_type AS eventType, event_time AS eventTime, received_at AS receivedAt,
              user_id_hash AS userIdHash, nickname, content, metrics_json AS metrics,
              raw_method AS rawMethod, collector_version AS collectorVersion
       FROM interaction_events WHERE session_id = ? ORDER BY received_at, id`,
      [sessionId]
    );
    return { sessionId, roomId: String(session.roomId), rows: rows.map((row) => ({ ...row })) };
  }

  async dashboardLevelSummary(minLevel: number): Promise<LevelDashboardSummary> {
    const normalizedLevel = Math.max(0, Math.min(60, Math.floor(minLevel)));
    const [sessions] = await this.pool.query<RowDataPacket[]>(
      "SELECT id FROM monitoring_sessions ORDER BY started_at DESC LIMIT 1"
    );
    const sessionId = sessions[0]?.id ? String(sessions[0].id) : null;
    if (!sessionId) return { minLevel: normalizedLevel, counts: {}, uniqueUsers: 0, recentEvents: [], topChatters: [] };
    const levelExpression = "COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.userLevel')) AS UNSIGNED), 0)";
    const [[countRows], [userRows], [recentRows], [topRows]] = await Promise.all([
      this.pool.execute<RowDataPacket[]>(
        `SELECT event_type AS eventType,
                SUM(CASE WHEN event_type = 'like'
                    THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.count')) AS UNSIGNED), 1)
                    WHEN event_type = 'gift'
                    THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.giftCount')) AS UNSIGNED), 1)
                    ELSE 1 END) AS count
         FROM interaction_events WHERE session_id = ? AND ${levelExpression} >= ? GROUP BY event_type`,
        [sessionId, normalizedLevel]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT user_id_hash) AS count FROM interaction_events
         WHERE session_id = ? AND user_id_hash IS NOT NULL AND ${levelExpression} >= ?`,
        [sessionId, normalizedLevel]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT event_id AS eventId, event_type AS eventType, received_at AS receivedAt,
                user_id_hash AS userIdHash, nickname, content, metrics_json AS metrics
         FROM interaction_events WHERE session_id = ? AND ${levelExpression} >= ?
         ORDER BY received_at DESC LIMIT 5000`,
        [sessionId, normalizedLevel]
      ),
      this.pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(nickname, ''), '匿名用户') AS nickname, COUNT(*) AS count,
                MAX(${levelExpression}) AS level
         FROM interaction_events WHERE session_id = ? AND event_type = 'chat' AND ${levelExpression} >= ?
         GROUP BY user_id_hash, nickname ORDER BY count DESC LIMIT 10`,
        [sessionId, normalizedLevel]
      )
    ]);
    return {
      minLevel: normalizedLevel,
      counts: Object.fromEntries(countRows.map((row) => [String(row.eventType), Number(row.count)])),
      uniqueUsers: Number(userRows[0]?.count ?? 0),
      recentEvents: recentRows.map((row) => ({ ...row })),
      topChatters: topRows.map((row) => ({ nickname: String(row.nickname), count: Number(row.count), level: Number(row.level ?? 0) }))
    };
  }
}
