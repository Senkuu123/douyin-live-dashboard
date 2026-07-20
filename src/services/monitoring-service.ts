import type { Pool } from "mysql2/promise";
import { SidecarClient, type SidecarSystemMessage } from "../collector/sidecar-client.js";
import { SidecarManager } from "../collector/sidecar-manager.js";
import type { AppConfig } from "../config/app-config.js";
import { applyGiftComboDelta, extractSidecarRoomMetadata, normalizeSidecarPayload, type StandardEvent } from "../domain/events.js";
import { MonitoringRepository, type SessionContext } from "../storage/monitoring-repository.js";
import { resolveRoomInput } from "../utils/room-input.js";

const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_SIZE = 50;

export interface MonitoringObserver {
  onEvent?(event: StandardEvent): void;
  onStatus?(status: { phase: string; roomId?: string; message?: string; title?: string; anchorName?: string }): void;
}

export class MonitoringService {
  private readonly repository: MonitoringRepository;
  private readonly sidecar: SidecarManager;

  constructor(private readonly config: AppConfig, pool: Pool) {
    this.repository = new MonitoringRepository(pool);
    this.sidecar = new SidecarManager(config.collector);
  }

  async run(input: string, signal: AbortSignal, observer: MonitoringObserver = {}): Promise<void> {
    const roomId = await resolveRoomInput(input);
    observer.onStatus?.({ phase: "starting", roomId });
    await this.sidecar.ensureRunning();
    const collectorVersion = await this.sidecar.version();
    const roomDbId = await this.repository.getOrCreateRoom(
      roomId,
      input.startsWith("http") ? input : null
    );
    const context = await this.repository.startSession(roomDbId, collectorVersion);
    let intervalId = await this.repository.openConnectionInterval(context.sessionId, "connecting");
    let buffer: StandardEvent[] = [];
    let stopping = false;
    let fatalError: Error | null = null;
    let lastTitle: string | undefined;
    let lastLiveName: string | undefined;
    const giftComboTotals = new Map<string, number>();

    const flush = async () => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      await this.repository.saveEvents(context, batch);
    };
    const flushTimer = setInterval(() => void flush().catch((error) => {
      fatalError = error instanceof Error ? error : new Error(String(error));
    }), FLUSH_INTERVAL_MS);

    const client = new SidecarClient(this.config.collector, roomId, {
      onPayload: (payload) => {
        const metadata = extractSidecarRoomMetadata(payload);
        if ((metadata.title && metadata.title !== lastTitle) || (metadata.liveName && metadata.liveName !== lastLiveName)) {
          lastTitle = metadata.title ?? lastTitle;
          lastLiveName = metadata.liveName ?? lastLiveName;
          void this.repository.updateRoomStatus(roomDbId, "online", lastLiveName, lastTitle).catch((error) => {
            fatalError = error instanceof Error ? error : new Error(String(error));
          });
          observer.onStatus?.({ phase: "collecting", roomId, title: lastTitle, anchorName: lastLiveName });
        }
        const events = normalizeSidecarPayload(
          payload,
          collectorVersion,
          this.config.userHashSalt
        );
        for (const normalizedEvent of events) {
          const event = applyGiftComboDelta(normalizedEvent, giftComboTotals);
          if (event.eventType === "gift" && Number(event.metrics.giftCount ?? 0) <= 0) continue;
          if (event.eventType === "chat") {
            process.stdout.write(
              `[${event.receivedAt.toLocaleTimeString()}] ${event.nickname ?? "匿名"}：${event.content ?? ""}\n`
            );
          }
          observer.onEvent?.(event);
          buffer.push(event);
        }
        if (buffer.length >= FLUSH_BATCH_SIZE) void flush().catch((error) => {
          fatalError = error instanceof Error ? error : new Error(String(error));
        });
      },
      onSystem: (message) => {
        lastTitle = message.title ?? lastTitle;
        lastLiveName = message.live_name ?? lastLiveName;
        observer.onStatus?.({
          phase: message.code === "ROOM_OFFLINE" || message.code === "ROOM_ENDED" ? "waiting" : "collecting",
          roomId,
          message: message.message,
          title: lastTitle,
          anchorName: lastLiveName
        });
        void this.handleSystemMessage(context, roomDbId, message).catch((error) => {
          fatalError = error instanceof Error ? error : new Error(String(error));
        });
      },
      onClose: (code, reason) => {
        if (!stopping) {
          fatalError = new Error(`采集连接关闭，code=${code}，reason=${reason || "unknown"}`);
        }
      }
    });

    try {
      await client.connect();
      await this.repository.closeConnectionInterval(intervalId, null, "connected");
      intervalId = await this.repository.openConnectionInterval(context.sessionId, "connected");
      await this.repository.setSessionStatus(context.sessionId, "collecting");
      observer.onStatus?.({ phase: "collecting", roomId });
      process.stdout.write(`已连接直播间${roomId}，按Ctrl+C停止\n`);

      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        let checkFatal: NodeJS.Timeout;
        const finish = () => {
          clearInterval(checkFatal);
          resolve();
        };
        signal.addEventListener("abort", finish, { once: true });
        checkFatal = setInterval(() => {
          if (fatalError) {
            finish();
          }
        }, 200);
      });

      if (fatalError) throw fatalError;
      stopping = true;
      client.close();
      await flush();
      await this.repository.closeConnectionInterval(intervalId, 1000, "user stop");
      await this.repository.finishSession(context.sessionId, "completed", "user_stop");
      observer.onStatus?.({ phase: "stopped", roomId });
    } catch (error) {
      stopping = true;
      client.close();
      await flush().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.closeConnectionInterval(intervalId, null, message).catch(() => undefined);
      await this.repository.finishSession(context.sessionId, "failed", "collector_error", message);
      observer.onStatus?.({ phase: "failed", roomId, message });
      throw error;
    } finally {
      clearInterval(flushTimer);
      await this.sidecar.stop();
    }
  }

  private async handleSystemMessage(
    context: SessionContext,
    roomDbId: number,
    message: SidecarSystemMessage
  ): Promise<void> {
    const status = message.status ?? message.code ?? "unknown";
    process.stderr.write(`采集状态：${message.message ?? status}\n`);
    await this.repository.updateRoomStatus(roomDbId, status, message.live_name, message.title);
    if (message.code === "ROOM_ONLINE") {
      await this.repository.setSessionStatus(context.sessionId, "collecting");
    } else if (message.code === "ROOM_OFFLINE" || message.code === "ROOM_ENDED") {
      await this.repository.setSessionStatus(context.sessionId, "waiting");
    }
  }
}
