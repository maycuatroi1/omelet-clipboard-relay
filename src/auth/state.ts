import type { DeviceRegistration, RedirectKind } from "./google.ts";

// v1 stores PKCE state + the device-registration payload (passed at /start so
// /cb can insert the row) in process memory. The state string is the lookup
// key. A 10 minute TTL mirrors the cookie lifetime Arctic's docs recommend.
export interface AuthStateEntry {
  state: string;
  codeVerifier: string;
  kind: RedirectKind;
  device: DeviceRegistration;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, AuthStateEntry>();

export function saveAuthState(entry: AuthStateEntry): void {
  store.set(entry.state, entry);
}

// takeAuthState consumes the entry (single-use) and enforces the TTL.
export function takeAuthState(state: string): AuthStateEntry | undefined {
  const entry = store.get(state);
  if (!entry) return undefined;
  store.delete(state);
  if (Date.now() - entry.createdAt > TTL_MS) return undefined;
  return entry;
}

export function _resetAuthStateStore(): void {
  store.clear();
}
