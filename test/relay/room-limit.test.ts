import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  _reset,
  _setMaxRooms,
  appendChunk,
  bufferCount,
  getBuffer,
} from "../../src/relay/buffers.ts";

const TID = "00000000-0000-4000-8000-000000000001";

function codeFromIndex(i: number): string {
  const A = 65;
  return String.fromCharCode(A + ((i / 6) % 26), A + (i % 26), 65, 66, 67, 68);
}

describe("relay buffer concurrent-room cap", () => {
  beforeEach(() => {
    _reset();
    _setMaxRooms(3);
  });

  afterEach(() => {
    _reset();
  });

  it("allows up to MAX_RELAY_ROOMS concurrent rooms", () => {
    for (let i = 0; i < 3; i++) {
      const r = appendChunk(codeFromIndex(i), "127.0.0.1", {
        kind: "relay.chunk",
        transferId: TID,
        seq: 0,
        total: 1,
        bytes: "AAAA",
      });
      expect(r.ok).toBe(true);
    }
    expect(bufferCount()).toBe(3);
  });

  it("rejects the (MAX+1)-th distinct code with room-limit", () => {
    for (let i = 0; i < 3; i++) {
      appendChunk(codeFromIndex(i), "127.0.0.1", {
        kind: "relay.chunk",
        transferId: TID,
        seq: 0,
        total: 1,
        bytes: "AAAA",
      });
    }
    const r = appendChunk(codeFromIndex(99), "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 1,
      bytes: "AAAA",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("room-limit");
    expect(bufferCount()).toBe(3);
    expect(getBuffer(codeFromIndex(99))).toBeUndefined();
  });

  it("still accepts chunks for an existing room when at cap", () => {
    appendChunk(codeFromIndex(0), "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    appendChunk(codeFromIndex(1), "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    appendChunk(codeFromIndex(2), "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    const r = appendChunk(codeFromIndex(0), "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 1,
      total: 2,
      bytes: "AAAA",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.buffer.chunks.length).toBe(2);
  });
});
