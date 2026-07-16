import type { LiveEvent } from "../../contracts.js";

export type EventFilter = "all" | "gift" | "enter" | "like" | "follow";
export type RateKey = "enter" | "chat" | "like" | "gift";

export interface DashboardRates {
  enter: number;
  chat: number;
  like: number;
  gift: number;
  unique: number;
}

export interface OnlinePoint {
  minute: string;
  online: number;
  chat: number;
  enter: number;
  like: number;
  gift: number;
}

export interface IssueGroup {
  key: string;
  title: string;
  label: string;
  severity: "高" | "中";
  count: number;
  latestAt: string;
  latestUser: string;
  latestContent: string;
}

export const HIGH_VALUE_DIAMONDS = 100;
export const HIGH_LEVEL_THRESHOLD = 20;

const issueRules = [
  { key: "price", title: "多少钱", label: "价格咨询", severity: "高" as const, pattern: /(多少钱|价格|便宜|优惠|券)/i },
  { key: "link", title: "链接在哪", label: "链接问题", severity: "中" as const, pattern: /(链接|哪里买|怎么买|购物车)/i },
  { key: "audio", title: "听不见", label: "体验问题", severity: "中" as const, pattern: /(听不见|没声音|卡顿|看不清)/i },
  { key: "shipping", title: "发货多久", label: "物流咨询", severity: "中" as const, pattern: /(发货|物流|多久到|几天到)/i }
];

export const negativePattern = /(发货慢|退款|骗人|假货|垃圾|差评|不靠谱|太贵了|质量差)/i;

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventCount(event: LiveEvent): number {
  if (event.eventType === "like") return Math.max(1, Number(event.metrics.count ?? 1));
  if (event.eventType === "gift") return Math.max(1, Number(event.metrics.giftCount ?? 1));
  return 1;
}

export function calculateRates(events: LiveEvent[], now = Date.now(), windowMs = 60_000): DashboardRates {
  const recent = events.filter((event) => {
    const received = timestamp(event.receivedAt);
    return received > 0 && received <= now && received >= now - windowMs;
  });
  const result: DashboardRates = { enter: 0, chat: 0, like: 0, gift: 0, unique: 0 };
  const users = new Set<string>();
  for (const event of recent) {
    if (["enter", "chat", "like", "gift"].includes(event.eventType)) {
      result[event.eventType as RateKey] += eventCount(event);
    }
    if (event.userIdHash) users.add(event.userIdHash);
  }
  result.unique = users.size;
  return result;
}

export function highValueGifts(events: LiveEvent[]): LiveEvent[] {
  return events.filter((event) => event.eventType === "gift" &&
    Number(event.metrics.diamondCount ?? 0) * Number(event.metrics.giftCount ?? 1) >= HIGH_VALUE_DIAMONDS);
}

export function highLevelEntries(events: LiveEvent[]): LiveEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (event.eventType !== "enter" || Number(event.metrics.userLevel ?? 0) < HIGH_LEVEL_THRESHOLD) return false;
    const identity = event.userIdHash ?? event.nickname ?? event.eventId;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function negativeEvents(events: LiveEvent[]): LiveEvent[] {
  return events.filter((event) => event.eventType === "chat" && negativePattern.test(event.content ?? ""));
}

export function groupIssues(events: LiveEvent[]): IssueGroup[] {
  const chats = events.filter((event) => event.eventType === "chat" && event.content);
  return issueRules.flatMap((rule) => {
    const matches = chats.filter((event) => rule.pattern.test(event.content ?? ""));
    if (!matches.length) return [];
    const latest = [...matches].sort((a, b) => timestamp(b.receivedAt) - timestamp(a.receivedAt))[0]!;
    return [{
      key: rule.key,
      title: rule.title,
      label: rule.label,
      severity: rule.severity,
      count: matches.length,
      latestAt: latest.receivedAt,
      latestUser: latest.nickname ?? "匿名用户",
      latestContent: latest.content ?? ""
    }];
  }).sort((a, b) => b.count - a.count);
}

export function buildOnlineTrend(events: LiveEvent[], now = Date.now(), minutes = 20): OnlinePoint[] {
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() - minutes + 1);
  const points: OnlinePoint[] = Array.from({ length: minutes }, (_, index) => {
    const minute = new Date(start.getTime() + index * 60_000).toISOString();
    return { minute, online: 0, chat: 0, enter: 0, like: 0, gift: 0 };
  });
  const indexByMinute = new Map(points.map((point, index) => [point.minute, index]));
  const sorted = [...events].sort((a, b) => timestamp(a.receivedAt) - timestamp(b.receivedAt));
  let carriedOnline = 0;
  for (const event of sorted) {
    const date = new Date(event.receivedAt);
    if (Number.isNaN(date.getTime())) continue;
    date.setSeconds(0, 0);
    const index = indexByMinute.get(date.toISOString());
    if (index === undefined) continue;
    const point = points[index]!;
    if (event.eventType === "chat") point.chat += 1;
    if (event.eventType === "enter") point.enter += 1;
    if (event.eventType === "like") point.like += eventCount(event);
    if (event.eventType === "gift") point.gift += eventCount(event);
    if ((event.eventType === "audience" || event.eventType === "room_stats") && Number.isFinite(Number(event.metrics.online))) {
      carriedOnline = Math.max(0, Number(event.metrics.online));
      point.online = carriedOnline;
    }
  }
  for (const point of points) {
    if (point.online > 0) carriedOnline = point.online;
    else point.online = carriedOnline;
  }
  return points;
}

export function onlineDelta(points: OnlinePoint[], lookback = 5): number {
  const populated = points.filter((point) => point.online > 0);
  if (!populated.length) return 0;
  const current = populated.at(-1)!.online;
  const reference = populated[Math.max(0, populated.length - lookback - 1)]!.online;
  return current - reference;
}

export function healthScore(input: {
  online: number;
  rates: DashboardRates;
  highValueGiftCount: number;
  highLevelEntryCount: number;
  negativeCount: number;
}): number {
  const positive = 30
    + Math.min(12, input.online > 0 ? 4 + Math.log10(input.online + 1) * 2.5 : 0)
    + Math.min(12, input.rates.enter / 4)
    + Math.min(12, input.rates.chat / 3)
    + Math.min(10, input.rates.like / 50)
    + Math.min(8, input.rates.gift * 2)
    + Math.min(10, input.rates.unique / 3)
    + Math.min(8, input.highValueGiftCount * 4)
    + Math.min(8, input.highLevelEntryCount * 2);
  return Math.round(Math.max(0, Math.min(100, positive - Math.min(20, input.negativeCount * 2))));
}

export function levelTier(level: number | undefined): string {
  const value = Math.max(0, Number(level ?? 0));
  return `lv-${Math.min(50, Math.floor(value / 10) * 10)}`;
}

export function eventMatchesFilter(event: LiveEvent, filter: EventFilter): boolean {
  return filter === "all" || event.eventType === filter;
}
