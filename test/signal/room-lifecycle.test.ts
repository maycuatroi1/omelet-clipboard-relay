import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Peer } from "../../src/pairing/peer.ts";
import {
  type AddPeerResult,
  _reset,
  _setClock,
  _setTtl,
  addPeer,
  createRoom,
  getRoom,
  removePeer,
  sweepExpired,
} from "../../src/pairing/rooms.ts";

class FakePeer implements Peer {
  code: string;
  inbox: string[] = [];
  closed = false;

  constructor(code: string) {
    this.code = code;
  }

  send(data: string): void {
    this.inbox.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

function expectRejectedRoomFull(r: AddPeerResult): void {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.errorCode).toBe("room-full");
  }
}

describe("room lifecycle", () => {
  beforeEach(() => {
    _reset();
    _setClock(() => 1000);
    _setTtl(300_000);
  });

  afterEach(() => {
    _reset();
  });

  it("first peer joins as 'first', second peer joins as 'second' and invalidates the code", () => {
    createRoom("ABCDEF");
    const a = new FakePeer("ABCDEF");
    const b = new FakePeer("ABCDEF");

    const r1 = addPeer("ABCDEF", a);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.role).toBe("first");
      expect(r1.peerIndex).toBe(0);
    }

    const r2 = addPeer("ABCDEF", b);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.role).toBe("second");
      expect(r2.peerIndex).toBe(1);
    }

    const room = getRoom("ABCDEF");
    expect(room?.invalidated).toBe(true);
  });

  it("code is single-use: a third joiner is rejected with room-full", () => {
    createRoom("ABCDEF");
    const a = new FakePeer("ABCDEF");
    const b = new FakePeer("ABCDEF");
    const c = new FakePeer("ABCDEF");

    expect(addPeer("ABCDEF", a).ok).toBe(true);
    expect(addPeer("ABCDEF", b).ok).toBe(true);

    const third = addPeer("ABCDEF", c);
    expectRejectedRoomFull(third);
    expect(c.closed).toBe(false);
  });

  it("an invalidated code rejects further joins even when a slot is free", () => {
    createRoom("ABCDEF");
    const a = new FakePeer("ABCDEF");
    const b = new FakePeer("ABCDEF");
    const c = new FakePeer("ABCDEF");

    addPeer("ABCDEF", a);
    addPeer("ABCDEF", b);
    removePeer("ABCDEF", b);

    expectRejectedRoomFull(addPeer("ABCDEF", c));
  });

  it("joining an unknown code returns errorCode 'unknown'", () => {
    const a = new FakePeer("GHIJKL");
    const r = addPeer("GHIJKL", a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("unknown");
  });

  it("joining an expired code returns errorCode 'expired' and deletes the room", () => {
    let t = 1000;
    _setClock(() => t);
    _setTtl(1000);
    createRoom("ABCDEF");
    t += 2000;
    const a = new FakePeer("ABCDEF");
    const r = addPeer("ABCDEF", a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("expired");
    expect(getRoom("ABCDEF")).toBeUndefined();
  });

  it("sweepExpired removes only expired rooms", () => {
    let t = 1000;
    _setClock(() => t);
    _setTtl(1000);
    createRoom("AAAAAA");
    createRoom("BBBBBB");
    t += 1500;
    createRoom("CCCCCC");
    t += 100;
    const removed = sweepExpired();
    expect(removed).toBe(2);
    expect(getRoom("AAAAAA")).toBeUndefined();
    expect(getRoom("BBBBBB")).toBeUndefined();
    expect(getRoom("CCCCCC")).toBeDefined();
  });

  it("removePeer returns the remaining peer so the caller can notify it", () => {
    createRoom("ABCDEF");
    const a = new FakePeer("ABCDEF");
    const b = new FakePeer("ABCDEF");
    addPeer("ABCDEF", a);
    addPeer("ABCDEF", b);
    const { otherPeer } = removePeer("ABCDEF", a);
    expect(otherPeer).toBe(b);
  });
});
