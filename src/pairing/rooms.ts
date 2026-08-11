import type { Peer } from "./peer.ts";

const DEFAULT_TTL_MS = 300_000;
const SWEEP_INTERVAL_MS = 60_000;

export interface Room {
  code: string;
  peers: (Peer | null)[];
  createdAt: number;
  expiresAt: number;
  invalidated: boolean;
}

export type AddPeerResult =
  | { ok: true; peerIndex: number; role: "first" | "second" }
  | {
      ok: false;
      errorCode: "unknown" | "expired" | "room-full";
      message: string;
    };

const rooms = new Map<string, Room>();
let ttlMs = DEFAULT_TTL_MS;
let now: () => number = () => Date.now();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function _setTtl(ms: number): void {
  ttlMs = ms;
}

export function _setClock(fn: () => number): void {
  now = fn;
}

export function _reset(): void {
  rooms.clear();
  ttlMs = DEFAULT_TTL_MS;
  now = () => Date.now();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export function createRoom(code: string): Room {
  const room: Room = {
    code,
    peers: [null, null],
    createdAt: now(),
    expiresAt: now() + ttlMs,
    invalidated: false,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function roomCount(): number {
  return rooms.size;
}

export function addPeer(code: string, peer: Peer): AddPeerResult {
  const room = rooms.get(code);
  if (!room) {
    return { ok: false, errorCode: "unknown", message: "unknown pairing code" };
  }
  if (now() >= room.expiresAt) {
    rooms.delete(code);
    return { ok: false, errorCode: "expired", message: "pairing code expired" };
  }
  if (room.invalidated || (room.peers[0] !== null && room.peers[1] !== null)) {
    return { ok: false, errorCode: "room-full", message: "pairing code no longer accepting joins" };
  }
  let peerIndex = 0;
  if (room.peers[0] === null) {
    peerIndex = 0;
  } else {
    peerIndex = 1;
  }
  room.peers[peerIndex] = peer;
  const role: "first" | "second" = peerIndex === 0 ? "first" : "second";
  if (role === "second") {
    room.invalidated = true;
  }
  return { ok: true, peerIndex, role };
}

export function removePeer(code: string, peer: Peer): { otherPeer: Peer | null } {
  const room = rooms.get(code);
  if (!room) return { otherPeer: null };
  let wasInRoom = false;
  if (room.peers[0] === peer) {
    room.peers[0] = null;
    wasInRoom = true;
  } else if (room.peers[1] === peer) {
    room.peers[1] = null;
    wasInRoom = true;
  }
  if (!wasInRoom) return { otherPeer: null };
  const otherPeer = room.peers[0] ?? room.peers[1] ?? null;
  return { otherPeer };
}

export function getOtherPeer(code: string, peer: Peer): Peer | null {
  const room = rooms.get(code);
  if (!room) return null;
  if (room.peers[0] === peer) return room.peers[1];
  if (room.peers[1] === peer) return room.peers[0];
  return null;
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

export function sweepExpired(): number {
  let removed = 0;
  const t = now();
  for (const [code, room] of rooms) {
    if (t >= room.expiresAt) {
      rooms.delete(code);
      removed++;
    }
  }
  return removed;
}

export function startSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpired(), SWEEP_INTERVAL_MS);
  if (sweepTimer && typeof sweepTimer === "object" && "unref" in sweepTimer) {
    (sweepTimer as { unref: () => void }).unref();
  }
}

export function stopSweepTimer(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
