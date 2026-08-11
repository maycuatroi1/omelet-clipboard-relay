import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

// Harness seam `auth-token`: short-lived (15 min) access JWT plus a rotating
// refresh token. The app treats every claim as opaque except sub, exp, devices.
// Anonymous sessions carry NO token. The payload claim set is fixed; do not add
// claims without updating contracts.yaml and the Dart consumer.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ALG = "HS256";

export interface AccessClaims {
  sub: string;
  devices: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return new TextEncoder().encode(secret);
}

// Read at call time (not via the env.ts snapshot) so unit tests can control it
// without module-cache gymnastics; mirrors the pattern in routes/ice.ts.
function issuer(): string {
  return process.env.JWT_ISSUER ?? "https://relay.clip.omelet.tech";
}

export async function signAccessToken(userId: string, deviceIds: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ devices: deviceIds })
    .setProtectedHeader({ alg: ALG })
    .setSubject(userId)
    .setIssuer(issuer())
    .setAudience(issuer())
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secretKey());
}

export async function verifyAccessToken(jwt: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(jwt, secretKey(), {
    issuer: issuer(),
    audience: issuer(),
  });
  return {
    sub: payload.sub ?? "",
    devices: Array.isArray(payload.devices) ? (payload.devices as string[]) : [],
    iss: payload.iss ?? "",
    aud: typeof payload.aud === "string" ? payload.aud : "",
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

export function issueRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
