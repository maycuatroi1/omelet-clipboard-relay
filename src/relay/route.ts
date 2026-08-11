import type { ServerWebSocket, WebSocketHandler } from "bun";
import {
  type RelayAck,
  type RelayCancel,
  type RelayChunk,
  type RelayComplete,
  type RelayError,
  type RelayResume,
  parseMessage,
} from "../proto/types.ts";
import {
  ackBuffer,
  appendChunk,
  cancelBuffer,
  checkRateLimit,
  _reset as resetBuffers,
} from "./buffers.ts";

export interface RelayWsData {
  code: string;
  ip: string;
}

type RelayData = RelayChunk | RelayAck | RelayCancel | RelayResume | RelayComplete;

const RELAY_KINDS = new Set<RelayData["kind"]>([
  "relay.chunk",
  "relay.ack",
  "relay.cancel",
  "relay.resume",
  "relay.complete",
]);

type RelaySocket = ServerWebSocket<RelayWsData>;

const rooms = new Map<string, Set<RelaySocket>>();

function joinRoom(code: string, ws: RelaySocket): Set<RelaySocket> {
  let set = rooms.get(code);
  if (!set) {
    set = new Set();
    rooms.set(code, set);
  }
  set.add(ws);
  return set;
}

function leaveRoom(code: string, ws: RelaySocket): void {
  const set = rooms.get(code);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    rooms.delete(code);
  }
}

function otherPeers(code: string, ws: RelaySocket): RelaySocket[] {
  const set = rooms.get(code);
  if (!set) return [];
  const out: RelaySocket[] = [];
  for (const p of set) {
    if (p !== ws) out.push(p);
  }
  return out;
}

function sendError(
  ws: RelaySocket,
  code: RelayError["code"],
  message: string,
  transferId?: string,
): void {
  const payload: RelayError =
    transferId === undefined
      ? { kind: "relay.error", code, message }
      : { kind: "relay.error", code, message, transferId };
  ws.send(JSON.stringify(payload));
}

function handleChunk(ws: RelaySocket, chunk: RelayChunk): void {
  if (!checkRateLimit(ws.data.ip)) {
    sendError(ws, "rate-limited", "per-IP rate limit exceeded", chunk.transferId);
    return;
  }
  const result = appendChunk(ws.data.code, ws.data.ip, chunk);
  if (!result.ok) {
    const message =
      result.errorCode === "over-cap"
        ? `chunk exceeds 10 MB cap (${result.totalBytes} bytes)`
        : "concurrent relay room limit reached";
    sendError(ws, result.errorCode, message, chunk.transferId);
    if (result.errorCode === "over-cap") {
      for (const p of otherPeers(ws.data.code, ws)) {
        sendError(p, "over-cap", "transfer exceeded cap", chunk.transferId);
      }
      ws.close(4413, "over-cap");
    }
    return;
  }
  for (const p of otherPeers(ws.data.code, ws)) p.send(JSON.stringify(chunk));
}

function handleAck(ws: RelaySocket, ack: RelayAck): void {
  ackBuffer(ws.data.code, ack.transferId, ack.seq);
  for (const p of otherPeers(ws.data.code, ws)) p.send(JSON.stringify(ack));
}

function handleCancel(ws: RelaySocket, cancel: RelayCancel): void {
  cancelBuffer(ws.data.code, cancel.transferId);
  for (const p of otherPeers(ws.data.code, ws)) p.send(JSON.stringify(cancel));
}

export const websocket: WebSocketHandler<RelayWsData> = {
  open(ws) {
    joinRoom(ws.data.code, ws);
  },

  message(ws, raw) {
    const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // biome-ignore lint/suspicious/noConsole: invalid frame dropped per spec
      console.warn("relay: non-json frame dropped");
      return;
    }
    const msg = parseMessage(parsed);
    if (!msg) {
      // biome-ignore lint/suspicious/noConsole: invalid frame dropped per spec
      console.warn("relay: invalid frame shape dropped");
      return;
    }
    if (!RELAY_KINDS.has(msg.kind as RelayData["kind"])) {
      // biome-ignore lint/suspicious/noConsole: non-relay kind dropped
      console.warn(`relay: non-relay kind '${msg.kind}' dropped`);
      return;
    }

    switch (msg.kind) {
      case "relay.chunk":
        handleChunk(ws, msg);
        break;
      case "relay.ack":
        handleAck(ws, msg);
        break;
      case "relay.cancel":
        handleCancel(ws, msg);
        break;
      case "relay.resume":
      case "relay.complete":
        for (const p of otherPeers(ws.data.code, ws)) p.send(JSON.stringify(msg));
        break;
    }
  },

  close(ws) {
    leaveRoom(ws.data.code, ws);
  },
};

export { resetBuffers };
