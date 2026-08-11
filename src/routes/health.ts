import { Hono } from "hono";
import type { AppBindings } from "../app.ts";

const health = new Hono<AppBindings>();

health.get("/", (c) => {
  return c.json(
    {
      status: "ok",
      version: c.get("version"),
      commit: c.get("commit"),
    },
    200,
  );
});

export default health;
