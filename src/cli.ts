import path from "node:path";
import { loadConfig, loadLocalEnvironment } from "./config/app-config.js";
import { MonitoringService } from "./services/monitoring-service.js";
import { createPool, createProjectDatabase, migrate } from "./storage/database.js";
import { MonitoringRepository } from "./storage/monitoring-repository.js";

function usage(): never {
  throw new Error(
    "用法：npm run dev -- init-db | monitor <房间号或URL> [--duration=秒] | last-session"
  );
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (!command) usage();

  const projectEnvironmentLoaded = loadLocalEnvironment();
  if (!projectEnvironmentLoaded) {
    // The portable app keeps its local credentials beside the EXE. Reuse that
    // ignored file for CLI diagnostics so the two launch modes cannot silently
    // test different collector login states.
    loadLocalEnvironment(path.resolve(process.cwd(), "release", ".env.local"));
  }
  const config = loadConfig();
  await createProjectDatabase(config.database);
  const pool = createPool(config.database);
  try {
    await migrate(pool);
    if (command === "init-db") {
      process.stdout.write(`数据库${config.database.database}初始化完成\n`);
      return;
    }
    if (command === "last-session") {
      const summary = await new MonitoringRepository(pool).lastSessionSummary();
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }
    if (command === "monitor") {
      if (!argument) usage();
      const abortController = new AbortController();
      const durationOption = process.argv.slice(4).find((value) => value.startsWith("--duration="));
      const durationSeconds = durationOption ? Number(durationOption.split("=")[1]) : null;
      if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
        throw new Error("duration必须是大于0的秒数");
      }
      process.once("SIGINT", () => abortController.abort());
      process.once("SIGTERM", () => abortController.abort());
      const durationTimer = durationSeconds === null
        ? null
        : setTimeout(() => abortController.abort(), durationSeconds * 1000);
      try {
        await new MonitoringService(config, pool).run(argument, abortController.signal);
      } finally {
        if (durationTimer) clearTimeout(durationTimer);
      }
      return;
    }
    usage();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = 1;
});
