import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../../db/client";
import type { EmailTransport } from "./email";
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const signupSchema = z.object({ email: emailSchema, password: passwordSchema, confirmPassword: passwordSchema }).refine(v => v.password === v.confirmPassword, { message: "Passwords must match", path: ["confirmPassword"] });
// The library exposes an ambient const enum; numeric 2 selects Argon2id under isolatedModules.
const options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
type Credential = { user_id: string; email: string; password_hash: string; verified_at: Date | null; session_version: number };
async function rows<T>(db: DbExecutor, statement: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(statement);
  return (Array.isArray(result) ? result : (result as unknown as { rows: T[] }).rows) as T[];
}
export class AccountSecurity {
  constructor(private db: Database, private transport: EmailTransport, private secret: string) {
    if (secret.length < 32) throw new Error("AUTH_CODE_SECRET_REQUIRED");
  }
  private digest(value: string) { return createHmac("sha256", this.secret).update(value).digest("hex"); }
  // Shared atomic counters; no raw emails/IPs in rate-limit keys. Short transactions also serialize registration.
  private async limit(operation: string, subject: string, maximum: number, seconds = 900) {
    const key = this.digest(`${operation}:${subject}`);
    const [row] = await rows<{ attempts: number }>(this.db, sql`INSERT INTO auth_rate_limits (key) VALUES (${key}) ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN auth_rate_limits.window_start <= now() - ${seconds} * interval '1 second' THEN 1 ELSE auth_rate_limits.attempts + 1 END, window_start = CASE WHEN auth_rate_limits.window_start <= now() - ${seconds} * interval '1 second' THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`);
    if (row.attempts > maximum) throw new Error("TRY_LATER");
  }
  private async credential(db: DbExecutor, email: string, lock = false) {
    return (await rows<Credential>(db, sql`SELECT c.*, u.session_version FROM auth_credentials c JOIN app_users u ON u.id = c.user_id WHERE c.email = ${email} ${lock ? sql`FOR UPDATE OF c, u` : sql``}`))[0];
  }
  async register(raw: unknown) {
    const data = signupSchema.parse(raw);
    await this.limit("register", data.email, 5);
    await this.limit("register-global", "global", 200);
    const passwordHash = await hash(data.password, options);
    await this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      // Unique normalized email + conflict-safe insert; never overwrite/reuse historical identities.
      const [historical] = await rows<{ id: string }>(tx, sql`SELECT id FROM app_users WHERE lower(trim(email))=${data.email} LIMIT 1`);
      if (historical) return;
      const id = `account:${randomUUID()}`;
      const [user] = await rows<{ id: string }>(tx, sql`INSERT INTO app_users (id,name,email) VALUES (${id},'Seller',${data.email}) ON CONFLICT (email) DO NOTHING RETURNING id`);
      if (!user) return;
      await tx.execute(sql`INSERT INTO auth_credentials (user_id,email,password_hash) VALUES (${id},${data.email},${passwordHash})`);
      const [org] = await rows<{ id: string }>(tx, sql`INSERT INTO organizations (name) VALUES ('My Reading Studio') RETURNING id`);
      await tx.execute(sql`INSERT INTO memberships (organization_id,user_id,role) VALUES (${org.id},${id},'owner')`);
    });
    await this.sendCode(data.email, "verify");
  }
  async sendCode(rawEmail: unknown, purpose: "verify" | "reset", dispatch?: (task: () => Promise<void>) => void) {
    const email = emailSchema.parse(rawEmail);
    await this.limit(`send-${purpose}`, email, 5, 3600);
    await this.limit("send-global", "global", 500, 3600);
    const message = await this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      const user = await this.credential(tx, email, true);
      if (!user || (purpose === "verify" && user.verified_at) || (purpose === "reset" && !user.verified_at)) return;
      const [previous] = await rows<{ cooling: boolean }>(tx, sql`SELECT issued_at > now() - interval '60 seconds' AS cooling FROM auth_challenges WHERE user_id = ${user.user_id} AND purpose = ${purpose}`);
      if (previous?.cooling) return;
      const identity = randomUUID(), code = randomInt(0, 1000000).toString().padStart(6, "0");
      const digest = this.digest(`${purpose}:${identity}:${code}`);
      await tx.execute(sql`INSERT INTO auth_challenges (user_id,purpose,identity,code_hash,expires_at) VALUES (${user.user_id},${purpose},${identity},${digest},now()+interval '10 minutes') ON CONFLICT (user_id,purpose) DO UPDATE SET identity=EXCLUDED.identity,code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,issued_at=now(),consumed_at=NULL,attempts=0`);
      return { to: email, code, purpose, identity };
    });
    const deliver = async () => {
      if (!message) return;
      try { await this.transport.send(message); } catch {
        await this.db.execute(sql`UPDATE auth_challenges SET consumed_at=now() WHERE identity=${message.identity} AND consumed_at IS NULL`);
        throw new Error("EMAIL_UNAVAILABLE");
      }
    };
    if (dispatch) dispatch(deliver); else await deliver();
  }
  // Wrong attempts commit; code consumption and account mutation occur in the same locked transaction.
  private async consume(email: string, code: string, purpose: "verify" | "reset", passwordHash?: string) {
    await this.limit(`code-${purpose}`, email, 10);
    await this.limit("code-global", "global", 1000);
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      const user = await this.credential(tx, email, true);
      if (!user) return false;
      const [challenge] = await rows<{ identity: string; code_hash: string; eligible: boolean }>(tx, sql`SELECT identity,code_hash,(consumed_at IS NULL AND expires_at > now() AND attempts < 5) AS eligible FROM auth_challenges WHERE user_id=${user.user_id} AND purpose=${purpose} FOR UPDATE`);
      if (!challenge?.eligible) return false;
      await tx.execute(sql`UPDATE auth_challenges SET attempts=attempts+1 WHERE identity=${challenge.identity}`);
      const digest = this.digest(`${purpose}:${challenge.identity}:${code}`);
      if (!timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(challenge.code_hash, "hex"))) return false;
      await tx.execute(sql`UPDATE auth_challenges SET consumed_at=now() WHERE identity=${challenge.identity}`);
      if (purpose === "verify") await tx.execute(sql`UPDATE auth_credentials SET verified_at=COALESCE(verified_at,now()) WHERE user_id=${user.user_id}`);
      else {
        if (!passwordHash || !user.verified_at) return false;
        await tx.execute(sql`UPDATE auth_credentials SET password_hash=${passwordHash} WHERE user_id=${user.user_id}`);
        await tx.execute(sql`UPDATE app_users SET session_version=session_version+1 WHERE id=${user.user_id}`);
      }
      return true;
    });
  }
  async verifyEmail(rawEmail: unknown, rawCode: unknown) {
    return this.consume(emailSchema.parse(rawEmail), z.string().regex(/^\d{6}$/).parse(rawCode), "verify");
  }
  async reset(raw: unknown) {
    const data = signupSchema.and(z.object({ code: z.string().regex(/^\d{6}$/) })).parse(raw);
    // Bound Argon2 work before computing a replacement hash, including unknown emails.
    await this.limit("reset-hash", data.email, 10);
    await this.limit("reset-global", "global", 200);
    return this.consume(data.email, data.code, "reset", await hash(data.password, options));
  }
  async login(raw: unknown) {
    const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(raw);
    if (!parsed.success) return null;
    await this.limit("login", parsed.data.email, 10);
    await this.limit("login-global", "global", 1000);
    const user = await this.credential(this.db, parsed.data.email);
    // Compute equivalent Argon2 work when no credential identity exists.
    const valid = user ? await verify(user.password_hash, parsed.data.password).catch(() => false) : (await hash(parsed.data.password, options), false);
    return valid && user?.verified_at ? { id: user.user_id, email: user.email, name: "Seller", sessionVersion: user.session_version } : null;
  }
  async change(userId: string, sessionVersion: number, raw: unknown) {
    const data = z.object({ currentPassword: z.string().min(1).max(128), password: passwordSchema, confirmPassword: passwordSchema }).refine(v=>v.password===v.confirmPassword).parse(raw);
    await this.limit("change", userId, 5);
    const replacement = await hash(data.password, options);
    return this.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      const [user] = await rows<Credential>(tx, sql`SELECT c.*,u.session_version FROM auth_credentials c JOIN app_users u ON u.id=c.user_id WHERE c.user_id=${userId} FOR UPDATE OF c,u`);
      if (!user?.verified_at || user.session_version !== sessionVersion || !await verify(user.password_hash, data.currentPassword).catch(()=>false)) return false;
      await tx.execute(sql`UPDATE auth_credentials SET password_hash=${replacement} WHERE user_id=${userId}`);
      await tx.execute(sql`UPDATE app_users SET session_version=session_version+1 WHERE id=${userId}`);
      await tx.execute(sql`UPDATE auth_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=${userId} AND purpose='reset'`);
      return true; // Policy: revoke all sessions, including this one; require a fresh login.
    });
  }
}
export async function sessionIdentity(db: DbExecutor, id: string) {
  const [row] = await rows<{ version: number; active: boolean }>(db, sql`SELECT u.session_version AS version,((u.id NOT LIKE 'account:%' AND c.user_id IS NULL) OR c.verified_at IS NOT NULL) AS active FROM app_users u LEFT JOIN auth_credentials c ON c.user_id=u.id WHERE u.id=${id}`);
  return row?.active ? row.version : null;
}

export async function revokeUserSessions(db: DbExecutor, userId: string, expectedVersion: number) {
  const changed = await rows<{ id: string }>(db, sql`UPDATE app_users SET session_version=session_version+1 WHERE id=${userId} AND session_version=${expectedVersion} RETURNING id`);
  return changed.length === 1;
}
