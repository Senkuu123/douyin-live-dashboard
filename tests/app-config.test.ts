import { describe, expect, it } from "vitest";
import { assertProjectDatabase, loadConfig, PROJECT_DATABASE } from "../src/config/app-config.js";

describe("database guard", () => {
  it("accepts only the project database", () => {
    expect(() => assertProjectDatabase(PROJECT_DATABASE)).not.toThrow();
    expect(() => assertProjectDatabase("mysql")).toThrow(/拒绝操作数据库/);
    expect(() => assertProjectDatabase("another_database")).toThrow(/拒绝操作数据库/);
  });

  it("requires the password to come from the environment", () => {
    expect(() => loadConfig({ DB_PASSWORD: "secret" }, {})).not.toThrow();
    expect(loadConfig({ DB_PASSWORD_B64: "c2VjcmV0" }, {}).database.password).toBe("secret");
    expect(loadConfig({}, { user: "root", password: "from-my-cnf" }).database.password).toBe("from-my-cnf");
    expect(() => loadConfig({}, {})).toThrow(/本机数据库凭据/);
  });

  it("passes an optional Base64URL Douyin Cookie only through collector config", () => {
    const config = loadConfig({ DB_PASSWORD: "secret", DOUYIN_COOKIE_B64: "dHR3aWQ9dGVzdA" }, {});
    expect(config.collector.cookieBase64Url).toBe("dHR3aWQ9dGVzdA");
    expect(config.database.password).toBe("secret");
  });
});
