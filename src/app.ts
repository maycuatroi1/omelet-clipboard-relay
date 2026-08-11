import { Hono } from "hono";
import env from "./env.ts";
import health from "./routes/health.ts";
import ice from "./routes/ice.ts";

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

export default app;
