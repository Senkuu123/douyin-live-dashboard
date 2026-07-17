import path from "node:path";
import { loadEnvFile } from "node:process";
import { loadMyCnfClient, type MyCnfClient } from "./my-cnf.js";

export const PROJECT_DATABASE = "douyin_live_dashboard";

export interface AppConfig {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  collector: {
    binaryPath: string;
    host: string;
    port: number;
    cookieBase64Url?: string;
  };
  userHashSalt: string;
}

function parsePort(value: string | undefined, fallback: number, name: string): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name}必须是1到65535之间的整数`);
  }
  return port;
}

export function assertProjectDatabase(database: string): void {
  if (database !== PROJECT_DATABASE) {
    throw new Error(`拒绝操作数据库${database}，只允许${PROJECT_DATABASE}`);
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  myCnf: MyCnfClient = loadMyCnfClient()
): AppConfig {
  const database = env.DB_DATABASE ?? PROJECT_DATABASE;
  assertProjectDatabase(database);

  const password = env.DB_PASSWORD ?? (
    env.DB_PASSWORD_B64
      ? Buffer.from(env.DB_PASSWORD_B64, "base64").toString("utf8")
      : myCnf.password
  );
  if (password === undefined) {
    throw new Error("缺少本机数据库凭据，请配置C:\\Users\\<用户名>\\.my.cnf的[client]段");
  }

  return {
    database: {
      host: env.DB_HOST ?? myCnf.host ?? "localhost",
      port: parsePort(env.DB_PORT ?? myCnf.port, 3306, "DB_PORT"),
      database,
      user: env.DB_USER ?? myCnf.user ?? "root",
      password
    },
    collector: {
      binaryPath:
        env.COLLECTOR_BINARY ??
        path.resolve(process.cwd(), "vendor", "douyinlive", "douyinLive.exe"),
      host: env.COLLECTOR_HOST ?? "127.0.0.1",
      port: parsePort(env.COLLECTOR_PORT, 1088, "COLLECTOR_PORT"),
      cookieBase64Url: env.DOUYIN_COOKIE_B64?.trim() || undefined
    },
    userHashSalt: env.USER_HASH_SALT ?? ""
  };
}

export function loadLocalEnvironment(file = path.resolve(process.cwd(), ".env.local")): void {
  try {
    loadEnvFile(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}
