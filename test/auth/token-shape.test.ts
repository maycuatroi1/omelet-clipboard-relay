import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { decodeProtectedHeader, jwtVerify } from "jose";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  issueRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "../../src/auth/token.ts";

// Harness seam `auth-token` (contracts.yaml). The consumer treats claims as
// opaque except sub, exp, devices. This test is the mechanical guard: if a
// future change adds a claim or changes the alg, this file fails first and
// the Dart consumer's parser is updated in lockstep.

const SECRET_A = "test-secret-a";
const SECRET_B = "different-secret-b";

process.env.JWT_SECRET = SECRET_A;
process.env.JWT_ISSUER = "https://relay.clip.omelet.test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

async function tamper(jwt: string): Promise<string> {
  const [headerEnc, payloadEnc, sigEnc] = jwt.split(".");
  const payloadJson = JSON.parse(atob(payloadEnc.replace(/-/g, "+").replace(/_/g, "/")));
  payloadJson.devices = ["tampered-device-id"];
  const tamperedPayload = btoa(JSON.stringify(payloadJson))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${headerEnc}.${tamperedPayload}.${sigEnc}`;
}

describe("access token shape (auth-token seam)", () => {
  it("has exactly the documented payload claims - no extras", async () => {
    process.env.JWT_SECRET = SECRET_A;
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const [, payloadEnc] = jwt.split(".");
    const payload = JSON.parse(atob(payloadEnc.replace(/-/g, "+").replace(/_/g, "/")));

    expect(Object.keys(payload).sort()).toEqual(
      ["aud", "devices", "exp", "iat", "iss", "sub"].sort(),
    );
    expect(payload.sub).toBe(USER_ID);
    expect(payload.devices).toEqual([DEVICE_ID]);
    expect(payload.iss).toBe("https://relay.clip.omelet.test");
    expect(payload.aud).toBe("https://relay.clip.omelet.test");
  });

  it("has an exp-iat window of exactly 15 minutes", async () => {
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const claims = await verifyAccessToken(jwt);
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  it("uses HS256 as the JWS algorithm", async () => {
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const header = decodeProtectedHeader(jwt);
    expect(header.alg).toBe("HS256");
  });

  it("verifies a valid token", async () => {
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const claims = await verifyAccessToken(jwt);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.devices).toEqual([DEVICE_ID]);
  });

  it("rejects a tampered token (signature mismatch)", async () => {
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const tampered = await tamper(jwt);
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    // Hand-build an expired token so we do not depend on fake timers.
    const { SignJWT } = await import("jose");
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = await new SignJWT({ devices: [DEVICE_ID] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("https://relay.clip.omelet.test")
      .setAudience("https://relay.clip.omelet.test")
      .setIssuedAt(past)
      .setExpirationTime(past + 60)
      .sign(new TextEncoder().encode(SECRET_A));
    await expect(verifyAccessToken(expired)).rejects.toThrow();
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.JWT_SECRET = SECRET_B;
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    process.env.JWT_SECRET = SECRET_A;
    await expect(verifyAccessToken(jwt)).rejects.toThrow();
  });

  it("also fails verification via jose directly when tampered", async () => {
    const jwt = await signAccessToken(USER_ID, [DEVICE_ID]);
    const tampered = await tamper(jwt);
    await expect(
      jwtVerify(tampered, new TextEncoder().encode(SECRET_A), {
        issuer: "https://relay.clip.omelet.test",
        audience: "https://relay.clip.omelet.test",
      }),
    ).rejects.toThrow();
  });
});

describe("refresh token helpers", () => {
  it("issues a 32-byte base64url token (43 chars, no padding)", () => {
    const token = issueRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashRefreshToken returns the SHA-256 hex of the token", () => {
    const token = "abc123";
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = crypto.createHash("sha256").update(token).digest("hex");
    expect(hash).toBe(expected);
  });

  it("does not issue the same token twice in a row", () => {
    const a = issueRefreshToken();
    const b = issueRefreshToken();
    expect(a).not.toBe(b);
  });
});
