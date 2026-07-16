import { createHash, randomUUID } from "node:crypto";

export type EventType =
  | "chat"
  | "gift"
  | "like"
  | "enter"
  | "follow"
  | "share"
  | "social"
  | "fansclub"
  | "emoji_chat"
  | "room_stats"
  | "audience"
  | "control";

export interface EventMetrics {
  count?: number;
  total?: number;
  online?: number;
  totalUsers?: number;
  totalLikes?: number;
  giftId?: string;
  giftName?: string;
  giftCount?: number;
  diamondCount?: number;
  userLevel?: number;
  action?: number;
}

export interface StandardEvent {
  eventId: string;
  platformMessageId: string;
  eventType: EventType;
  eventTime: Date;
  receivedAt: Date;
  userIdHash: string | null;
  nickname: string | null;
  content: string | null;
  metrics: EventMetrics;
  rawMethod: string;
  collectorVersion: string;
  payload: unknown;
}

type JsonRecord = Record<string, unknown>;

interface SidecarMessage extends JsonRecord {
  id?: string;
  method?: string;
  content?: string;
  user?: JsonRecord;
  timestamp?: number | string;
  common?: JsonRecord;
}

const METHOD_TYPES: Record<string, EventType> = {
  WebcastChatMessage: "chat",
  WebcastGiftMessage: "gift",
  WebcastLikeMessage: "like",
  WebcastMemberMessage: "enter",
  WebcastSocialMessage: "social",
  WebcastFansclubMessage: "fansclub",
  WebcastEmojiChatMessage: "emoji_chat",
  WebcastRoomStatsMessage: "room_stats",
  WebcastRoomUserSeqMessage: "audience",
  WebcastControlMessage: "control"
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nested(record: JsonRecord | undefined, ...path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function hashUserId(userId: string | undefined, salt: string): string | null {
  if (!userId) return null;
  return createHash("sha256").update(salt).update(userId).digest("hex");
}

function asMessageArray(payload: unknown): SidecarMessage[] {
  if (Array.isArray(payload)) return payload.filter(isRecord) as SidecarMessage[];
  if (!isRecord(payload)) return [];
  for (const key of ["messages", "data", "message"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord) as SidecarMessage[];
  }
  return [payload as SidecarMessage];
}

function parseEventTime(value: unknown, fallback: Date): Date {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function userIdentity(message: SidecarMessage): { id?: string; nickname?: string; level?: number } {
  const user = isRecord(message.user) ? message.user : undefined;
  return {
    id: firstString(user?.secUid, user?.idStr, user?.id, user?.shortId),
    nickname: firstString(user?.nickname, user?.name),
    level: firstNumber(nested(user, "payGrade", "level"), nested(user, "fansClub", "data", "level"))
  };
}

function classifySocial(message: SidecarMessage): EventType {
  const action = firstNumber(message.action);
  if (action === 1 || message.followCount !== undefined) return "follow";
  if (action === 3 || message.shareTarget !== undefined) return "share";
  return "social";
}

function extractMetrics(message: SidecarMessage, eventType: EventType): EventMetrics {
  const gift = isRecord(message.gift) ? message.gift : undefined;
  const metrics: EventMetrics = {
    count: firstNumber(message.count, message.repeatCount, message.comboCount),
    total: firstNumber(message.total, message.totalCount),
    online: firstNumber(message.online, message.userCount, message.memberCount, message.total),
    totalUsers: firstNumber(message.totalUser, message.totalUserCount, message.totalPvForAnchor),
    totalLikes: firstNumber(message.likeCount, message.totalLikeCount),
    userLevel: userIdentity(message).level,
    action: firstNumber(message.action)
  };
  if (eventType === "gift") {
    metrics.giftId = firstString(message.giftId, gift?.id, gift?.giftId);
    metrics.giftName = firstString(message.giftName, gift?.name, gift?.describe);
    metrics.giftCount = firstNumber(message.comboCount, message.repeatCount, message.count, 1);
    metrics.diamondCount = firstNumber(message.diamondCount, gift?.diamondCount);
  }
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined)) as EventMetrics;
}

function describe(eventType: EventType, message: SidecarMessage, metrics: EventMetrics): string | null {
  if (eventType === "chat" || eventType === "emoji_chat") return firstString(message.content) ?? null;
  if (eventType === "gift") return `${metrics.giftName ?? "礼物"} ×${metrics.giftCount ?? 1}`;
  if (eventType === "like") return `点赞 ×${metrics.count ?? 1}`;
  if (eventType === "enter") return "进入直播间";
  if (eventType === "follow") return "关注了主播";
  if (eventType === "share") return "分享了直播间";
  if (eventType === "fansclub") return firstString(message.content) ?? "粉丝团互动";
  if (eventType === "control") return firstString(message.content, message.action) ?? "直播状态变化";
  return null;
}

export function normalizeSidecarPayload(
  payload: unknown,
  collectorVersion: string,
  userHashSalt: string,
  receivedAt = new Date()
): StandardEvent[] {
  return asMessageArray(payload).flatMap((message) => {
    const rawMethod = firstString(message.method);
    if (!rawMethod || !(rawMethod in METHOD_TYPES)) return [];
    let eventType = METHOD_TYPES[rawMethod]!;
    if (eventType === "social") eventType = classifySocial(message);
    const common = isRecord(message.common) ? message.common : undefined;
    const user = userIdentity(message);
    const metrics = extractMetrics(message, eventType);
    return [{
      eventId: randomUUID(),
      platformMessageId: firstString(message.id, common?.msgId) ?? randomUUID(),
      eventType,
      eventTime: parseEventTime(message.timestamp ?? common?.createTime, receivedAt),
      receivedAt,
      userIdHash: hashUserId(user.id, userHashSalt),
      nickname: user.nickname ?? null,
      content: describe(eventType, message, metrics),
      metrics,
      rawMethod,
      collectorVersion,
      payload: message
    }];
  });
}
