import { describe, expect, it } from "vitest";
import { parseMyCnf } from "../src/config/my-cnf.js";

describe("parseMyCnf", () => {
  it("reads only the client section and preserves password characters", () => {
    const parsed = parseMyCnf(`
      [mysql]
      user=ignored

      [client]
      host=localhost
      port=3306
      user=root
      password="p#a=ss"
    `);

    expect(parsed).toEqual({
      host: "localhost",
      port: "3306",
      user: "root",
      password: "p#a=ss"
    });
  });
});
