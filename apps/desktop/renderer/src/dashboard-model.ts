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
  unique: number;
  issues: number;
}

export type TrendMarkerType = "gift" | "issue" | "decline";
export interface TrendMarker {
  id: string;
  minute: string;
  type: TrendMarkerType;
  label: string;
  online: number;
  metricLabel: string;
  metricValue: number;
  metricUnit: string;
  detail: string;
}

export const TREND_WINDOW_MINUTES = 15;
export const TREND_MARKER_RULES = {
  gift: { minimum: 5, multiplier: 2, baselineMinutes: 3, cooldownMinutes: 2 },
  issue: { minimum: 3, multiplier: 2, baselineMinutes: 3, cooldownMinutes: 2 },
  decline: { minimumPeople: 20, minimumRatio: 0.05, cooldownMinutes: 2 }
} as const;

export type ScoreDimension = "online" | "enter" | "chat" | "like" | "gift" | "unique" | "highValueGift" | "highLevelEntry" | "negative";
export type ScoreWeights = Record<ScoreDimension, number>;
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { online: 12, enter: 12, chat: 12, like: 10, gift: 8, unique: 10, highValueGift: 8, highLevelEntry: 8, negative: 20 };

export interface ActionSettings { aggregate: boolean; showSuggestions: boolean; }
export interface ActionItem { tone: "blue" | "red" | "orange"; type: "level" | "negative" | "gift" | "decline"; title: string; body: string; suggestion: string; at: string; count: number; }

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

function minuteKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setSeconds(0, 0);
  return date.toISOString();
}

export function mergeTrend(seed: OnlinePoint[], live: OnlinePoint[]): OnlinePoint[] {
  const merged = new Map<string, OnlinePoint>();
  for (const point of [...seed, ...live]) {
    const minute = minuteKey(point.minute);
    const previous = merged.get(minute);
    merged.set(minute, previous ? {
      ...point,
      minute,
      online: point.online || previous.online,
      chat: Math.max(point.chat, previous.chat), enter: Math.max(point.enter, previous.enter),
      like: Math.max(point.like, previous.like), gift: Math.max(point.gift, previous.gift),
      unique: Math.max(point.unique, previous.unique), issues: Math.max(point.issues, previous.issues)
    } : { ...point, minute });
  }
  const points = [...merged.values()].sort((a, b) => timestamp(a.minute) - timestamp(b.minute));
  let online = 0;
  return points.map((point) => { online = point.online || online; return { ...point, online }; });
}

function eventCount(event: LiveEvent): number {
  if (event.eventType === "like") return Math.max(1, Number(event.metrics.count ?? 1));
  if (event.eventType === "gift") return Math.max(0, Number(event.metrics.giftCount ?? 1));
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
    Number(event.metrics.giftCount ?? 0) > 0 &&
    Number(event.metrics.diamondCount ?? 0) * Number(event.metrics.giftCount ?? 0) >= HIGH_VALUE_DIAMONDS);
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

export function buildOnlineTrend(events: LiveEvent[], startedAt?: number | null, now = Date.now()): OnlinePoint[] {
  const fallbackStart = now - 19 * 60_000;
  const start = new Date(Math.min(now, startedAt && Number.isFinite(startedAt) ? startedAt : fallbackStart));
  start.setSeconds(0, 0);
  const end = new Date(now); end.setSeconds(0, 0);
  const minutes = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 60_000) + 1);
  const points: OnlinePoint[] = Array.from({ length: minutes }, (_, index) => {
    const minute = new Date(start.getTime() + index * 60_000).toISOString();
    return { minute, online: 0, chat: 0, enter: 0, like: 0, gift: 0, unique: 0, issues: 0 };
  });
  const indexByMinute = new Map(points.map((point, index) => [point.minute, index]));
  const usersByMinute = new Map<number, Set<string>>();
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
    if (event.eventType === "chat" && event.content && issueRule(event.content)) point.issues += 1;
    if (event.userIdHash) {
      const users = usersByMinute.get(index) ?? new Set<string>();
      users.add(event.userIdHash); usersByMinute.set(index, users); point.unique = users.size;
    }
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

function recentAverage(points: OnlinePoint[], index: number, key: "gift" | "issues", count: number): number {
  const baseline = points.slice(Math.max(0, index - count), index);
  return baseline.length ? baseline.reduce((sum, point) => sum + point[key], 0) / baseline.length : 0;
}

export function detectTrendMarkers(points: OnlinePoint[]): TrendMarker[] {
  const markers: TrendMarker[] = [];
  const lastByType = new Map<TrendMarkerType, number>();
  const canAdd = (type: TrendMarkerType, minute: number, cooldownMinutes: number) => {
    const previous = lastByType.get(type);
    if (previous !== undefined && minute - previous < cooldownMinutes * 60_000) return false;
    lastByType.set(type, minute);
    return true;
  };

  points.forEach((point, index) => {
    const minute = timestamp(point.minute);
    if (!minute) return;
    const giftAverage = recentAverage(points, index, "gift", TREND_MARKER_RULES.gift.baselineMinutes);
    if (point.gift >= TREND_MARKER_RULES.gift.minimum && point.gift >= giftAverage * TREND_MARKER_RULES.gift.multiplier && canAdd("gift", minute, TREND_MARKER_RULES.gift.cooldownMinutes)) {
      markers.push({ id: `gift:${point.minute}`, minute: point.minute, type: "gift", label: "礼物高峰", online: point.online, metricLabel: "礼物速率", metricValue: point.gift, metricUnit: "件/分", detail: `本分钟${point.gift}件，近${TREND_MARKER_RULES.gift.baselineMinutes}分钟均值${giftAverage.toFixed(1)}件/分` });
    }
    const issueAverage = recentAverage(points, index, "issues", TREND_MARKER_RULES.issue.baselineMinutes);
    if (point.issues >= TREND_MARKER_RULES.issue.minimum && point.issues >= issueAverage * TREND_MARKER_RULES.issue.multiplier && canAdd("issue", minute, TREND_MARKER_RULES.issue.cooldownMinutes)) {
      markers.push({ id: `issue:${point.minute}`, minute: point.minute, type: "issue", label: "弹幕问题激增", online: point.online, metricLabel: "问题弹幕", metricValue: point.issues, metricUnit: "条/分", detail: `本分钟${point.issues}条，近${TREND_MARKER_RULES.issue.baselineMinutes}分钟均值${issueAverage.toFixed(1)}条/分` });
    }
    const previousOnline = index > 0 ? points[index - 1]!.online : 0;
    const decline = previousOnline > 0 && point.online > 0 ? previousOnline - point.online : 0;
    const declineRatio = previousOnline > 0 ? decline / previousOnline : 0;
    if (decline >= TREND_MARKER_RULES.decline.minimumPeople && declineRatio >= TREND_MARKER_RULES.decline.minimumRatio && canAdd("decline", minute, TREND_MARKER_RULES.decline.cooldownMinutes)) {
      markers.push({ id: `decline:${point.minute}`, minute: point.minute, type: "decline", label: "在线下降", online: point.online, metricLabel: "在线下降", metricValue: decline, metricUnit: `人（${(declineRatio * 100).toFixed(1)}%）`, detail: `较上一分钟减少${decline.toLocaleString()}人` });
    }
  });
  return markers;
}

export function trendWindow(points: OnlinePoint[], limit = TREND_WINDOW_MINUTES): OnlinePoint[] {
  return points.slice(-Math.max(1, limit));
}

export function healthScore(input: {
  online: number;
  rates: DashboardRates;
  highValueGiftCount: number;
  highLevelEntryCount: number;
  negativeCount: number;
}, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
  const contributions = scoreContributions(input, weights);
  return Math.round(Math.max(0, Math.min(100, Object.values(contributions).reduce((sum, value) => sum + value, 0))));
}

export function scoreContributions(input: {
  online: number; rates: DashboardRates; highValueGiftCount: number; highLevelEntryCount: number; negativeCount: number;
}, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): ScoreWeights {
  const normalized: ScoreWeights = {
    online: Math.min(1, input.online > 0 ? Math.log10(input.online + 1) / 4 : 0),
    enter: Math.min(1, input.rates.enter / 40), chat: Math.min(1, input.rates.chat / 10),
    like: Math.min(1, input.rates.like / 600), gift: Math.min(1, input.rates.gift / 2),
    unique: Math.min(1, input.rates.unique / 100), highValueGift: Math.min(1, input.highValueGiftCount / 2),
    highLevelEntry: Math.min(1, input.highLevelEntryCount / 3), negative: Math.max(0, 1 - input.negativeCount / 10)
  };
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight * normalized[key as ScoreDimension]])) as ScoreWeights;
}

function rawActionItems(events: LiveEvent[]): ActionItem[] {
  const levels = events.filter((event) => event.eventType === "enter" && Number(event.metrics.userLevel ?? 0) >= HIGH_LEVEL_THRESHOLD)
    .map((event) => ({ tone: "blue", type: "level", title: "高等级用户进场", body: `${event.nickname ?? "匿名用户"}进入直播间`, suggestion: "主播欢迎并关注互动", at: event.receivedAt, count: 1 } as ActionItem));
  const negative = negativeEvents(events).map((event) => ({ tone: "red", type: "negative", title: "负面词出现", body: event.content ?? "出现负面反馈", suggestion: "关注评论区并及时回复", at: event.receivedAt, count: 1 } as ActionItem));
  const gifts = highValueGifts(events).map((event) => ({ tone: "orange", type: "gift", title: "礼物待感谢", body: `${event.nickname ?? "匿名用户"}送出${event.metrics.giftName ?? "礼物"}×${event.metrics.giftCount ?? 1}`, suggestion: "主播及时感谢用户", at: event.receivedAt, count: 1 } as ActionItem));
  return [...levels, ...negative, ...gifts].sort((a, b) => timestamp(b.at) - timestamp(a.at));
}

export function buildActionItems(events: LiveEvent[], trendMarkers: TrendMarker[], settings: ActionSettings): ActionItem[] {
  const raw = rawActionItems(events);
  const items = settings.aggregate ? [...raw.reduce((groups, item) => {
    const bucket = Math.floor(timestamp(item.at) / 60_000);
    const key = `${item.type}:${bucket}`;
    const current = groups.get(key);
    if (!current) groups.set(key, { ...item });
    else {
      current.count += 1;
      if (item.type === "level") current.body = `${current.count}位高等级用户进入直播间`;
      else if (item.type === "negative") current.body = `${current.count}条负面反馈需要关注`;
      else if (item.type === "gift") current.body = `${current.count}个高价值礼物待感谢`;
    }
    return groups;
  }, new Map<string, ActionItem>()).values()] : raw;
  for (const marker of trendMarkers.filter((item) => item.type === "decline")) {
    items.push({ tone: "red", type: "decline", title: "在线人数下降", body: marker.detail, suggestion: "增加互动并切换福利品", at: marker.minute, count: 1 });
  }
  return items.sort((a, b) => timestamp(b.at) - timestamp(a.at));
}

export function levelTier(level: number | undefined): string {
  const value = Math.max(0, Number(level ?? 0));
  return `lv-${Math.min(50, Math.floor(value / 10) * 10)}`;
}

export function eventMatchesFilter(event: LiveEvent, filter: EventFilter): boolean {
  return filter === "all" || event.eventType === filter;
}
