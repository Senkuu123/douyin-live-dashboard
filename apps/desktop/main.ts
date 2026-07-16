import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig, loadLocalEnvironment } from "../../src/config/app-config.js";
import { createPool, migrate } from "../../src/storage/database.js";
import { MonitoringRepository } from "../../src/storage/monitoring-repository.js";
import { MonitoringService } from "../../src/services/monitoring-service.js";
import { resolveRoomInput } from "../../src/utils/room-input.js";
import type { StandardEvent } from "../../src/domain/events.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let abortController: AbortController | null = null;
let monitorTask: Promise<void> | null = null;
let pool: ReturnType<typeof createPool> | null = null;

function serializeEvent(event: StandardEvent) {
  return { ...event, eventTime: event.eventTime.toISOString(), receivedAt: event.receivedAt.toISOString(), payload: undefined };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#060b12",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#070b12", symbolColor: "#90a0b5", height: 42 },
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else if (!app.isPackaged && process.env.NODE_ENV !== "production") await mainWindow.loadURL("http://127.0.0.1:5173");
  else await mainWindow.loadFile(path.join(app.getAppPath(), "dist-renderer", "index.html"));
  if (process.argv.includes("--smoke-test")) {
    const outputDir = path.join(app.getAppPath(), "artifacts");
    await mkdir(outputDir, { recursive: true });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const summary = await mainWindow.webContents.executeJavaScript(`({ ok: true, panels: document.querySelectorAll('.panel').length, metrics: document.querySelectorAll('.metric-card').length, title: document.title, body: document.body.innerText.slice(0, 200) })`);
      const image = await mainWindow.webContents.capturePage();
      await Promise.all([
        writeFile(path.join(outputDir, "ui-smoke.png"), image.toPNG()),
        writeFile(path.join(outputDir, "ui-smoke.json"), JSON.stringify(summary, null, 2), "utf8")
      ]);
    } catch (error) {
      await writeFile(path.join(outputDir, "ui-smoke.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }, null, 2), "utf8");
    } finally {
      app.exit(0);
    }
  }
}

app.whenReady().then(async () => {
  if (app.isPackaged) process.env.COLLECTOR_BINARY = path.join(process.resourcesPath, "vendor", "douyinlive", "douyinLive.exe");
  loadLocalEnvironment();
  const config = loadConfig();
  pool = createPool(config.database);
  await migrate(pool);
  const repository = new MonitoringRepository(pool);

  ipcMain.handle("dashboard:snapshot", () => repository.dashboardSnapshot());
  ipcMain.handle("monitor:start", async (_event, input: string) => {
    if (monitorTask) throw new Error("已有直播间正在采集");
    const roomId = await resolveRoomInput(input);
    abortController = new AbortController();
    const service = new MonitoringService(config, pool!);
    monitorTask = service.run(input, abortController.signal, {
      onEvent: (event) => mainWindow?.webContents.send("monitor:event", serializeEvent(event)),
      onStatus: (status) => mainWindow?.webContents.send("monitor:status", status)
    }).catch((error) => {
      mainWindow?.webContents.send("monitor:status", { phase: "failed", roomId, message: error instanceof Error ? error.message : String(error) });
    }).finally(() => { monitorTask = null; abortController = null; });
    return { roomId };
  });
  ipcMain.handle("monitor:stop", async () => { abortController?.abort(); await monitorTask; });
  await createWindow();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => abortController?.abort());
app.on("quit", () => { void pool?.end(); });
