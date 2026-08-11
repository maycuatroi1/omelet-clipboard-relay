import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppBindings } from "../app.ts";

// TURN REST API (coturn `use-auth-secret`):
//   username   = "<expiry-unix-seconds>:<random>"
//   credential = base64( HMAC-SHA1(username, TURN_STATIC_AUTH_SECRET) )
// Coturn verifies ALLOCATE requests statelessly by recomputing the HMAC with
// the same shared secret. See harness/contracts.yaml `ice-config` and the
// invariant `no-static-turn-creds` - a Flutter bundle ships in the clear, so
// the secret MUST live server-side and credentials MUST be ephemeral.
//
// Secret and host are read at request time from process.env (rather than the
// cached snapshot in env.ts) so unit tests can control them without module
// cache gymnastics. env.ts still declares both for documentation/types.
const TTL_SECONDS = 600;
const DEFAULT_TURN_HOST = "turn.clip.omelet.tech";

const ice = new Hono<AppBindings>();

ice.get("/", (c) => {
  // TODO(step 6): require a Bearer JWT here once the auth-token seam lands.
  // Until then, allow unauthenticated calls so the route is unit-testable
  // and emit a warning so this does not silently ship as a public oracle.
  // biome-ignore lint/suspicious/noConsole: dev-mode warning until step 6 auth lands
  console.warn("GET /ice served without auth (step 6 not landed yet)");

  const secret = process.env.TURN_STATIC_AUTH_SECRET;
  if (!secret) {
    return c.json({ error: "TURN_STATIC_AUTH_SECRET not configured" }, 500);
  }
  const host = process.env.TURN_HOST ?? DEFAULT_TURN_HOST;

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const random = crypto.randomBytes(12).toString("base64url");
  const username = `${expiry}:${random}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");

  return c.json({
    ttl: TTL_SECONDS,
    expires: expiry,
    username,
    credential,
    servers: [
      { urls: `stun:${host}:3478` },
      { urls: `turn:${host}:3478?transport=udp` },
      { urls: `turn:${host}:3478?transport=tcp` },
      { urls: `turns:${host}:443?transport=tcp` },
    ],
  });
});

export default ice;
