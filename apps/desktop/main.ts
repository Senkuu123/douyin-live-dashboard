import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig, loadLocalEnvironment } from "../../src/config/app-config.js";
import { createPool, migrate } from "../../src/storage/database.js";
import { MonitoringRepository } from "../../src/storage/monitoring-repository.js";
import { MonitoringService } from "../../src/services/monitoring-service.js";
import { resolveRoomInput } from "../../src/utils/room-input.js";
import { toCsv } from "../../src/utils/csv.js";
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
      const summary = await mainWindow.webContents.executeJavaScript(`({ ok: true, panels: document.querySelectorAll('.panel').length, metrics: document.querySelectorAll('.metric-card').length, title: document.title, body: document.body.innerText.slice(0, 200), roomInputOutline: getComputedStyle(document.querySelector('.room-field input')).outlineStyle, factors: [...document.querySelectorAll('.factor')].map(el => ({ label: el.querySelector('b')?.textContent, value: el.querySelector('strong')?.textContent, display: getComputedStyle(el).display, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) })) })`);
      const image = await mainWindow.webContents.capturePage();
      await mainWindow.webContents.executeJavaScript(`document.getElementById('scoreSettingsButton')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const scoreSettingsImage = await mainWindow.webContents.capturePage();
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.drawer-mask')?.click(); document.getElementById('actionSettingsButton')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 180));
      const actionSettingsImage = await mainWindow.webContents.capturePage();
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.settings-drawer.open .secondary')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-rank="gift"]')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const giftRankImage = await mainWindow.webContents.capturePage();
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-rank="fans"]')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const fanRankImage = await mainWindow.webContents.capturePage();
      const rankSummary = await mainWindow.webContents.executeJavaScript(`({ active: document.querySelector('.rank-tabs button.active')?.textContent, rows: document.querySelectorAll('.rank-panel ol li').length, first: document.querySelector('.rank-panel ol li')?.innerText })`);
      await mainWindow.webContents.executeJavaScript(`document.querySelector('.event-filters button:nth-child(2)')?.click(); document.getElementById('onlyHighValueButton')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const highValueImage = await mainWindow.webContents.capturePage();
      const eventSummary = await mainWindow.webContents.executeJavaScript(`({ actionCards: document.querySelectorAll('.action-card').length, visibleGiftRows: document.querySelectorAll('.event-row.gift').length, zeroValueGiftRows: [...document.querySelectorAll('.event-row.gift')].filter(row => row.innerText.includes('价值 0 钻石')).length, onlyHighValue: document.getElementById('onlyHighValueButton')?.classList.contains('active') })`);
      await mainWindow.webContents.executeJavaScript(`document.getElementById('levelFilterButton')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const drawerImage = await mainWindow.webContents.capturePage();
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-level="20"]')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await mainWindow.webContents.executeJavaScript(`document.getElementById('applyLevelFilter')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 900));
      const filterSummary = await mainWindow.webContents.executeJavaScript(`({ button: document.getElementById('levelFilterButton')?.innerText, drawerOpen: document.querySelector('.level-drawer')?.classList.contains('open'), visibleChats: document.querySelectorAll('.chat-row').length, visibleEvents: document.querySelectorAll('.event-row').length })`);
      const appliedImage = await mainWindow.webContents.capturePage();
      await Promise.all([
        writeFile(path.join(outputDir, "ui-smoke.png"), image.toPNG()),
        writeFile(path.join(outputDir, "ui-score-settings.png"), scoreSettingsImage.toPNG()),
        writeFile(path.join(outputDir, "ui-action-settings.png"), actionSettingsImage.toPNG()),
        writeFile(path.join(outputDir, "ui-gift-ranking.png"), giftRankImage.toPNG()),
        writeFile(path.join(outputDir, "ui-fans-ranking.png"), fanRankImage.toPNG()),
        writeFile(path.join(outputDir, "ui-high-value-filter.png"), highValueImage.toPNG()),
        writeFile(path.join(outputDir, "ui-level-filter.png"), drawerImage.toPNG()),
        writeFile(path.join(outputDir, "ui-level-filter-applied.png"), appliedImage.toPNG()),
        writeFile(path.join(outputDir, "ui-smoke.json"), JSON.stringify({ ...summary, ranking: rankSummary, events: eventSummary, filter: filterSummary }, null, 2), "utf8")
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
  const localEnvironmentPath = app.isPackaged
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath), ".env.local")
    : path.resolve(process.cwd(), ".env.local");
  loadLocalEnvironment(localEnvironmentPath);
  const config = loadConfig();
  pool = createPool(config.database);
  await migrate(pool);
  const repository = new MonitoringRepository(pool);

  ipcMain.handle("dashboard:snapshot", () => repository.dashboardSnapshot());
  ipcMain.handle("clipboard:read-text", () => clipboard.readText());
  ipcMain.handle("dashboard:level-summary", (_event, minLevel: number) => repository.dashboardLevelSummary(minLevel));
  ipcMain.handle("dashboard:export-csv", async () => {
    const data = await repository.latestSessionExport();
    if (!data) throw new Error("暂无可导出的采集会话");
    const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "导出本次采集数据",
      defaultPath: `douyin-${data.roomId}-${stamp}.csv`,
      filters: [{ name: "CSV 文件", extensions: ["csv"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const csv = toCsv(data.rows, [
      { header: "event_id", value: (row) => row.eventId },
      { header: "platform_message_id", value: (row) => row.platformMessageId },
      { header: "event_type", value: (row) => row.eventType },
      { header: "event_time", value: (row) => row.eventTime },
      { header: "received_at", value: (row) => row.receivedAt },
      { header: "user_id_hash", value: (row) => row.userIdHash },
      { header: "nickname", value: (row) => row.nickname },
      { header: "content", value: (row) => row.content },
      { header: "metrics", value: (row) => row.metrics },
      { header: "raw_method", value: (row) => row.rawMethod },
      { header: "collector_version", value: (row) => row.collectorVersion }
    ]);
    await writeFile(result.filePath, csv, "utf8");
    return { canceled: false, filePath: result.filePath, rowCount: data.rows.length };
  });
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
