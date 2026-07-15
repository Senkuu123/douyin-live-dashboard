import { describe, expect, it } from "vitest";
import { resolveRoomInput } from "../src/utils/room-input.js";

describe("resolveRoomInput", () => {
  it("accepts a numeric room identifier", async () => {
    await expect(resolveRoomInput(" 123456 ")).resolves.toBe("123456");
  });

  it("extracts a room identifier from a live URL", async () => {
    await expect(resolveRoomInput("https://live.douyin.com/987654?foo=bar")).resolves.toBe("987654");
  });

  it("rejects unsupported input", async () => {
    await expect(resolveRoomInput("not-a-room")).rejects.toThrow(/数字房间号/);
  });
});
