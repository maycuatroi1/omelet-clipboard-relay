import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { Hono } from "hono";
import env from "./env.ts";
import { CODE_REGEX } from "./pairing/codes.ts";
import { startSweepTimer } from "./pairing/rooms.ts";
import { startSweepTimer as startRelaySweepTimer } from "./relay/buffers.ts";
import { type RelayWsData, websocket as relayWebsocket } from "./relay/route.ts";
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
const RELAY_PREFIX = "/relay/";

type AppWsData = SignalWsData & {
  route?: "signal" | "relay";
  ip?: string;
};

function extractIp(req: Request, server: Server<SignalWsData>): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const addr = server.requestIP(req);
  return addr?.address ?? "unknown";
}

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
    const data = { code, route: "signal" } as SignalWsData;
    if (server.upgrade(req, { data })) return undefined;
    return new Response("Upgrade failed", { status: 400 });
  }

  if (url.pathname.startsWith(RELAY_PREFIX)) {
    const code = url.pathname.slice(RELAY_PREFIX.length);
    if (!CODE_REGEX.test(code)) {
      return new Response("invalid pairing code", { status: 404 });
    }
    const ip = extractIp(req, server);
    const data = { code, route: "relay", ip } as SignalWsData;
    if (server.upgrade(req, { data })) return undefined;
    return new Response("Upgrade failed", { status: 400 });
  }

  return app.fetch(req);
}

const websocket: WebSocketHandler<SignalWsData> = {
  open(ws) {
    const data = ws.data as AppWsData;
    if (data.route === "relay") {
      const rws = ws as unknown as ServerWebSocket<RelayWsData>;
      relayWebsocket.open?.(rws);
    } else {
      signalWebsocket.open?.(ws);
    }
  },
  message(ws, msg) {
    const data = ws.data as AppWsData;
    if (data.route === "relay") {
      const rws = ws as unknown as ServerWebSocket<RelayWsData>;
      relayWebsocket.message?.(rws, msg);
    } else {
      signalWebsocket.message?.(ws, msg);
    }
  },
  close(ws, code, reason) {
    const data = ws.data as AppWsData;
    if (data.route === "relay") {
      const rws = ws as unknown as ServerWebSocket<RelayWsData>;
      relayWebsocket.close?.(rws, code, reason);
    } else {
      signalWebsocket.close?.(ws, code, reason);
    }
  },
};

export { websocket };
export type { SignalWsData };

startSweepTimer();
startRelaySweepTimer();

export default app;
