// Local test helpers for the observability suite. Duplicates a few utilities
// from test/relay/helpers.ts rather than importing across suites so this test
// stays self-contained.

import { fetchHandler, websocket } from "../../src/app.ts";
import type { SignalWsData } from "../../src/routes/signal.ts";

export interface Harness {
  server: Bun.Server<SignalWsData>;
  httpBase: string;
  wsBase: string;
  stop: () => void;
}

export function startServer(): Harness {
  const server = Bun.serve({ port: 0, fetch: fetchHandler, websocket });
  const httpBase = `http://localhost:${server.port}`;
  const wsBase = `ws://localhost:${server.port}`;
  return {
    server,
    httpBase,
    wsBase,
    stop: () => {
      server.stop(true);
    },
  };
}

export function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const onOpen = () => {
      ws.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => reject(new Error("ws open failed"));
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
  });
}

export async function openWs(harness: Harness, path: string): Promise<WebSocket> {
  const ws = new WebSocket(`${harness.wsBase}${path}`);
  await opened(ws);
  return ws;
}

export function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        resolve(typeof ev.data === "string" ? ev.data : "");
      },
      { once: true },
    );
  });
}

export function closeQuiet(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}
