import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "../../db/client";
import { users } from "../../db/schema";
const derive = promisify(scrypt);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(128);
export const registrationSchema = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema });
export function developmentAccountsAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.DEV_ACCOUNT_AUTH_ENABLED === "true" && env.ETSY_ADAPTER === "fixtures";
}
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64) as Buffer;
  return `scrypt-v1:${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const match = /^scrypt-v1:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(stored);
  if (!match) return false;
  const hash = await derive(password, match[1], 64) as Buffer;
  return timingSafeEqual(hash, Buffer.from(match[2], "hex"));
}
// Only public identity fields leave this boundary. No session/cookie implementation lives here.
export async function registerDevelopmentAccount(db: DbExecutor, raw: unknown) {
  if (!developmentAccountsAllowed()) throw new Error("REGISTRATION_UNAVAILABLE");
  const data = registrationSchema.parse(raw);
  const passwordHash = await hashPassword(data.password);
  const [created] = await db.insert(users).values({ id: `email:${randomUUID()}`, name: data.name, email: data.email, passwordHash }).onConflictDoNothing({ target: users.email }).returning({ id: users.id, name: users.name, email: users.email });
  if (created) return created;
  // Replay is allowed only after proving possession of the existing password; never overwrite it.
  const existing = await authenticateDevelopmentAccount(db, { email: data.email, password: data.password });
  if (!existing) throw new Error("ACCOUNT_CREATION_FAILED");
  return existing;
}
export async function authenticateDevelopmentAccount(db: DbExecutor, raw: unknown) {
  if (!developmentAccountsAllowed()) return null;
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse(raw);
  if (!parsed.success) return null;
  const [row] = await db.select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.email, parsed.data.email));
  // Do comparable derivation work for absent users; errors remain generic at the UI boundary.
  const dummy = "scrypt-v1:" + "0".repeat(32) + ":" + "0".repeat(128);
  const valid = await verifyPassword(parsed.data.password, row?.passwordHash ?? dummy);
  return row?.passwordHash && valid ? { id: row.id, name: row.name, email: row.email } : null;
}
