import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { _reset, _setRateLimit } from "../../src/relay/buffers.ts";
import { resetBuffers } from "../../src/relay/route.ts";
import { closeQuiet, expectNoMessage, nextMessage, openWs } from "./helpers.ts";

const TID = "00000000-0000-4000-8000-000000000001";

describe("WS /relay/:code per-IP rate limit", () => {
  beforeEach(() => {
    _reset();
    _setRateLimit(2, 0);
  });

  afterEach(() => {
    _reset();
    resetBuffers();
  });

  it("emits relay.error code rate-limited once the bucket is empty", async () => {
    const ws = await openWs("/relay/AAAAAA");

    ws.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: TID,
        seq: 0,
        total: 5,
        bytes: "AAAA",
      }),
    );
    ws.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: TID,
        seq: 1,
        total: 5,
        bytes: "AAAA",
      }),
    );
    ws.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: TID,
        seq: 2,
        total: 5,
        bytes: "AAAA",
      }),
    );

    let sawRateLimited = false;
    for (let i = 0; i < 3; i++) {
      const raw = await nextMessage(ws, 1000);
      const msg = JSON.parse(raw) as { kind: string; code?: string };
      if (msg.kind === "relay.error" && msg.code === "rate-limited") {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
    closeQuiet(ws);
  });

  it("does not rate-limit acks even when the chunk bucket is empty", async () => {
    _setRateLimit(0, 0);
    const ws = await openWs("/relay/BBBBBB");

    ws.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: TID,
        seq: 0,
        total: 1,
        bytes: "AAAA",
      }),
    );

    const chunkErrRaw = await nextMessage(ws, 1000);
    const chunkErr = JSON.parse(chunkErrRaw) as { kind: string; code: string };
    expect(chunkErr.kind).toBe("relay.error");
    expect(chunkErr.code).toBe("rate-limited");

    ws.send(
      JSON.stringify({
        kind: "relay.ack",
        transferId: TID,
        seq: 0,
      }),
    );

    await expectNoMessage(ws, 300);
    closeQuiet(ws);
  });
});
