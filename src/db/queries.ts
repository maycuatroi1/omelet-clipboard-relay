import { and, eq } from "drizzle-orm";
import { getDb } from "./client.ts";
import { devices, users } from "./schema.ts";

// findOrCreateUser matches on google_sub (UNIQUE in schema). Returns the
// existing row on second sign-in so the user id stays stable.
export async function findOrCreateUser(googleSub: string, email: string) {
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.googleSub, googleSub)).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(users).values({ googleSub, email }).returning();
  return created;
}

// findOrCreateDevice matches on (userId, pubkey). A device is identified by its
// public key, not its name - renaming the same key does not create a second row.
export async function findOrCreateDevice(
  userId: string,
  name: string,
  platform: string,
  pubkey: string,
) {
  const db = getDb();
  const existing = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.pubkey, pubkey)))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(devices).values({ userId, name, platform, pubkey }).returning();
  return created;
}

export async function listUserDevices(userId: string) {
  const db = getDb();
  return await db.select().from(devices).where(eq(devices.userId, userId));
}
