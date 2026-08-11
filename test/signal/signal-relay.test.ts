import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { fetchHandler, websocket } from "../../src/app.ts";
import { _reset } from "../../src/pairing/rooms.ts";
import type { SignalWsData } from "../../src/routes/signal.ts";

let server: Bun.Server<SignalWsData>;
let httpBase: string;
let wsBase: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: fetchHandler, websocket });
  httpBase = `http://localhost:${server.port}`;
  wsBase = `ws://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  _reset();
});

afterEach(() => {
  _reset();
});

function opened(ws: WebSocket): Promise<void> {
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

async function openWs(path: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}${path}`);
  await opened(ws);
  return ws;
}

async function createCode(): Promise<string> {
  const res = await fetch(`${httpBase}/session`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string; expires_at: number };
  return body.code;
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
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

function expectNoMessage(ws: WebSocket, ms = 250): Promise<void> {
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

function closeQuiet(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
}

describe("POST /session", () => {
  it("returns a 6-char code over the unambiguous alphabet plus expires_at", async () => {
    const res = await fetch(`${httpBase}/session`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; expires_at: number };
    expect(body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(typeof body.expires_at).toBe("number");
    expect(body.expires_at).toBeGreaterThan(Date.now());
  });
});

describe("WS /signal/:code", () => {
  it("relays sdp.offer A->B and ice.candidate B->A", async () => {
    const code = await createCode();
    const a = await openWs(`/signal/${code}`);
    const b = await openWs(`/signal/${code}`);

    const joinRaw = await nextMessage(a);
    const join = JSON.parse(joinRaw) as { kind: string; code: string };
    expect(join.kind).toBe("session.join");
    expect(join.code).toBe(code);

    a.send(JSON.stringify({ kind: "sdp.offer", type: "offer", sdp: "v=0-offer" }));
    const offerRaw = await nextMessage(b);
    const offer = JSON.parse(offerRaw) as { kind: string; sdp: string };
    expect(offer.kind).toBe("sdp.offer");
    expect(offer.sdp).toBe("v=0-offer");

    b.send(
      JSON.stringify({
        kind: "ice.candidate",
        candidate: "candidate:842163049",
        sdpMid: "0",
        sdpMLineIndex: 0,
      }),
    );
    const candRaw = await nextMessage(a);
    const cand = JSON.parse(candRaw) as { kind: string; candidate: string };
    expect(cand.kind).toBe("ice.candidate");
    expect(cand.candidate).toBe("candidate:842163049");

    closeQuiet(a);
    closeQuiet(b);
  });

  it("rejects a third joiner with relay.error code room-full (double-join rejection)", async () => {
    const code = await createCode();
    const a = await openWs(`/signal/${code}`);
    const b = await openWs(`/signal/${code}`);
    await nextMessage(a);

    const c = await openWs(`/signal/${code}`);
    const errRaw = await nextMessage(c);
    const err = JSON.parse(errRaw) as { kind: string; code: string; message: string };
    expect(err.kind).toBe("relay.error");
    expect(err.code).toBe("room-full");

    closeQuiet(a);
    closeQuiet(b);
    closeQuiet(c);
  });

  it("drops invalid frame shapes silently", async () => {
    const code = await createCode();
    const a = await openWs(`/signal/${code}`);
    const b = await openWs(`/signal/${code}`);
    await nextMessage(a);

    a.send("not-json");
    await expectNoMessage(b);

    a.send(JSON.stringify({ kind: "session.create" }));
    await expectNoMessage(b);

    a.send(JSON.stringify({ kind: "relay.error", code: "internal", message: "x" }));
    await expectNoMessage(b);

    closeQuiet(a);
    closeQuiet(b);
  });

  it("notifies the remaining peer with session.leave on disconnect", async () => {
    const code = await createCode();
    const a = await openWs(`/signal/${code}`);
    const b = await openWs(`/signal/${code}`);
    await nextMessage(a);

    a.close();

    const leaveRaw = await nextMessage(b);
    const leave = JSON.parse(leaveRaw) as { kind: string; code: string };
    expect(leave.kind).toBe("session.leave");
    expect(leave.code).toBe(code);

    closeQuiet(b);
  });

  it("rejects an unknown code with relay.error before the socket settles", async () => {
    const c = await openWs("/signal/ZZZZZZ");
    const errRaw = await nextMessage(c);
    const err = JSON.parse(errRaw) as { kind: string; code: string };
    expect(err.kind).toBe("relay.error");
    expect(err.code).toBe("room-full");
    closeQuiet(c);
  });
});
