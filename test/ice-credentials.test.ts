import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";

// Set the env the route reads BEFORE the dynamic import triggers app.ts -> env.ts
// (and before the route's request-time reads). Using dynamic import here so the
// test's process.env assignments win against module-cache ordering across files.
const TEST_SECRET = "test-static-auth-secret";
const TURN_HOST = "turn.clip.omelet.tech";
process.env.TURN_STATIC_AUTH_SECRET = TEST_SECRET;
process.env.TURN_HOST = TURN_HOST;

const { default: app } = await import("../src/app.ts");

type IceResponse = {
  ttl: number;
  expires: number;
  username: string;
  credential: string;
  servers: { urls: string }[];
};

function recomputeCredential(username: string, secret: string = TEST_SECRET): string {
  return crypto.createHmac("sha1", secret).update(username).digest("base64");
}

describe("GET /ice", () => {
  it("returns the documented server list: stun, turn udp, turn tcp, turns tcp 443", async () => {
    const res = await app.request("/ice");
    expect(res.status).toBe(200);
    const body = (await res.json()) as IceResponse;

    expect(body.ttl).toBe(600);
    expect(typeof body.expires).toBe("number");
    expect(typeof body.username).toBe("string");
    expect(typeof body.credential).toBe("string");
    expect(Array.isArray(body.servers)).toBe(true);

    const urls = body.servers.map((s) => s.urls);
    expect(urls).toContain(`stun:${TURN_HOST}:3478`);
    expect(urls).toContain(`turn:${TURN_HOST}:3478?transport=udp`);
    expect(urls).toContain(`turn:${TURN_HOST}:3478?transport=tcp`);
    expect(urls).toContain(`turns:${TURN_HOST}:443?transport=tcp`);
  });

  it("formats username as <expiry>:<random-base64url-16>", async () => {
    const res = await app.request("/ice");
    const body = (await res.json()) as IceResponse;

    expect(body.username).toMatch(/^\d{10}:[A-Za-z0-9_-]{16}$/);
    const [expiryStr] = body.username.split(":");
    expect(Number(expiryStr)).toBe(body.expires);
  });

  it("returns credential equal to base64(HMAC-SHA1(username, TURN_STATIC_AUTH_SECRET))", async () => {
    const res = await app.request("/ice");
    const body = (await res.json()) as IceResponse;

    expect(body.credential).toBe(recomputeCredential(body.username));
  });

  it("uses a TTL of exactly 600 seconds", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await app.request("/ice");
    const after = Math.floor(Date.now() / 1000);
    const body = (await res.json()) as IceResponse;

    expect(body.ttl).toBe(600);
    expect(body.expires).toBeGreaterThanOrEqual(before + 600);
    expect(body.expires).toBeLessThanOrEqual(after + 600);
  });

  it("returns a fresh random username on each call", async () => {
    const res1 = await app.request("/ice");
    const body1 = (await res1.json()) as IceResponse;
    const res2 = await app.request("/ice");
    const body2 = (await res2.json()) as IceResponse;

    expect(body1.username).not.toBe(body2.username);
  });
});
