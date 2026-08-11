#!/usr/bin/env bun
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://clipboard:clipboard@localhost:5432/clipboard";

const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "migrations");

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // biome-ignore lint/suspicious/noConsole: CLI success output
  console.log(`migrate: schema applied from ${MIGRATIONS_FOLDER}`);
  await client.end();
  process.exit(0);
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: CLI error output
  console.error("migrate: failed", err);
  await client.end();
  process.exit(1);
}
