import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { _reset, ackBuffer, appendChunk, bufferCount, getBuffer } from "../../src/relay/buffers.ts";

const TID = "00000000-0000-4000-8000-000000000001";
const TID2 = "00000000-0000-4000-8000-000000000002";

describe("relay buffer ACK deletion", () => {
  beforeEach(() => {
    _reset();
  });

  afterEach(() => {
    _reset();
  });

  it("final cumulative ack (seq == total - 1) deletes the room buffer", () => {
    appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 3,
      bytes: "AAAA",
    });
    appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 1,
      total: 3,
      bytes: "AAAA",
    });
    appendChunk("AAAAAA", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 2,
      total: 3,
      bytes: "AAAA",
    });
    expect(getBuffer("AAAAAA")).toBeDefined();

    const deleted = ackBuffer("AAAAAA", TID, 2);
    expect(deleted).toBe(true);
    expect(getBuffer("AAAAAA")).toBeUndefined();
    expect(bufferCount()).toBe(0);
  });

  it("partial ack (seq < total - 1) keeps the room buffer", () => {
    appendChunk("BBBBBB", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 3,
      bytes: "AAAA",
    });
    appendChunk("BBBBBB", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 1,
      total: 3,
      bytes: "AAAA",
    });
    const deleted = ackBuffer("BBBBBB", TID, 0);
    expect(deleted).toBe(false);
    expect(getBuffer("BBBBBB")).toBeDefined();
  });

  it("ack for an unknown transferId does not delete", () => {
    appendChunk("CCCCCC", "127.0.0.1", {
      kind: "relay.chunk",
      transferId: TID,
      seq: 0,
      total: 1,
      bytes: "AAAA",
    });
    const deleted = ackBuffer("CCCCCC", TID2, 0);
    expect(deleted).toBe(false);
    expect(getBuffer("CCCCCC")).toBeDefined();
  });

  it("ack for an unknown code returns false without throwing", () => {
    expect(ackBuffer("ZZZZZZ", TID, 0)).toBe(false);
  });
});
