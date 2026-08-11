import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { _resetRefreshStore } from "../../src/auth/refresh-store.ts";
import { _resetAuthStateStore } from "../../src/auth/state.ts";
import { getDb } from "../../src/db/client.ts";
import { devices, users } from "../../src/db/schema.ts";

// Set env BEFORE importing app.ts so the auth modules see the right values
// when their routes execute. DATABASE_URL must point at the running postgres
// container (compose.yaml, step 5).
process.env.DATABASE_URL = "postgres://clipboard:clipboard@localhost:5432/clipboard";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "https://relay.example.test/auth/done";
process.env.GOOGLE_LOOPBACK_PORT = "8788";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.JWT_ISSUER = "https://relay.clip.omelet.test";

const { default: app } = await import("../../src/app.ts");

const ORIGINAL_FETCH = globalThis.fetch;

interface MockProfile {
  sub: string;
  email: string;
}

// Google is mocked at the fetch boundary. Arctic POSTs to the token endpoint
// with a Request object; the userinfo call in google.ts sends a plain string
// URL. Both shapes are intercepted here; any other URL falls through.
function installGoogleMock(profile: MockProfile): void {
  const mock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock-google-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email",
          id_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJnb29nbGUtc3ViIn0.signature",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
      return new Response(JSON.stringify({ sub: profile.sub, email: profile.email }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return ORIGINAL_FETCH(input, init);
  };
  globalThis.fetch = mock as typeof globalThis.fetch;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

async function resetDb(): Promise<void> {
  const db = getDb();
  await db.execute(sql`TRUNCATE TABLE users CASCADE`);
}

function parseFragment(location: string): URLSearchParams {
  const hashIdx = location.indexOf("#");
  expect(hashIdx).toBeGreaterThan(-1);
  return new URLSearchParams(location.slice(hashIdx + 1));
}

// Drive /start -> /cb. Returns the access+refresh tokens from the redirect
// fragment, plus the device row that landed in postgres.
async function driveFlow(opts: {
  kind: "hosted" | "loopback";
  deviceName: string;
  platform: string;
  pubkey: string;
  googleSub: string;
  googleEmail: string;
}): Promise<{ accessToken: string; refreshToken: string; state: string; location: string }> {
  installGoogleMock({ sub: opts.googleSub, email: opts.googleEmail });

  const startUrl =
    `/auth/google/start?kind=${opts.kind}` +
    `&device_name=${encodeURIComponent(opts.deviceName)}` +
    `&platform=${opts.platform}` +
    `&pubkey=${encodeURIComponent(opts.pubkey)}`;
  const startRes = await app.request(startUrl);
  expect(startRes.status).toBe(302);
  const consentUrl = startRes.headers.get("location") ?? "";
  const consent = new URL(consentUrl);
  const state = consent.searchParams.get("state") ?? "";

  const cbRes = await app.request(`/auth/google/cb?code=mock-code&state=${state}`);
  expect(cbRes.status).toBe(302);
  const location = cbRes.headers.get("location") ?? "";
  const frag = parseFragment(location);

  restoreFetch();
  return {
    accessToken: frag.get("access_token") ?? "",
    refreshToken: frag.get("refresh_token") ?? "",
    state: frag.get("state") ?? "",
    location,
  };
}

describe("auth flow: /auth/google -> /auth/refresh -> /auth/revoke", () => {
  beforeAll(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    _resetAuthStateStore();
    _resetRefreshStore();
    await resetDb();
  });

  afterEach(() => {
    restoreFetch();
  });

  afterAll(async () => {
    restoreFetch();
    await resetDb();
  });

  it("creates the user on first sign-in and finds them on second (no dupes)", async () => {
    const db = getDb();

    await driveFlow({
      kind: "hosted",
      deviceName: "Laptop",
      platform: "windows",
      pubkey: "pk-1",
      googleSub: "google-sub-aaa",
      googleEmail: "a@example.test",
    });
    let allUsers = await db.select().from(users);
    expect(allUsers.length).toBe(1);
    expect(allUsers[0].googleSub).toBe("google-sub-aaa");
    const firstUserId = allUsers[0].id;

    await driveFlow({
      kind: "hosted",
      deviceName: "Laptop",
      platform: "windows",
      pubkey: "pk-1",
      googleSub: "google-sub-aaa",
      googleEmail: "a@example.test",
    });
    allUsers = await db.select().from(users);
    expect(allUsers.length).toBe(1);
    expect(allUsers[0].id).toBe(firstUserId);
  });

  it("registers a device row with the supplied pubkey", async () => {
    const db = getDb();

    await driveFlow({
      kind: "hosted",
      deviceName: "Desktop",
      platform: "macos",
      pubkey: "pk-device-pubkey-xyz",
      googleSub: "google-sub-bbb",
      googleEmail: "b@example.test",
    });

    const allDevices = await db.select().from(devices);
    expect(allDevices.length).toBe(1);
    expect(allDevices[0].pubkey).toBe("pk-device-pubkey-xyz");
    expect(allDevices[0].platform).toBe("macos");
    expect(allDevices[0].name).toBe("Desktop");
  });

  it("issues an access token with the device id in the devices claim", async () => {
    const db = getDb();
    const { accessToken } = await driveFlow({
      kind: "hosted",
      deviceName: "Phone",
      platform: "ios",
      pubkey: "pk-2",
      googleSub: "google-sub-ccc",
      googleEmail: "c@example.test",
    });
    const [, payloadEnc] = accessToken.split(".");
    const payload = JSON.parse(atob(payloadEnc.replace(/-/g, "+").replace(/_/g, "/")));

    const inserted = await db.select().from(devices);
    expect(inserted.length).toBe(1);
    expect(payload.devices).toEqual([inserted[0].id]);
  });

  it("rotates the refresh token: a refresh issues a new pair and invalidates the old one", async () => {
    const { refreshToken: first } = await driveFlow({
      kind: "hosted",
      deviceName: "Box",
      platform: "android",
      pubkey: "pk-3",
      googleSub: "google-sub-ddd",
      googleEmail: "d@example.test",
    });
    expect(first.length).toBeGreaterThan(0);

    const refresh1 = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: first }),
    });
    expect(refresh1.status).toBe(200);
    const body1 = (await refresh1.json()) as { access_token: string; refresh_token: string };
    expect(body1.access_token).toBeTruthy();
    expect(body1.refresh_token).toBeTruthy();
    expect(body1.refresh_token).not.toBe(first);

    const refreshAgainWithOld = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: first }),
    });
    expect(refreshAgainWithOld.status).toBe(401);
  });

  it("/auth/revoke invalidates the refresh token", async () => {
    const { refreshToken } = await driveFlow({
      kind: "hosted",
      deviceName: "Tab",
      platform: "web",
      pubkey: "pk-4",
      googleSub: "google-sub-eee",
      googleEmail: "e@example.test",
    });

    const revokeRes = await app.request("/auth/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(revokeRes.status).toBe(204);

    const afterRevoke = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("uses http://127.0.0.1:<port>/cb as the loopback redirect_uri", async () => {
    installGoogleMock({ sub: "google-sub-ggg", email: "g@example.test" });
    const startRes = await app.request(
      "/auth/google/start?kind=loopback&device_name=L&platform=windows&pubkey=pk-loopback",
    );
    expect(startRes.status).toBe(302);
    const location = startRes.headers.get("location") ?? "";
    const consent = new URL(location);
    expect(consent.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8788/cb");
    restoreFetch();
  });

  it("hosted start uses GOOGLE_REDIRECT_URI as the redirect_uri", async () => {
    installGoogleMock({ sub: "google-sub-hhh", email: "h@example.test" });
    const startRes = await app.request(
      "/auth/google/start?kind=hosted&device_name=W&platform=web&pubkey=pk-hosted",
    );
    expect(startRes.status).toBe(302);
    const location = startRes.headers.get("location") ?? "";
    const consent = new URL(location);
    expect(consent.searchParams.get("redirect_uri")).toBe("https://relay.example.test/auth/done");
    restoreFetch();
  });

  it("rejects an unknown platform at /start", async () => {
    const res = await app.request(
      "/auth/google/start?kind=hosted&device_name=X&platform=linux&pubkey=pk",
    );
    expect(res.status).toBe(400);
  });

  it("rejects /cb with an unknown state (CSRF / replay guard)", async () => {
    const res = await app.request("/auth/google/cb?code=x&state=never-issued");
    expect(res.status).toBe(400);
  });
});
