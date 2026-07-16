import { describe, expect, it } from "vitest";
import { toCsv } from "../src/utils/csv.js";

describe("toCsv", () => {
  it("writes UTF-8 BOM and escapes commas, quotes and line breaks", () => {
    const csv = toCsv([{ name: "清风,明月", content: "他说\"你好\"\n下一行" }], [
      { header: "name", value: (row) => row.name },
      { header: "content", value: (row) => row.content }
    ]);

    expect(csv.startsWith("\uFEFFname,content\r\n")).toBe(true);
    expect(csv).toContain('"清风,明月"');
    expect(csv).toContain('"他说""你好""\n下一行"');
  });
});
