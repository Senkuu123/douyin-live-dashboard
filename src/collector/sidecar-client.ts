import WebSocket, { type RawData } from "ws";
import type { AppConfig } from "../config/app-config.js";

export interface SidecarSystemMessage {
  type: "system";
  event?: string;
  code?: string;
  message?: string;
  status?: string;
  live?: boolean;
  room_id?: string;
  live_name?: string;
  title?: string;
}

export interface SidecarCallbacks {
  onPayload(payload: unknown): void;
  onSystem(message: SidecarSystemMessage): void;
  onClose(code: number, reason: string): void;
}

export class SidecarClient {
  private socket: WebSocket | null = null;
  private readonly config: AppConfig["collector"];
  private readonly roomId: string;
  private readonly callbacks: SidecarCallbacks;

  constructor(config: AppConfig["collector"], roomId: string, callbacks: SidecarCallbacks) {
    this.config = config;
    this.roomId = roomId;
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    const url = `ws://${this.config.host}:${this.config.port}/ws/${encodeURIComponent(this.roomId)}`;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      const rejectBeforeOpen = (error: Error) => reject(error);
      socket.once("error", rejectBeforeOpen);
      socket.once("open", () => {
        socket.off("error", rejectBeforeOpen);
        socket.on("error", (error) => process.stderr.write(`采集连接错误：${error.message}\n`));
        resolve();
      });
      socket.on("message", (data: RawData) => this.handleMessage(data));
      socket.on("close", (code, reason) => this.callbacks.onClose(code, reason.toString()));
    });
  }

  close(): void {
    if (!this.socket) return;
    this.socket.close(1000, "client stop");
    this.socket = null;
  }

  private handleMessage(data: RawData): void {
    let payload: unknown;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      process.stderr.write("收到无法解析的采集消息\n");
      return;
    }

    if (payload && typeof payload === "object" && (payload as { type?: string }).type === "system") {
      this.callbacks.onSystem(payload as SidecarSystemMessage);
      return;
    }
    this.callbacks.onPayload(payload);
  }
}
