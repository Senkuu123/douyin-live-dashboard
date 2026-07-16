import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../apps/desktop/contracts.js";
import {
  calculateRates,
  eventMatchesFilter,
  groupIssues,
  healthScore,
  highLevelEntries,
  highValueGifts,
  levelTier
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
    const entry = event({ eventType: "enter", metrics: { userLevel: 28 } });
    const question = event({ content: "这个多少钱，链接在哪？" });

    expect(highValueGifts([gift])).toEqual([gift]);
    expect(highLevelEntries([entry, entry])).toHaveLength(1);
    expect(groupIssues([question]).map((item) => item.key)).toEqual(["price", "link"]);
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
});
