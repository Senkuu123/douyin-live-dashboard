import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config/app-config.js";

const execFileAsync = promisify(execFile);

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`采集侧车未在${host}:${port}启动`);
}

export class SidecarManager {
  private process: ChildProcess | null = null;
  private readonly config: AppConfig["collector"];

  constructor(config: AppConfig["collector"]) {
    this.config = config;
  }

  async version(): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(this.config.binaryPath, ["--version"], {
        timeout: 5000,
        windowsHide: true
      });
      return `${stdout}${stderr}`.trim().slice(0, 64) || "unknown";
    } catch {
      return "unknown";
    }
  }

  async ensureRunning(): Promise<void> {
    if (await canConnect(this.config.host, this.config.port)) return;

    try {
      await access(this.config.binaryPath);
    } catch {
      throw new Error(
        `未找到采集侧车${this.config.binaryPath}，请先运行npm run collector:install`
      );
    }

    const child = spawn(this.config.binaryPath, [], {
      cwd: path.dirname(this.config.binaryPath),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.process = child;
    child.stdout?.on("data", (data: Buffer) => process.stderr.write(`[collector] ${data}`));
    child.stderr?.on("data", (data: Buffer) => process.stderr.write(`[collector] ${data}`));
    await waitForPort(this.config.host, this.config.port, 20_000);
  }

  async stop(): Promise<void> {
    if (!this.process || this.process.killed) return;
    this.process.kill();
    this.process = null;
  }
}
