import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../apps/desktop/contracts.js";
import {
  buildActionItems,
  buildOnlineTrend,
  calculateRates,
  DEFAULT_SCORE_WEIGHTS,
  detectTrendMarkers,
  eventMatchesFilter,
  groupIssues,
  healthScore,
  highLevelEntries,
  highValueGifts,
  levelTier,
  mergeTrend,
  trendWindow
} from "../apps/desktop/renderer/src/dashboard-model.js";

const now = new Date("2026-07-16T12:00:00.000Z").getTime();

function event(overrides: Partial<LiveEvent>): LiveEvent {
  return {
    eventId: crypto.randomUUID(),
    eventType: "chat",
    receivedAt: new Date(now - 10_000).toISOString(),
    userIdHash: "user-1",
    nickname: "观众",
    content: "你好",
    metrics: {},
    ...overrides
  };
}

describe("dashboard model", () => {
  it("uses one-minute action rates and de-duplicates users", () => {
    const events = [
      event({ eventType: "enter", userIdHash: "u1" }),
      event({ eventType: "chat", userIdHash: "u1" }),
      event({ eventType: "like", userIdHash: "u2", metrics: { count: 66 } }),
      event({ eventType: "gift", userIdHash: "u3", metrics: { giftCount: 2 } }),
      event({ eventType: "chat", receivedAt: new Date(now - 61_000).toISOString() })
    ];

    expect(calculateRates(events, now)).toEqual({ enter: 1, chat: 1, like: 66, gift: 2, unique: 3 });
  });

  it("classifies high-value gifts, high-level entries and issue groups", () => {
    const gift = event({ eventType: "gift", metrics: { diamondCount: 60, giftCount: 2 } });
    const comboSettlement = event({ eventType: "gift", metrics: { diamondCount: 1, giftCount: 0, giftComboCount: 120, giftRepeatEnd: true } });
    const entry = event({ eventType: "enter", metrics: { userLevel: 28 } });
    const priceQuestion = event({ content: "这个优惠券后多少钱？" });
    const linkQuestion = event({ content: "3号链接在哪里拍？", userIdHash: "u2" });
    const otherQuestion = event({ content: "主播今天几点下播？", userIdHash: "u3" });

    expect(highValueGifts([gift, comboSettlement])).toEqual([gift]);
    expect(highLevelEntries([entry, entry])).toHaveLength(1);
    expect(groupIssues([priceQuestion, linkQuestion, otherQuestion])).toMatchObject([
      { title: "这个优惠券后多少钱？", label: "优惠活动" },
      { title: "3号链接在哪里拍？", label: "商品链接" },
      { title: "主播今天几点下播？", label: "其他问题" }
    ]);
  });

  it("provides stable score, level tiers and event filters", () => {
    const score = healthScore({ online: 3825, rates: { enter: 38, chat: 9, like: 562, gift: 2, unique: 128 }, highValueGiftCount: 2, highLevelEntryCount: 3, negativeCount: 3 });
    const gift = event({ eventType: "gift" });
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThanOrEqual(100);
    expect(levelTier(9)).toBe("lv-0");
    expect(levelTier(28)).toBe("lv-20");
    expect(levelTier(66)).toBe("lv-50");
    expect(eventMatchesFilter(gift, "gift")).toBe(true);
    expect(eventMatchesFilter(gift, "enter")).toBe(false);
  });

  it("starts the online trend at session start and charts per-minute unique users", () => {
    const startedAt = new Date("2026-07-16T11:57:20.000Z").getTime();
    const events = [
      event({ receivedAt: "2026-07-16T11:57:30.000Z", userIdHash: "u1", eventType: "audience", metrics: { online: 100 } }),
      event({ receivedAt: "2026-07-16T11:57:40.000Z", userIdHash: "u1" }),
      event({ receivedAt: "2026-07-16T11:57:50.000Z", userIdHash: "u2" }),
      event({ receivedAt: "2026-07-16T11:58:10.000Z", userIdHash: "u1" })
    ];
    const trend = buildOnlineTrend(events, startedAt, now);
    expect(trend[0]).toMatchObject({ minute: "2026-07-16T11:57:00.000Z", online: 100, unique: 2 });
    expect(trend[1]).toMatchObject({ online: 100, unique: 1 });
    expect(trend.at(-1)?.minute).toBe("2026-07-16T12:00:00.000Z");
    const merged = mergeTrend(
      [{ minute: "2026-07-16T11:57:05.000Z", online: 100, chat: 1, enter: 0, like: 0, gift: 0, unique: 1, issues: 0 }],
      [{ minute: "2026-07-16T11:57:55.000Z", online: 110, chat: 0, enter: 1, like: 0, gift: 2, unique: 1, issues: 3 }]
    );
    expect(merged).toEqual([{ minute: "2026-07-16T11:57:00.000Z", online: 110, chat: 1, enter: 1, like: 0, gift: 2, unique: 1, issues: 3 }]);
  });

  it("supports weighted scoring and aggregated or split action prompts", () => {
    const highLevelOne = event({ eventType: "enter", userIdHash: "level-1", metrics: { userLevel: 28 }, receivedAt: new Date(now - 20_000).toISOString() });
    const highLevelTwo = event({ eventType: "enter", userIdHash: "level-2", metrics: { userLevel: 30 }, receivedAt: new Date(now - 10_000).toISOString() });
    const aggregated = buildActionItems([highLevelOne, highLevelTwo], [], { aggregate: true, showSuggestions: true });
    const split = buildActionItems([highLevelOne, highLevelTwo], [], { aggregate: false, showSuggestions: false });
    expect(aggregated).toMatchObject([{ type: "level", count: 2, body: "2位高等级用户进入直播间" }]);
    expect(split).toHaveLength(2);
    expect(buildActionItems([highLevelOne, { ...highLevelOne, eventId: "second-entry", receivedAt: new Date(now - 5_000).toISOString() }], [], { aggregate: false, showSuggestions: true })).toHaveLength(2);
    expect(healthScore({ online: 1000, rates: { enter: 10, chat: 5, like: 100, gift: 1, unique: 20 }, highValueGiftCount: 1, highLevelEntryCount: 1, negativeCount: 0 }, DEFAULT_SCORE_WEIGHTS)).toBeGreaterThan(0);
  });

  it("detects repeatable minute markers with explicit cooldowns and a rolling window", () => {
    const point = (minute: number, online: number, gift: number, issues: number) => ({
      minute: new Date(now + minute * 60_000).toISOString(), online, gift, issues, chat: issues, enter: 0, like: 0, unique: 0
    });
    const points = [
      point(0, 1000, 0, 0), point(1, 900, 6, 3), point(2, 800, 7, 4), point(3, 700, 10, 7)
    ];
    const markers = detectTrendMarkers(points);
    expect(markers.filter((item) => item.type === "gift").map((item) => item.minute)).toEqual([points[1]!.minute, points[3]!.minute]);
    expect(markers.filter((item) => item.type === "issue").map((item) => item.minute)).toEqual([points[1]!.minute, points[3]!.minute]);
    expect(markers.filter((item) => item.type === "decline").map((item) => item.minute)).toEqual([points[1]!.minute, points[3]!.minute]);
    expect(markers.find((item) => item.type === "gift")).toMatchObject({ metricLabel: "礼物速率", metricValue: 6, metricUnit: "件/分" });
    expect(trendWindow(Array.from({ length: 20 }, (_, index) => point(index, 1000, 0, 0)))).toHaveLength(15);
  });

  it("creates one stable decline action for each detected decline marker", () => {
    const minute = new Date(now - 60_000).toISOString();
    const marker = { id: `decline:${minute}`, minute, type: "decline" as const, label: "在线下降", online: 900, metricLabel: "在线下降", metricValue: 100, metricUnit: "人（10.0%）", detail: "较上一分钟减少100人" };
    expect(buildActionItems([], [marker], { aggregate: true, showSuggestions: true })).toEqual([
      expect.objectContaining({ type: "decline", at: minute, body: "较上一分钟减少100人" })
    ]);
  });
});
