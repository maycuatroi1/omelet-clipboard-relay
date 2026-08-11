import { fetchHandler, websocket } from "./app.ts";
import env from "./env.ts";
import logger from "./observability/logger.ts";

const server = Bun.serve({
  port: env.PORT,
  fetch: fetchHandler,
  websocket,
});

logger.info("relay listening", { port: server.port });

export { server };
