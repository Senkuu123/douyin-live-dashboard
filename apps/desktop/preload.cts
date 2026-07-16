const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import type { DesktopApi, LiveEvent, MonitorStatus } from "./contracts.js";

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke("dashboard:snapshot"),
  start: (input) => ipcRenderer.invoke("monitor:start", input),
  stop: () => ipcRenderer.invoke("monitor:stop"),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LiveEvent) => callback(payload);
    ipcRenderer.on("monitor:event", listener);
    return () => ipcRenderer.off("monitor:event", listener);
  },
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MonitorStatus) => callback(payload);
    ipcRenderer.on("monitor:status", listener);
    return () => ipcRenderer.off("monitor:status", listener);
  }
};

contextBridge.exposeInMainWorld("dashboard", api);
