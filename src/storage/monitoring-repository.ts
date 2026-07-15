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
    const columnsPerRow = 14;
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
          received_at, user_id_hash, nickname, content, raw_method, collector_version,
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
}
