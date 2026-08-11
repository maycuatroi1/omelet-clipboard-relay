import type { Server } from "bun";
import { Hono } from "hono";
import env from "./env.ts";
import { CODE_REGEX } from "./pairing/codes.ts";
import { startSweepTimer } from "./pairing/rooms.ts";
import auth from "./routes/auth.ts";
import health from "./routes/health.ts";
import ice from "./routes/ice.ts";
import session from "./routes/session.ts";
import { type SignalWsData, websocket as signalWebsocket } from "./routes/signal.ts";

async function readVersion(): Promise<string> {
  if (env.APP_VERSION) {
    return env.APP_VERSION;
  }
  try {
    const pkg = await Bun.file("package.json").json();
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface AppBindings {
  Variables: {
    version: string;
    commit: string | undefined;
  };
}

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
  c.set("version", await readVersion());
  c.set("commit", env.COMMIT_SHA);
  await next();
});

app.route("/health", health);
app.route("/ice", ice);
app.route("/auth", auth);
app.route("/session", session);

const SIGNAL_PREFIX = "/signal/";

export function fetchHandler(
  req: Request,
  server: Server<SignalWsData>,
): Response | Promise<Response> | undefined {
  const url = new URL(req.url);
  if (url.pathname.startsWith(SIGNAL_PREFIX)) {
    const code = url.pathname.slice(SIGNAL_PREFIX.length);
    if (!CODE_REGEX.test(code)) {
      return new Response("invalid pairing code", { status: 404 });
    }
    if (server.upgrade(req, { data: { code } })) return undefined;
    return new Response("Upgrade failed", { status: 400 });
  }
  return app.fetch(req);
}

export const websocket = signalWebsocket;
export type { SignalWsData };

startSweepTimer();

export default app;
