import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  MAX_BUFFER_BYTES,
  _reset,
  _setRateLimit,
  appendChunk,
  getBuffer,
} from "../../src/relay/buffers.ts";

const TID = "00000000-0000-4000-8000-000000000001";

describe("relay buffer over-cap rejection", () => {
  beforeEach(() => {
    _reset();
    _setRateLimit(1_000_000, 1_000_000);
  });

  afterEach(() => {
    _reset();
  });

  it("rejects a chunk that would push total over 10 MB and deletes the room buffer", () => {
    const halfBytes = Math.floor(MAX_BUFFER_BYTES / 2) + 1_000;
    const halfB64 = chunkOf(halfBytes);
    const r1 = appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 3,
      bytes: halfB64,
    });
    expect(r1.ok).toBe(true);

    const r2 = appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 1,
      total: 3,
      bytes: halfB64,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errorCode).toBe("over-cap");
      expect(r2.totalBytes).toBeGreaterThan(MAX_BUFFER_BYTES);
    }
    expect(getBuffer("AAAAAA")).toBeUndefined();
  });

  it("rejects a single chunk larger than the cap", () => {
    const tooBig = chunkOf(MAX_BUFFER_BYTES + 1);
    const r = appendChunk("BBBBBB", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 1,
      bytes: tooBig,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("over-cap");
    expect(getBuffer("BBBBBB")).toBeUndefined();
  });

  it("accepts a transfer exactly at the cap", () => {
    const exact = chunkOf(MAX_BUFFER_BYTES);
    const r = appendChunk("CCCCCC", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 1,
      bytes: exact,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.buffer.totalBytes).toBe(MAX_BUFFER_BYTES);
  });
});

function chunkOf(rawBytes: number): string {
  const buf = Buffer.alloc(rawBytes, 65);
  return buf.toString("base64");
}
