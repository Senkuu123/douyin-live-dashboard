import type { DashboardSnapshot, LevelDashboardSummary } from "../../src/storage/monitoring-repository.js";
import type { EventMetrics, EventType } from "../../src/domain/events.js";

export interface LiveEvent {
  eventId: string;
  eventType: EventType;
  receivedAt: string;
  userIdHash: string | null;
  nickname: string | null;
  content: string | null;
  metrics: EventMetrics;
}

export interface MonitorStatus {
  phase: string;
  roomId?: string;
  message?: string;
  title?: string;
  anchorName?: string;
}

export interface DesktopApi {
  snapshot(): Promise<DashboardSnapshot>;
  levelSummary(minLevel: number): Promise<LevelDashboardSummary>;
  start(input: string): Promise<{ roomId: string }>;
  stop(): Promise<void>;
  readClipboard(): Promise<string>;
  exportCsv(): Promise<{ canceled: boolean; filePath?: string; rowCount?: number }>;
  onEvent(callback: (event: LiveEvent) => void): () => void;
  onStatus(callback: (status: MonitorStatus) => void): () => void;
}
