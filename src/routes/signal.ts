import type { ServerWebSocket, WebSocketHandler } from "bun";
import logger from "../observability/logger.ts";
import { addPeer, getOtherPeer, getRoom, removePeer } from "../pairing/rooms.ts";
import { parseMessage } from "../proto/types.ts";

export interface SignalWsData {
  code: string;
}

const SIGNALING_KINDS = new Set([
  "session.create",
  "session.join",
  "session.leave",
  "sdp.offer",
  "sdp.answer",
  "ice.candidate",
]);

type SignalSocket = ServerWebSocket<SignalWsData>;

function sendError(
  ws: SignalSocket,
  code: "room-full" | "expired" | "unknown",
  message: string,
): void {
  ws.send(
    JSON.stringify({
      kind: "relay.error",
      code,
      message,
    }),
  );
}

export const websocket: WebSocketHandler<SignalWsData> = {
  open(ws) {
    const code = ws.data.code;
    const room = getRoom(code);
    if (!room) {
      sendError(ws, "room-full", "unknown pairing code");
      ws.close(4401, "unknown code");
      return;
    }
    const result = addPeer(code, ws);
    if (!result.ok) {
      const errCode = result.errorCode === "expired" ? "expired" : "room-full";
      sendError(ws, errCode, result.message);
      ws.close(4403, result.errorCode);
      return;
    }
    if (result.role === "second") {
      const first = getOtherPeer(code, ws);
      if (first) {
        first.send(JSON.stringify({ kind: "session.join", code }));
      }
    }
  },

  message(ws, raw) {
    const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      logger.warn("signal: non-json frame dropped");
      return;
    }
    const msg = parseMessage(parsed);
    if (!msg) {
      logger.warn("signal: invalid frame shape dropped");
      return;
    }
    if (!SIGNALING_KINDS.has(msg.kind)) {
      logger.warn("signal: non-signaling kind dropped", { kind: msg.kind });
      return;
    }
    const other = getOtherPeer(ws.data.code, ws);
    if (other) {
      other.send(JSON.stringify(msg));
    }
  },

  close(ws) {
    const { otherPeer } = removePeer(ws.data.code, ws);
    if (otherPeer) {
      otherPeer.send(JSON.stringify({ kind: "session.leave", code: ws.data.code }));
    }
  },
};
