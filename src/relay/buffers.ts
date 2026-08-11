import env from "../env.ts";
import type { ChunkMeta } from "../proto/types.ts";

export const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const SWEEP_INTERVAL_MS = 1_000;

export interface RelayChunkRecord {
  transferId: string;
  seq: number;
  total: number;
  bytes: string;
  meta?: ChunkMeta;
}

export interface RelayBuffer {
  code: string;
  chunks: RelayChunkRecord[];
  totalBytes: number;
  createdAt: number;
  expiresAt: number;
  ip: string;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export interface ChunkInput {
  kind?: "relay.chunk";
  transferId: string;
  seq: number;
  total: number;
  bytes: string;
  meta?: ChunkMeta;
}

let ttlMs: number = env.RELAY_BUFFER_TTL_MS;
let maxRooms: number = env.MAX_RELAY_ROOMS;
let rateCapacity: number = env.RELAY_RATE_LIMIT_CAPACITY;
let rateRate: number = env.RELAY_RATE_LIMIT_RATE;
let now: () => number = () => Date.now();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

const buffers = new Map<string, RelayBuffer>();
const ipBuckets = new Map<string, TokenBucket>();

export function _setTtl(ms: number): void {
  ttlMs = ms;
}

export function _setMaxRooms(n: number): void {
  maxRooms = n;
}

export function _setRateLimit(capacity: number, rate: number): void {
  rateCapacity = capacity;
  rateRate = rate;
  ipBuckets.clear();
}

export function _setClock(fn: () => number): void {
  now = fn;
}

export function _reset(): void {
  buffers.clear();
  ipBuckets.clear();
  ttlMs = env.RELAY_BUFFER_TTL_MS;
  maxRooms = env.MAX_RELAY_ROOMS;
  rateCapacity = env.RELAY_RATE_LIMIT_CAPACITY;
  rateRate = env.RELAY_RATE_LIMIT_RATE;
  now = () => Date.now();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

export function bufferCount(): number {
  return buffers.size;
}

export function getBuffer(code: string): RelayBuffer | undefined {
  return buffers.get(code);
}

export type AppendResult =
  | { ok: true; buffer: RelayBuffer }
  | { ok: false; errorCode: "over-cap" | "room-limit"; totalBytes: number };

export function appendChunk(code: string, ip: string, chunk: ChunkInput): AppendResult {
  const decoded = decodedByteLength(chunk.bytes);
  const existing = buffers.get(code);
  if (existing) {
    if (existing.totalBytes + decoded > MAX_BUFFER_BYTES) {
      buffers.delete(code);
      return { ok: false, errorCode: "over-cap", totalBytes: existing.totalBytes + decoded };
    }
    existing.chunks.push({ ...chunk });
    existing.totalBytes += decoded;
    existing.expiresAt = now() + ttlMs;
    return { ok: true, buffer: existing };
  }

  if (buffers.size >= maxRooms) {
    return { ok: false, errorCode: "room-limit", totalBytes: 0 };
  }

  if (decoded > MAX_BUFFER_BYTES) {
    return { ok: false, errorCode: "over-cap", totalBytes: decoded };
  }

  const buffer: RelayBuffer = {
    code,
    chunks: [{ ...chunk }],
    totalBytes: decoded,
    createdAt: now(),
    expiresAt: now() + ttlMs,
    ip,
  };
  buffers.set(code, buffer);
  return { ok: true, buffer };
}

export function ackBuffer(code: string, transferId: string, seq: number): boolean {
  const buffer = buffers.get(code);
  if (!buffer) return false;
  const head = buffer.chunks.find((c) => c.transferId === transferId);
  if (!head) return false;
  if (seq >= head.total - 1) {
    buffers.delete(code);
    return true;
  }
  return false;
}

export function cancelBuffer(code: string, _transferId: string): boolean {
  return buffers.delete(code);
}

export function checkRateLimit(ip: string): boolean {
  const t = now();
  let bucket = ipBuckets.get(ip);
  if (!bucket) {
    bucket = { tokens: rateCapacity, lastRefill: t };
    ipBuckets.set(ip, bucket);
  }
  const elapsedSec = Math.max(0, (t - bucket.lastRefill) / 1000);
  bucket.tokens = Math.min(rateCapacity, bucket.tokens + elapsedSec * rateRate);
  bucket.lastRefill = t;
  if (bucket.tokens < 1) {
    return false;
  }
  bucket.tokens -= 1;
  return true;
}

export function sweepExpired(): number {
  let removed = 0;
  const t = now();
  for (const [code, buffer] of buffers) {
    if (t >= buffer.expiresAt) {
      buffers.delete(code);
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

function decodedByteLength(base64: string): number {
  const len = base64.length;
  let padding = 0;
  if (len > 0 && base64[len - 1] === "=") padding++;
  if (len > 1 && base64[len - 2] === "=") padding++;
  return Math.floor((len * 3) / 4) - padding;
}
