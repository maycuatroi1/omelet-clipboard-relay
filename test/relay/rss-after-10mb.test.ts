import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MAX_BUFFER_BYTES, _reset, _setRateLimit, getBuffer } from "../../src/relay/buffers.ts";
import { resetBuffers } from "../../src/relay/route.ts";
import { closeQuiet, openWs } from "./helpers.ts";

const TID = "00000000-0000-4000-8000-000000000001";

describe("relay RSS after 10 MB transfer + ACK", () => {
  beforeEach(() => {
    _reset();
    _setRateLimit(1_000_000, 1_000_000);
  });

  afterEach(() => {
    _reset();
    resetBuffers();
  });

  it("returns RSS to within 5% of baseline after driving a 10 MB transfer and ACK", async () => {
    if (typeof Bun === "undefined" || typeof Bun.gc !== "function") {
      return;
    }

    await warmHeap();
    await warmHeap();
    await warmHeap();
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      Bun.gc(true);
    }
    const baseline = process.memoryUsage().rss;

    const ws = await openWs("/relay/RRRRRR");

    const rawChunkBytes = 16_384;
    const totalChunks = Math.floor(MAX_BUFFER_BYTES / rawChunkBytes);
    const chunkB64 = Buffer.alloc(rawChunkBytes, 65).toString("base64");

    for (let i = 0; i < totalChunks; i++) {
      ws.send(
        JSON.stringify({
          kind: "relay.chunk",
          transferId: TID,
          seq: i,
          total: totalChunks,
          bytes: chunkB64,
        }),
      );
    }

    const fillDeadline = Date.now() + 10_000;
    while (Date.now() < fillDeadline) {
      const buf = getBuffer("RRRRRR");
      if (buf && buf.totalBytes >= MAX_BUFFER_BYTES) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const filled = getBuffer("RRRRRR");
    expect(filled).toBeDefined();
    expect(filled?.totalBytes).toBe(MAX_BUFFER_BYTES);

    ws.send(
      JSON.stringify({
        kind: "relay.ack",
        transferId: TID,
        seq: totalChunks - 1,
      }),
    );

    const ackDeadline = Date.now() + 5_000;
    while (Date.now() < ackDeadline) {
      if (!getBuffer("RRRRRR")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(getBuffer("RRRRRR")).toBeUndefined();

    closeQuiet(ws);
    await new Promise((resolve) => setTimeout(resolve, 200));

    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      Bun.gc(true);
    }

    const after = process.memoryUsage().rss;
    const drift = Math.abs(after - baseline) / baseline;
    expect(drift).toBeLessThan(0.05);
  }, 60_000);
});

async function warmHeap(): Promise<void> {
  const ws = await openWs("/relay/WARMUP");
  const rawChunkBytes = 16_384;
  const totalChunks = Math.floor(MAX_BUFFER_BYTES / rawChunkBytes);
  const chunkB64 = Buffer.alloc(rawChunkBytes, 65).toString("base64");
  for (let i = 0; i < totalChunks; i++) {
    ws.send(
      JSON.stringify({
        kind: "relay.chunk",
        transferId: "11111111-1111-4111-8111-111111111111",
        seq: i,
        total: totalChunks,
        bytes: chunkB64,
      }),
    );
  }
  const fillDeadline = Date.now() + 10_000;
  while (Date.now() < fillDeadline) {
    if (getBuffer("WARMUP")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  ws.send(
    JSON.stringify({
      kind: "relay.ack",
      transferId: "11111111-1111-4111-8111-111111111111",
      seq: totalChunks - 1,
    }),
  );
  const ackDeadline = Date.now() + 5_000;
  while (Date.now() < ackDeadline) {
    if (!getBuffer("WARMUP")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
