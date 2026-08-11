import { Hono } from "hono";
import type { AppBindings } from "../app.ts";
import { generateUniqueCode } from "../pairing/codes.ts";
import { createRoom, getRoom } from "../pairing/rooms.ts";

const session = new Hono<AppBindings>();

session.post("/", (c) => {
  let code: string;
  try {
    code = generateUniqueCode((cand) => getRoom(cand) !== undefined);
  } catch {
    return c.json({ error: "code-collision-exhausted" }, 503);
  }
  const room = createRoom(code);
  return c.json({ code, expires_at: room.expiresAt });
});

export default session;
