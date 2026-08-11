import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  _reset,
  _setClock,
  _setTtl,
  appendChunk,
  bufferCount,
  getBuffer,
  sweepExpired,
} from "../../src/relay/buffers.ts";

const TID = "00000000-0000-4000-8000-000000000001";

describe("relay buffer TTL expiry", () => {
  beforeEach(() => {
    _reset();
    const t = 1_000_000;
    _setClock(() => t);
    _setTtl(100);
  });

  afterEach(() => {
    _reset();
  });

  it("buffer is alive within TTL window", () => {
    appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    expect(getBuffer("AAAAAA")).toBeDefined();
    expect(bufferCount()).toBe(1);
  });

  it("sweepExpired removes a buffer past its expiresAt", () => {
    let t = 1_000_000;
    _setClock(() => t);
    _setTtl(100);
    appendChunk("BBBBBB", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    expect(getBuffer("BBBBBB")).toBeDefined();

    t += 200;
    _setClock(() => t);

    const removed = sweepExpired();
    expect(removed).toBe(1);
    expect(getBuffer("BBBBBB")).toBeUndefined();
    expect(bufferCount()).toBe(0);
  });

  it("sweepExpired leaves non-expired buffers alone", () => {
    let t = 1_000_000;
    _setClock(() => t);
    _setTtl(100);
    appendChunk("CCCCCC", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 2,
      bytes: "AAAA",
    });
    t += 50;
    _setClock(() => t);
    expect(sweepExpired()).toBe(0);
    expect(getBuffer("CCCCCC")).toBeDefined();
  });

  it("activity refreshes expiresAt (sliding TTL)", () => {
    let t = 1_000_000;
    _setClock(() => t);
    _setTtl(100);
    appendChunk("DDDDDD", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 3,
      bytes: "AAAA",
    });
    t += 80;
    _setClock(() => t);
    appendChunk("DDDDDD", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 1,
      total: 3,
      bytes: "AAAA",
    });
    t += 80;
    _setClock(() => t);
    expect(sweepExpired()).toBe(0);
    expect(getBuffer("DDDDDD")).toBeDefined();
    t += 80;
    _setClock(() => t);
    expect(sweepExpired()).toBe(1);
    expect(getBuffer("DDDDDD")).toBeUndefined();
  });
});
