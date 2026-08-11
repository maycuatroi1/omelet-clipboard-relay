import app from "./app.ts";
import env from "./env.ts";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

// biome-ignore lint/suspicious/noConsole: server entrypoint announcing its listen port
console.info(`relay listening on http://localhost:${server.port}`);

export { server };
