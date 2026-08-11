import { Hono } from "hono";
import type { AppBindings } from "../app.ts";
import {
  type RedirectKind,
  createAuthorizationURL,
  exchangeCode,
  generateCodeVerifier,
  generateState,
} from "../auth/google.ts";
import {
  consumeRefreshToken,
  revokeRefreshToken,
  saveRefreshToken,
} from "../auth/refresh-store.ts";
import { saveAuthState, takeAuthState } from "../auth/state.ts";
import { issueRefreshToken, signAccessToken } from "../auth/token.ts";
import { findOrCreateDevice, findOrCreateUser, listUserDevices } from "../db/queries.ts";

const VALID_PLATFORMS = new Set(["web", "windows", "macos", "ios", "android"]);

const auth = new Hono<AppBindings>();

// GET /auth/google/start?kind=hosted|loopback&device_name=...&platform=...&pubkey=...
// Generates state + PKCE code_verifier, stores them alongside the device-
// registration payload (so /cb can insert the device row), 302s to Google.
auth.get("/google/start", (c) => {
  const kindRaw = c.req.query("kind") ?? "hosted";
  if (kindRaw !== "hosted" && kindRaw !== "loopback") {
    return c.json({ error: "kind must be 'hosted' or 'loopback'" }, 400);
  }
  const kind = kindRaw as RedirectKind;

  const deviceName = c.req.query("device_name");
  const platform = c.req.query("platform");
  const pubkey = c.req.query("pubkey");
  if (!deviceName || !platform || !pubkey) {
    return c.json({ error: "device_name, platform and pubkey are required" }, 400);
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return c.json({ error: `platform must be one of: ${[...VALID_PLATFORMS].join(", ")}` }, 400);
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  saveAuthState({
    state,
    codeVerifier,
    kind,
    device: { name: deviceName, platform, pubkey },
    createdAt: Date.now(),
  });

  const url = createAuthorizationURL({ kind, state, codeVerifier });
  return c.redirect(url.toString(), 302);
});

// GET /auth/google/cb?code=...&state=...
// Exchanges the code, finds-or-creates the user by google_sub, registers the
// device row, issues access JWT (15 min) + rotating refresh token, redirects
// to the app with both tokens in the URL fragment (never in the querystring,
// because fragments are not logged by browsers/proxies).
auth.get("/google/cb", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "code and state are required" }, 400);

  const entry = takeAuthState(state);
  if (!entry) return c.json({ error: "invalid or expired state" }, 400);

  let profile: { sub: string; email: string };
  try {
    profile = await exchangeCode(code, entry.codeVerifier, entry.kind);
  } catch {
    return c.json({ error: "code exchange failed" }, 502);
  }

  const user = await findOrCreateUser(profile.sub, profile.email);
  const device = await findOrCreateDevice(
    user.id,
    entry.device.name,
    entry.device.platform,
    entry.device.pubkey,
  );

  const accessToken = await signAccessToken(user.id, [device.id]);
  const refreshToken = issueRefreshToken();
  saveRefreshToken(refreshToken, user.id);

  const target = buildRedirectTarget(entry.kind, { accessToken, refreshToken, state });
  return c.redirect(target, 302);
});

// POST /auth/refresh  { refresh_token }
// Validates the hash + TTL, rotates the refresh token, returns a fresh pair.
auth.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = (body as { refresh_token?: string } | null)?.refresh_token;
  if (!token) return c.json({ error: "refresh_token required" }, 400);

  const userId = consumeRefreshToken(token);
  if (!userId) return c.json({ error: "invalid refresh token" }, 401);

  const userDevices = await listUserDevices(userId);
  const accessToken = await signAccessToken(
    userId,
    userDevices.map((d) => d.id),
  );
  const refreshToken = issueRefreshToken();
  saveRefreshToken(refreshToken, userId);

  return c.json({ access_token: accessToken, refresh_token: refreshToken });
});

// POST /auth/revoke  { refresh_token }
// Idempotent: deleting a missing token is still a 204.
auth.post("/revoke", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = (body as { refresh_token?: string } | null)?.refresh_token;
  if (token) revokeRefreshToken(token);
  return c.body(null, 204);
});

function buildRedirectTarget(
  kind: RedirectKind,
  params: { accessToken: string; refreshToken: string; state: string },
): string {
  const base = kind === "loopback" ? loopbackOrigin() : hostedOrigin();
  const fragment = `access_token=${encodeURIComponent(params.accessToken)}&refresh_token=${encodeURIComponent(params.refreshToken)}&state=${encodeURIComponent(params.state)}`;
  return `${base}#${fragment}`;
}

function loopbackOrigin(): string {
  const port = process.env.GOOGLE_LOOPBACK_PORT ?? "8788";
  return `http://127.0.0.1:${port}/cb`;
}

function hostedOrigin(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? "/";
}

export default auth;
