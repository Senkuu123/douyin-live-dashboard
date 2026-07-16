import { randomUUID } from "node:crypto";
import { loadConfig, loadLocalEnvironment } from "../src/config/app-config.js";
import type { StandardEvent } from "../src/domain/events.js";
import { createPool, createProjectDatabase, migrate } from "../src/storage/database.js";
import { MonitoringRepository } from "../src/storage/monitoring-repository.js";

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = loadConfig();
  await createProjectDatabase(config.database);
  const pool = createPool(config.database);
  const roomKey = `smoke-${Date.now()}`;
  let roomDbId: number | null = null;
  let sessionId: string | null = null;

  try {
    await migrate(pool);
    const repository = new MonitoringRepository(pool);
    roomDbId = await repository.getOrCreateRoom(roomKey, null);
    const context = await repository.startSession(roomDbId, "smoke-test");
    sessionId = context.sessionId;
    const now = new Date();
    const event: StandardEvent = {
      eventId: randomUUID(),
      platformMessageId: "duplicate-check",
      eventType: "chat",
      eventTime: now,
      receivedAt: now,
      userIdHash: null,
      nickname: "smoke",
      content: "database smoke test",
      metrics: {},
      rawMethod: "WebcastChatMessage",
      collectorVersion: "smoke-test",
      payload: { smoke: true }
    };

    const first = await repository.saveEvents(context, [event]);
    const duplicate = await repository.saveEvents(context, [{ ...event, eventId: randomUUID() }]);
    await repository.finishSession(context.sessionId, "completed", "smoke_test");
    if (first !== 1 || duplicate !== 0) {
      throw new Error(`dedup verification failed: first=${first}, duplicate=${duplicate}`);
    }
    process.stdout.write("database_smoke=passed\n");

  } finally {
    if (sessionId) {
      await pool.execute("DELETE FROM interaction_events WHERE session_id = ?", [sessionId]).catch(() => undefined);
      await pool.execute("DELETE FROM connection_intervals WHERE session_id = ?", [sessionId]).catch(() => undefined);
      await pool.execute("DELETE FROM monitoring_sessions WHERE id = ?", [sessionId]).catch(() => undefined);
    }
    if (roomDbId) await pool.execute("DELETE FROM live_rooms WHERE id = ?", [roomDbId]).catch(() => undefined);
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`database_smoke=failed ${message}\n`);
  process.exitCode = 1;
});
