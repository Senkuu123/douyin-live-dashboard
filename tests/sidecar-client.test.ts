import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { SidecarClient } from "../src/collector/sidecar-client.js";

describe("SidecarClient", () => {
  let server: WebSocketServer | null = null;

  afterEach(async () => {
    if (!server) return;
    server.close();
    await once(server, "close");
    server = null;
  });

  it("separates system messages from event payloads", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const systems: unknown[] = [];
    const payloads: unknown[] = [];
    let requestUrl = "";
    const client = new SidecarClient(
      { binaryPath: "unused", host: "127.0.0.1", port: address.port, cookieBase64Url: "dHR3aWQ9dGVzdA" },
      "123",
      {
        onSystem: (message) => systems.push(message),
        onPayload: (payload) => payloads.push(payload),
        onClose: () => undefined
      }
    );

    server.once("connection", (socket, request) => {
      requestUrl = request.url ?? "";
      socket.send(JSON.stringify({ type: "system", code: "ROOM_ONLINE" }));
      socket.send(JSON.stringify({ method: "WebcastChatMessage", content: "hello" }));
    });

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.close();

    expect(systems).toHaveLength(1);
    expect(payloads).toHaveLength(1);
    expect(new URL(requestUrl, "ws://localhost").searchParams.get("cookie_b64")).toBe("dHR3aWQ9dGVzdA");
  });
});
