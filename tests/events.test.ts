import { describe, expect, it } from "vitest";
import { extractSidecarRoomMetadata, normalizeSidecarPayload } from "../src/domain/events.js";

describe("normalizeSidecarPayload", () => {
  it("normalizes supported messages and hashes user identifiers", () => {
    const events = normalizeSidecarPayload(
      [
        { id: "m1", method: "WebcastChatMessage", content: "你好", user: { id: "u1", name: "观众" } },
        { id: "m2", method: "WebcastLikeMessage", user: { id: "u2" } }
      ],
      "test",
      "salt",
      new Date("2026-07-14T00:00:00.000Z")
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      platformMessageId: "m1",
      eventType: "chat",
      nickname: "观众",
      content: "你好",
      rawMethod: "WebcastChatMessage"
    });
    expect(events[0]?.userIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(events[1]).toMatchObject({ eventType: "like", rawMethod: "WebcastLikeMessage" });
  });

  it("extracts gift, member, social and room metrics", () => {
    const events = normalizeSidecarPayload([
      { common: { msgId: "g1" }, method: "WebcastGiftMessage", user: { idStr: "u1", nickname: "送礼用户" }, gift: { id: "88", name: "小心心", diamondCount: 2 }, repeatCount: 3 },
      { common: { msgId: "e1" }, method: "WebcastMemberMessage", user: { idStr: "u2", nickname: "新用户" } },
      { common: { msgId: "f1" }, method: "WebcastSocialMessage", action: 1, user: { idStr: "u3" } },
      { common: { msgId: "s1" }, method: "WebcastRoomStatsMessage", userCount: "3825", totalUser: "9322", likeCount: "736" }
    ], "test", "salt");

    expect(events.map((event) => event.eventType)).toEqual(["gift", "enter", "follow", "room_stats"]);
    expect(events[0]?.metrics).toMatchObject({ giftId: "88", giftName: "小心心", giftCount: 3, diamondCount: 2 });
    expect(events[3]?.metrics).toMatchObject({ online: 3825, totalUsers: 9322, totalLikes: 736 });
  });

  it("supports the protobuf JSON shape emitted by the collector sidecar", () => {
    const events = normalizeSidecarPayload(
      {
        common: { msgId: "9988", createTime: "1783987200000" },
        user: { secUid: "secure-user-id", nickname: "测试用户" },
        content: "测试弹幕",
        method: "WebcastChatMessage",
        livename: "主播",
        title: "测试直播间"
      },
      "v2.0.24",
      "salt"
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platformMessageId: "9988",
      nickname: "测试用户",
      content: "测试弹幕",
      collectorVersion: "v2.0.24"
    });
  });

  it("prefers the distinct webcast user id and extracts room metadata", () => {
    const first = { method: "WebcastChatMessage", user: { id: "constant", idStr: "constant", webcastUid: "viewer-a", nickname: "甲" }, title: "直播标题", livename: "主播", content: "你好" };
    const second = { method: "WebcastMemberMessage", user: { id: "constant", idStr: "constant", webcastUid: "viewer-b", nickname: "乙" }, title: "直播标题", livename: "主播" };
    const events = normalizeSidecarPayload([first, second], "test", "salt");

    expect(events[0]?.userIdHash).not.toBe(events[1]?.userIdHash);
    expect(extractSidecarRoomMetadata([first, second])).toEqual({ title: "直播标题", liveName: "主播" });
  });

  it("does not treat room cumulative total as current online", () => {
    const events = normalizeSidecarPayload([
      { common: { msgId: "r1" }, method: "WebcastRoomStatsMessage", total: "200000", totalUser: "200000" },
      { common: { msgId: "a1" }, method: "WebcastRoomUserSeqMessage", total: "3825" }
    ], "test", "salt");

    expect(events[0]?.metrics).toMatchObject({ total: 200000, totalUsers: 200000 });
    expect(events[0]?.metrics.online).toBeUndefined();
    expect(events[1]?.metrics.online).toBe(3825);
  });

  it("ignores sidecar system messages", () => {
    expect(
      normalizeSidecarPayload(
        { type: "system", code: "ROOM_ONLINE", message: "直播间已开播" },
        "test",
        ""
      )
    ).toEqual([]);
  });
});
