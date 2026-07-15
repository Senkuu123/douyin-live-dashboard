import { createHash, randomUUID } from "node:crypto";

export interface StandardEvent {
  eventId: string;
  platformMessageId: string;
  eventType: string;
  eventTime: Date;
  receivedAt: Date;
  userIdHash: string | null;
  nickname: string | null;
  content: string | null;
  rawMethod: string;
  collectorVersion: string;
  payload: unknown;
}

interface SidecarUser {
  id?: string;
  idStr?: string;
  secUid?: string;
  name?: string;
  nickname?: string;
}

interface SidecarMessage {
  id?: string;
  method?: string;
  content?: string;
  user?: SidecarUser;
  timestamp?: number | string;
  common?: {
    msgId?: string;
    createTime?: number | string;
  };
}

function hashUserId(userId: string | undefined, salt: string): string | null {
  if (!userId) return null;
  return createHash("sha256").update(salt).update(userId).digest("hex");
}

function asMessageArray(payload: unknown): SidecarMessage[] {
  if (Array.isArray(payload)) return payload as SidecarMessage[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  for (const key of ["messages", "data", "message"]) {
    const value = record[key];
    if (Array.isArray(value)) return value as SidecarMessage[];
  }
  return [record as SidecarMessage];
}

function parseEventTime(value: number | string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function normalizeSidecarPayload(
  payload: unknown,
  collectorVersion: string,
  userHashSalt: string,
  receivedAt = new Date()
): StandardEvent[] {
  return asMessageArray(payload)
    .filter((message) => message.method === "WebcastChatMessage")
    .map((message) => ({
      eventId: randomUUID(),
      platformMessageId: message.id ?? message.common?.msgId ?? randomUUID(),
      eventType: "chat",
      eventTime: parseEventTime(message.timestamp ?? message.common?.createTime, receivedAt),
      receivedAt,
      userIdHash: hashUserId(
        message.user?.secUid ?? message.user?.idStr ?? message.user?.id,
        userHashSalt
      ),
      nickname: message.user?.name ?? message.user?.nickname ?? null,
      content: message.content ?? null,
      rawMethod: message.method ?? "unknown",
      collectorVersion,
      payload: message
    }));
}
