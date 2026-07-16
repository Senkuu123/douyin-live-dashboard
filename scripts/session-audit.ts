import type { RowDataPacket } from "mysql2/promise";
import { loadConfig, loadLocalEnvironment } from "../src/config/app-config.js";
import { createPool } from "../src/storage/database.js";

const roomId = process.argv[2];
if (!roomId || !/^\d+$/.test(roomId)) throw new Error("请提供纯数字直播间号");

loadLocalEnvironment();
const pool = createPool(loadConfig().database);
try {
  const [sessions] = await pool.execute<RowDataPacket[]>(
    `SELECT s.id, s.status, s.event_count AS eventCount,
            TIMESTAMPDIFF(SECOND, s.started_at, s.ended_at) AS durationSeconds
     FROM monitoring_sessions s JOIN live_rooms r ON r.id = s.room_id
     WHERE r.platform_room_id = ? ORDER BY s.started_at DESC LIMIT 1`,
    [roomId]
  );
  const session = sessions[0];
  if (!session) throw new Error("未找到该直播间的采集会话");
  const [types] = await pool.execute<RowDataPacket[]>(
    `SELECT event_type AS eventType, raw_method AS rawMethod, COUNT(*) AS rowsCount,
            SUM(metrics_json IS NOT NULL) AS metricsRows
     FROM interaction_events WHERE session_id = ?
     GROUP BY event_type, raw_method ORDER BY rowsCount DESC`,
    [session.id]
  );
  const [integrity] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS storedCount, COUNT(DISTINCT platform_message_id) AS distinctMessages,
            SUM(user_id_hash IS NULL) AS missingUserHash, SUM(metrics_json IS NULL) AS missingMetrics
     FROM interaction_events WHERE session_id = ?`,
    [session.id]
  );
  const [metricTotals] = await pool.execute<RowDataPacket[]>(
    `SELECT SUM(CASE WHEN event_type = 'like'
                THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.count')) AS UNSIGNED), 0)
                ELSE 0 END) AS likeActions,
            MAX(CASE WHEN event_type IN ('audience', 'room_stats')
                THEN COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics_json, '$.online')) AS UNSIGNED), 0)
                ELSE 0 END) AS peakOnline
     FROM interaction_events WHERE session_id = ?`,
    [session.id]
  );
  process.stdout.write(`${JSON.stringify({
    session: { ...session }, types: types.map((row) => ({ ...row })),
    integrity: { ...integrity[0] }, metricTotals: { ...metricTotals[0] }
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
