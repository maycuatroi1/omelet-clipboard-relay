import { hashRefreshToken } from "./token.ts";

// v1 stores refresh-token hashes in process memory keyed by SHA-256 hex. The
// schema from step 5 has no refresh-token column (intentionally - the plan
// permits process memory for v1) so rotation is a delete-then-insert on this
// map. Rotation is mandatory: /auth/refresh always consumes the presented
// token and issues a fresh one.
export interface RefreshRecord {
  userId: string;
  createdAt: number;
}

const store = new Map<string, RefreshRecord>();

function ttlMs(): number {
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
  return days * 24 * 60 * 60 * 1000;
}

export function saveRefreshToken(token: string, userId: string): void {
  store.set(hashRefreshToken(token), { userId, createdAt: Date.now() });
}

// consumeRefreshToken validates, TTL-checks and deletes the token in one go.
// Returns the user id on success, undefined if missing/expired.
export function consumeRefreshToken(token: string): string | undefined {
  const rec = store.get(hashRefreshToken(token));
  if (!rec) return undefined;
  store.delete(hashRefreshToken(token));
  if (Date.now() - rec.createdAt > ttlMs()) return undefined;
  return rec.userId;
}

export function revokeRefreshToken(token: string): boolean {
  return store.delete(hashRefreshToken(token));
}

export function _resetRefreshStore(): void {
  store.clear();
}
