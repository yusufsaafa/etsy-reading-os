import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { AccountSecurity, sessionIdentity, revokeUserSessions } from "../src/modules/identity/security/service";
import { transactionalEmail, type EmailMessage } from "../src/modules/identity/security/email";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
let pg: PGlite, db: Database;
const sent: EmailMessage[] = [], password = "A strong original password";
let service: AccountSecurity;
beforeAll(async () => {
 pg=new PGlite(); for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`drizzle/${file}`,"utf8"));
 db=drizzle(pg,{schema}) as unknown as Database;
 service=new AccountSecurity(db,{async send(message){sent.push(message);}},"test-only-secret-with-at-least-32-characters");
},30000);
afterAll(async()=>{await pg.close();});
async function account(verified=true) {
 const email=`${randomUUID()}@example.test`;
 await service.register({email,password,confirmPassword:password});
 const code=[...sent].reverse().find(m=>m.to===email)!.code;
 if(verified) expect(await service.verifyEmail(email,code)).toBe(true);
 return {email,code};
}
it("normalizes registration, hashes with Argon2id and blocks unverified login",async()=>{
 const a=await account(false);
 const result=await pg.query<{email:string;password_hash:string}>("SELECT email,password_hash FROM auth_credentials WHERE email=$1",[a.email]);
 expect(result.rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
 expect(result.rows[0].password_hash).not.toContain(password);
 expect(await service.login({email:a.email.toUpperCase(),password})).toBeNull();
 expect(await service.verifyEmail(a.email,a.code)).toBe(true);
 expect(await service.login({email:a.email.toUpperCase(),password})).toMatchObject({email:a.email,sessionVersion:0});
});
it("registration replay does not replace passwords or duplicate organizations",async()=>{
 const a=await account(false);
 await Promise.all([service.register({email:a.email,password:"A different secret password",confirmPassword:"A different secret password"}),service.register({email:a.email.toUpperCase(),password,confirmPassword:password})]);
 const rows=await pg.query<{count:number}>("SELECT count(*)::int AS count FROM memberships m JOIN auth_credentials c ON c.user_id=m.user_id WHERE c.email=$1",[a.email]);
 expect(rows.rows[0].count).toBe(1);
 await service.verifyEmail(a.email,a.code);
 expect(await service.login({email:a.email,password})).not.toBeNull();
 expect(await service.login({email:a.email,password:"A different secret password"})).toBeNull();
});
it("consumes verification exactly once under competing verification",async()=>{
 const a=await account(false);
 expect((await Promise.all([service.verifyEmail(a.email,a.code),service.verifyEmail(a.email,a.code)])).sort()).toEqual([false,true]);
});
it("rejects expired codes",async()=>{
 const a=await account(false);
 await pg.query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT user_id FROM auth_credentials WHERE email=$1)",[a.email]);
 expect(await service.verifyEmail(a.email,a.code)).toBe(false);
});
it("limits wrong-code attempts even when the next code is correct",async()=>{
 const a=await account(false), wrong=a.code==="000000"?"111111":"000000";
 for(let n=0;n<5;n++) expect(await service.verifyEmail(a.email,wrong)).toBe(false);
 expect(await service.verifyEmail(a.email,a.code)).toBe(false);
});
it("resend cooldown suppresses duplicate mail and stored codes are hashes",async()=>{
 const a=await account(false), count=sent.length;
 await service.sendCode(a.email,"verify"); expect(sent.length).toBe(count);
 const rows=await pg.query<{code_hash:string}>("SELECT code_hash FROM auth_challenges WHERE user_id=(SELECT user_id FROM auth_credentials WHERE email=$1)",[a.email]);
 expect(rows.rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);expect(rows.rows[0].code_hash).not.toBe(a.code);
});
it("new resend invalidates previous code",async()=>{
 const a=await account(false);
 await pg.query("UPDATE auth_challenges SET issued_at=now()-interval '61 seconds' WHERE user_id=(SELECT user_id FROM auth_credentials WHERE email=$1)",[a.email]);
 await service.sendCode(a.email,"verify"); const fresh=[...sent].reverse().find(m=>m.to===a.email)!;
 // Rare equal random codes are valid with the newly issued identity; do not assert statistical uniqueness.
 if(fresh.code!==a.code) expect(await service.verifyEmail(a.email,a.code)).toBe(false);
 expect(await service.verifyEmail(a.email,fresh.code)).toBe(true);
});
it("reset replaces password, revokes sessions, preserves verification and is single-use",async()=>{
 const a=await account(), user=(await service.login({email:a.email,password}))!;
 await service.sendCode(a.email,"reset"); const code=[...sent].reverse().find(m=>m.to===a.email)!.code, next="An entirely new password";
 expect(await service.reset({email:a.email,code,password:next,confirmPassword:next})).toBe(true);
 expect(await sessionIdentity(db,user.id)).toBe(1);
 expect(await service.login({email:a.email,password})).toBeNull();
 expect(await service.login({email:a.email,password:next})).not.toBeNull();
 expect(await service.reset({email:a.email,code,password:next,confirmPassword:next})).toBe(false);
});
it("does not reset unverified or unknown identities",async()=>{
 const a=await account(false), count=sent.length;
 await service.sendCode(a.email,"reset");await service.sendCode("unknown@example.test","reset");
 expect(sent.length).toBe(count);
 expect(await service.reset({email:a.email,code:a.code,password,confirmPassword:password})).toBe(false);
 expect(await sessionIdentity(db,(await pg.query<{user_id:string}>("SELECT user_id FROM auth_credentials WHERE email=$1",[a.email])).rows[0].user_id)).toBeNull();
});
it("change requires current password, rejects stale sessions and revokes all sessions",async()=>{
 const a=await account(), user=(await service.login({email:a.email,password}))!, next="A secure changed password";
 expect(await service.change(user.id,0,{currentPassword:"Wrong password",password:next,confirmPassword:next})).toBe(false);
 expect(await service.change(user.id,0,{currentPassword:password,password:next,confirmPassword:next})).toBe(true);
 expect(await service.change(user.id,0,{currentPassword:next,password,confirmPassword:password})).toBe(false);
 expect(await sessionIdentity(db,user.id)).toBe(1);
});
it("database counters limit login and unknown-account brute force",async()=>{
 const email=`${randomUUID()}@example.test`;
 for(let i=0;i<10;i++) expect(await service.login({email,password})).toBeNull();
 await expect(service.login({email,password})).rejects.toThrow("TRY_LATER");
});
it("preserves GitHub identity and does not merge registration by email",async()=>{
 const email=`${randomUUID()}@example.test`, id=`github:${Date.now()}`;
 await db.insert(schema.users).values({id,name:"Legacy owner",email});
 await service.register({email,password,confirmPassword:password});
 expect((await pg.query("SELECT * FROM auth_credentials WHERE email=$1",[email])).rows).toHaveLength(0);
 expect(await service.login({email,password})).toBeNull();expect(await sessionIdentity(db,id)).toBe(0);
});
it("isolates organization/store ownership and reuses the registration organization",async()=>{
 const a=await account(),b=await account(), ua=(await service.login({email:a.email,password}))!,ub=(await service.login({email:b.email,password}))!;
 const store=await createWorkspace(db,ua.id,"My shop","fixtures");
 expect(await authorizeStore(db,ua.id,store)).toMatchObject({userId:ua.id});
 await expect(authorizeStore(db,ub.id,store)).rejects.toThrow("Resource unavailable");
 expect((await pg.query("SELECT * FROM memberships WHERE user_id=$1",[ua.id])).rows).toHaveLength(1);
});
it("fails closed for missing email configuration and invalid code secret",()=>{
 expect(()=>transactionalEmail({NODE_ENV:"test",EMAIL_PROVIDER:"disabled"})).toThrow("EMAIL_UNAVAILABLE");
 expect(()=>new AccountSecurity(db,{async send(){}},"short")).toThrow("AUTH_CODE_SECRET_REQUIRED");
});
it("delivery failure consumes the issued code and never verifies the account",async()=>{
 let captured:EmailMessage|undefined;
 const failing=new AccountSecurity(db,{async send(message){captured=message;throw new Error("transport failure");}},"test-only-secret-with-at-least-32-characters");
 const email=`${randomUUID()}@example.test`;
 await expect(failing.register({email,password,confirmPassword:password})).rejects.toThrow("EMAIL_UNAVAILABLE");
 expect(await service.verifyEmail(email,captured!.code)).toBe(false);
 expect(await service.login({email,password})).toBeNull();
});
it("registration validates confirmation and never persists invalid credentials",async()=>{
 await expect(service.register({email:"bad",password:"short",confirmPassword:"different"})).rejects.toThrow();
});
it("separate service instances share login abuse counters",async()=>{
 const email=`${randomUUID()}@example.test`,other=new AccountSecurity(db,{async send(){}},"test-only-secret-with-at-least-32-characters");
 for(let i=0;i<10;i++) await (i%2?service:other).login({email,password});
 await expect(other.login({email,password})).rejects.toThrow("TRY_LATER");
});
it("competing password resets succeed exactly once",async()=>{
 const a=await account();await service.sendCode(a.email,"reset");const code=[...sent].reverse().find(m=>m.to===a.email)!.code;
 const input={email:a.email,code,password:"Another fresh password",confirmPassword:"Another fresh password"};
 expect((await Promise.all([service.reset(input),service.reset(input)])).sort()).toEqual([false,true]);
});
it("reset delivery can be scheduled without revealing email network timing",async()=>{
 const a=await account(), count=sent.length,tasks:(()=>Promise<void>)[]=[];
 await service.sendCode(a.email,"reset",task=>tasks.push(task));
 await service.sendCode(`${randomUUID()}@example.test`,"reset",task=>tasks.push(task));
 expect(tasks).toHaveLength(2);expect(sent.length).toBe(count);
 await Promise.all(tasks.map(task=>task()));expect(sent.length).toBe(count+1);
});
it("credential removal fails closed for a formerly active customer session",async()=>{
 const a=await account(),user=(await service.login({email:a.email,password}))!;
 await pg.query("DELETE FROM auth_challenges WHERE user_id=$1",[user.id]);await pg.query("DELETE FROM auth_credentials WHERE user_id=$1",[user.id]);
 expect(await sessionIdentity(db,user.id)).toBeNull();
});
it("preserves mixed-case historical emails without registering a duplicate credential identity",async()=>{
 const email=`${randomUUID()}@example.test`;
 await db.insert(schema.users).values({id:`github:${randomUUID()}`,name:"Historical",email:email.toUpperCase()});
 await service.register({email,password,confirmPassword:password});
 expect((await pg.query("SELECT * FROM auth_credentials WHERE email=$1",[email])).rows).toHaveLength(0);
});
it("expired reset codes cannot mutate password or verification",async()=>{
 const a=await account(),user=(await service.login({email:a.email,password}))!;
 await service.sendCode(a.email,"reset");const code=[...sent].reverse().find(m=>m.to===a.email)!.code;
 await pg.query("UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND purpose='reset'",[user.id]);
 expect(await service.reset({email:a.email,code,password:"A new but rejected password",confirmPassword:"A new but rejected password"})).toBe(false);
 expect(await sessionIdentity(db,user.id)).toBe(0);expect(await service.login({email:a.email,password})).not.toBeNull();
});

it("logout revokes all account sessions idempotently without affecting another account",async()=>{
 const a=await account(),b=await account(),ua=(await service.login({email:a.email,password}))!,ub=(await service.login({email:b.email,password}))!;
 expect(await revokeUserSessions(db,ua.id,0)).toBe(true);expect(await revokeUserSessions(db,ua.id,0)).toBe(false);
 expect(await sessionIdentity(db,ua.id)).toBe(1);expect(await sessionIdentity(db,ub.id)).toBe(0);
});
