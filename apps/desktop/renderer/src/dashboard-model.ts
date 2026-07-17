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
  { key: "coupon", label: "优惠活动", severity: "高" as const, pattern: /(优惠券|领券|券在哪|满减|折扣|活动价|福利|秒杀|赠券)/i },
  { key: "price", label: "价格咨询", severity: "高" as const, pattern: /(多少钱|什么价|价格|到手价|便宜|最低价|贵不贵|拍下价)/i },
  { key: "link", label: "商品链接", severity: "高" as const, pattern: /(链接|几号链接|几号车|小黄车|购物车|哪里买|怎么买|怎么拍)/i },
  { key: "stock", label: "库存尺码", severity: "中" as const, pattern: /(库存|有货|没货|补货|尺码|多大码|颜色|色号|型号)/i },
  { key: "shipping", label: "物流发货", severity: "中" as const, pattern: /(发货|物流|快递|包邮|运费|多久到|几天到|什么时候到)/i },
  { key: "after-sale", label: "售后退款", severity: "高" as const, pattern: /(退款|退货|换货|售后|保修|运费险|七天无理由)/i },
  { key: "quality", label: "商品质量", severity: "高" as const, pattern: /(质量|正品|真假|保质期|生产日期|过期|材质|成分)/i },
  { key: "usage", label: "使用方法", severity: "中" as const, pattern: /(怎么用|如何用|用法|使用方法|怎么安装|怎么洗|适合.*用)/i },
  { key: "spec", label: "规格参数", severity: "中" as const, pattern: /(多少克|多少毫升|多大|尺寸|规格|参数|容量|几件|几片)/i },
  { key: "gift", label: "赠品权益", severity: "中" as const, pattern: /(赠品|送什么|有没有送|礼盒|权益|会员)/i },
  { key: "experience", label: "直播体验", severity: "中" as const, pattern: /(听不见|没声音|卡顿|看不清|画面|声音|主播说慢点)/i }
];

const questionPattern = /[?？]|(吗|呢|么|嘛|不|没有|多少|怎么|如何|哪里|哪款|哪个|什么时候|多久|能否|可不可以|是不是|有没有)/i;

function issueRule(content: string) {
  return issueRules.find((rule) => rule.pattern.test(content)) ??
    (questionPattern.test(content) ? { key: "other", label: "其他问题", severity: "中" as const, pattern: questionPattern } : null);
}

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
  const groups = new Map<string, { rule: NonNullable<ReturnType<typeof issueRule>>; events: LiveEvent[] }>();
  for (const event of events) {
    if (event.eventType !== "chat" || !event.content?.trim()) continue;
    const content = event.content.trim();
    const rule = issueRule(content);
    if (!rule) continue;
    const key = `${rule.key}:${content.toLocaleLowerCase()}`;
    const group = groups.get(key) ?? { rule, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const latest = [...group.events].sort((a, b) => timestamp(b.receivedAt) - timestamp(a.receivedAt))[0]!;
    return {
      key,
      title: latest.content!.trim(),
      label: group.rule.label,
      severity: group.rule.severity,
      count: group.events.length,
      latestAt: latest.receivedAt,
      latestUser: latest.nickname ?? "匿名用户",
      latestContent: latest.content ?? ""
    };
  }).sort((a, b) => timestamp(b.latestAt) - timestamp(a.latestAt));
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
