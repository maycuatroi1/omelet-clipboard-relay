import { Google, generateCodeVerifier, generateState } from "arctic";

// Arctic wraps the OAuth 2.0 authorization-code flow with PKCE (S256). The
// desktop client has no browser redirect target, so we accept two redirect
// URIs: a hosted URI for web/mobile and a 127.0.0.1 loopback URI for the
// desktop app's short-lived local listener (see plan step 6 note).
export type RedirectKind = "hosted" | "loopback";

export interface DeviceRegistration {
  name: string;
  platform: string;
  pubkey: string;
}

export interface StartAuthParams {
  kind: RedirectKind;
  state: string;
  codeVerifier: string;
}

export interface GoogleProfile {
  sub: string;
  email: string;
}

const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function loopbackRedirectUri(): string {
  const port = process.env.GOOGLE_LOOPBACK_PORT ?? "8788";
  return `http://127.0.0.1:${port}/cb`;
}

export function redirectUriFor(kind: RedirectKind): string {
  if (kind === "loopback") return loopbackRedirectUri();
  const hosted = process.env.GOOGLE_REDIRECT_URI;
  if (!hosted) throw new Error("GOOGLE_REDIRECT_URI not configured");
  return hosted;
}

function googleClient(kind: RedirectKind): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured");
  }
  return new Google(clientId, clientSecret, redirectUriFor(kind));
}

export function createAuthorizationURL(params: StartAuthParams): URL {
  return googleClient(params.kind).createAuthorizationURL(params.state, params.codeVerifier, [
    "openid",
    "profile",
    "email",
  ]);
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  kind: RedirectKind,
): Promise<GoogleProfile> {
  const tokens = await googleClient(kind).validateAuthorizationCode(code, codeVerifier);
  const accessToken = tokens.accessToken();
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo request failed: ${res.status}`);
  }
  const profile = (await res.json()) as { sub?: string; email?: string };
  if (!profile.sub) throw new Error("userinfo response missing sub");
  return { sub: profile.sub, email: profile.email ?? "" };
}

export { generateCodeVerifier, generateState };
