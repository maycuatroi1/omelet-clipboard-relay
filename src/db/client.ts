import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

// Lazy singleton. DATABASE_URL is read at first call so unit tests can set it
// after module load. `max: 1` matches the migrate script and avoids spawning
// a connection pool in tests.
let cached: ReturnType<typeof makeDb> | undefined;

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  const client = postgres(url, { max: 1 });
  return drizzle(client, { schema });
}

export function getDb(): ReturnType<typeof makeDb> {
  if (!cached) cached = makeDb();
  return cached;
}

export type Db = ReturnType<typeof makeDb>;
