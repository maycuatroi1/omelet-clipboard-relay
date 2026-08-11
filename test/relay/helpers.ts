import { fetchHandler, websocket } from "../../src/app.ts";
import type { SignalWsData } from "../../src/routes/signal.ts";

export interface Harness {
  server: Bun.Server<SignalWsData>;
  httpBase: string;
  wsBase: string;
  stop: () => void;
}

let harness: Harness | null = null;

export function useServer(): Harness {
  if (harness) return harness;
  const server = Bun.serve({ port: 0, fetch: fetchHandler, websocket });
  const httpBase = `http://localhost:${server.port}`;
  const wsBase = `ws://localhost:${server.port}`;
  harness = {
    server,
    httpBase,
    wsBase,
    stop: () => {
      server.stop(true);
      harness = null;
    },
  };
  return harness;
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

export async function openWs(path: string): Promise<WebSocket> {
  const { wsBase } = useServer();
  const ws = new WebSocket(`${wsBase}${path}`);
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

export function expectNoMessage(ws: WebSocket, ms = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        reject(new Error(`unexpected message: ${ev.data}`));
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

export const TRANSFER_ID = "00000000-0000-4000-8000-000000000001";
export const TRANSFER_ID_2 = "00000000-0000-4000-8000-000000000002";
