import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import { ingestListing, ingestOrder, workspaceData, configureMapping, correctInput, tenantWhere } from "../src/modules/intake/service";
import { fixtureListings, fixtureOrders, FixtureEtsyAdapter } from "../src/modules/etsy/fixtures";
import { PostgresSyncJobs } from "../src/infrastructure/jobs";
import { beginOAuth, completeOAuth, connectFixtures, disconnect } from "../src/modules/etsy/connection-service";
import { LocalEncryptedVault } from "../src/infrastructure/secrets";
import type { Scope } from "../src/modules/intake/contracts";
let pg:PGlite,db:Database,a:Scope,b:Scope;
beforeEach(async()=>{
  pg=new PGlite();
  for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort()) await pg.exec(readFileSync(`drizzle/${file}`,"utf8"));
  // Same PostgreSQL SQL semantics; only the driver differs from postgres.js in these sandbox tests.
  db=drizzle(pg,{schema}) as unknown as Database;
  for(const id of ["seller-a","seller-b"]) await db.insert(schema.users).values({id,name:id});
  a=await authorizeStore(db,"seller-a",await createWorkspace(db,"seller-a","Store A","fixtures"));
  b=await authorizeStore(db,"seller-b",await createWorkspace(db,"seller-b","Store B","fixtures"));
  for(const listing of fixtureListings) await ingestListing(db,a,listing);
  await configureMapping(db,a,"101","default",false);await configureMapping(db,a,"102","default",false);
  await db.update(schema.stores).set({importSince:new Date("2026-10-01")}).where(eq(schema.stores.id,a.storeId));
  process.env.ETSY_ADAPTER="fixtures";
},20000);
afterEach(async()=>{vi.unstubAllGlobals();await pg.close();});
describe("PostgreSQL intake invariants",()=>{
  it("mixed checkout expands into two lines and three independent units; repeated import stays unique",async()=>{
    await ingestOrder(db,a,fixtureOrders[1]);await ingestOrder(db,a,fixtureOrders[1]);
    const data=await workspaceData(db,a);expect(data.orders).toHaveLength(1);expect(data.lines).toHaveLength(2);expect(data.units).toHaveLength(3);expect(data.inputs).toHaveLength(3);
    expect(data.units.filter(u=>u.issues.includes("quantity_context"))).toHaveLength(2);expect(data.units.some(u=>u.issues.includes("source_changed"))).toBe(false);
  });
  it("quantity three has exactly three stable indexes",async()=>{
    await ingestOrder(db,a,fixtureOrders[5]);await ingestOrder(db,a,fixtureOrders[5]);expect((await workspaceData(db,a)).units.map(u=>u.unitIndex).sort()).toEqual([1,2,3]);
  });
  it("rolls back an interrupted receipt and can retry without partial lines/units",async()=>{
    await expect(ingestOrder(db,a,fixtureOrders[1],{failAfterLines:1})).rejects.toThrow("TEST_PARTIAL_FAILURE");expect((await workspaceData(db,a)).orders).toHaveLength(0);
    await ingestOrder(db,a,fixtureOrders[1]);expect((await workspaceData(db,a)).units).toHaveLength(3);
  });
  it("denies cross-tenant reads, forged scopes and corrections",async()=>{
    await ingestOrder(db,a,fixtureOrders[0]);const unit=(await workspaceData(db,a)).units[0];
    expect((await workspaceData(db,b)).orders).toHaveLength(0);
    await expect(authorizeStore(db,"seller-b",a.storeId)).rejects.toThrow("Resource unavailable");
    await expect(workspaceData(db,{...a,userId:b.userId})).rejects.toThrow();
    await expect(correctInput(db,b,unit.id,0,[],false)).rejects.toThrow();
  });
  it("database rejects a cross-tenant child association",async()=>{
    await ingestOrder(db,a,fixtureOrders[0]);const order=(await workspaceData(db,a)).orders[0];
    await expect(db.insert(schema.lineItems).values({organizationId:b.organizationId,storeId:b.storeId,orderId:order.id,externalId:"9999",listingExternalId:"101",title:"Invalid",quantity:1,variantKey:"default",snapshot:fixtureOrders[0].lines[0]})).rejects.toThrow();
  });
  it("retains missing personalization and detects an unmapped variant",async()=>{
    await ingestOrder(db,a,fixtureOrders[2]);await ingestOrder(db,a,fixtureOrders[3]);const data=await workspaceData(db,a);
    expect(data.units.some(u=>u.issues.includes("missing_input"))).toBe(true);expect(data.units.some(u=>u.issues.includes("unmapped_listing"))).toBe(true);
  });
  it("preserves Unicode and seller corrections across sync replay; rejects stale edits",async()=>{
    await ingestOrder(db,a,fixtureOrders[4]);let data=await workspaceData(db,a);const unit=data.units[0];expect(data.orders[0].buyerName).toBe("Çağla 山田");expect(data.inputs[0].answers[0].value).toContain("日本語");
    await correctInput(db,a,unit.id,0,[{label:"Question",value:"Düzeltilmiş bilgi 日本語",kind:"text"}],false);
    await ingestOrder(db,a,fixtureOrders[4]);data=await workspaceData(db,a);expect(data.inputs[0].answers[0].value).toBe("Düzeltilmiş bilgi 日本語");expect(data.inputs).toHaveLength(2);
    await expect(correctInput(db,a,unit.id,0,[],false)).rejects.toThrow("STALE_REVISION");
  });
  it("does not undo cancellation with a stale paid event",async()=>{
    await ingestOrder(db,a,{...fixtureOrders[0],canceled:true,updatedAt:fixtureOrders[0].updatedAt+10});await ingestOrder(db,a,fixtureOrders[0]);expect((await workspaceData(db,a)).units[0].issues).toContain("canceled");
  });
  it("changed quantity preserves purchased identity and holds drift instead of renumbering",async()=>{
    await ingestOrder(db,a,fixtureOrders[1]);await ingestOrder(db,a,{...fixtureOrders[1],updatedAt:fixtureOrders[1].updatedAt+1,lines:[{...fixtureOrders[1].lines[0],quantity:1},fixtureOrders[1].lines[1]]});
    const data=await workspaceData(db,a);expect(data.units).toHaveLength(3);expect(data.units.filter(u=>u.issues.includes("source_changed"))).toHaveLength(2);
  });
  it("sync double click yields one run; partial sync retry preserves committed receipts",async()=>{
    await connectFixtures(db,a);const jobs=new PostgresSyncJobs(db);const id=await jobs.enqueueSync(a,"command-first-123");expect(await jobs.enqueueSync(a,"command-first-123")).toBe(id);expect(await jobs.enqueueSync(a,"command-second-456")).toBe(id);
    await jobs.runNext(new FixtureEtsyAdapter(true,2));expect((await workspaceData(db,a)).orders).toHaveLength(2);
    await db.update(schema.syncRuns).set({availableAt:new Date(0)}).where(and(tenantWhere(schema.syncRuns,a),eq(schema.syncRuns.id,id)));
    await jobs.runNext(new FixtureEtsyAdapter());const data=await workspaceData(db,a);expect(data.orders).toHaveLength(6);expect(data.lines).toHaveLength(7);expect(data.units).toHaveLength(10);
    expect((await db.select().from(schema.syncRuns).where(and(tenantWhere(schema.syncRuns,a),eq(schema.syncRuns.id,id))))[0].status).toBe("succeeded");
  });
  it("disconnect cancels queued sync, deletes secrets and fences imports",async()=>{
    await connectFixtures(db,a);const [connection]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,a));const jobs=new PostgresSyncJobs(db);await jobs.enqueueSync(a,"disconnect-command-123");await disconnect(db,a);
    const [after]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,a));expect(after.encryptedTokens).toBeNull();expect(after.status).toBe("disconnected");expect(after.epoch).toBeGreaterThan(connection.epoch);
    await expect(ingestOrder(db,a,fixtureOrders[0],{epoch:connection.epoch})).rejects.toThrow("CONNECTION_CHANGED");expect(await jobs.runNext(new FixtureEtsyAdapter())).toBe(false);
  });
  it("OAuth state is user-bound, expiring, single-use; tokens are encrypted and callback returns only store ID",async()=>{
    const storeId=await createWorkspace(db,"seller-a","Store A","etsy");await db.update(schema.stores).set({source:"etsy"}).where(eq(schema.stores.id,storeId));
    const vault=new LocalEncryptedVault(randomBytes(32).toString("base64"));const config={clientId:"app",secret:"secret",redirectUri:"https://app.example/api/etsy/callback"};
    const url=new URL(await beginOAuth(db,a,vault,config));const state=url.searchParams.get("state")!;
    await expect(completeOAuth(db,"seller-b",state,"code",vault,config)).rejects.toThrow("INVALID_OAUTH_STATE");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json({access_token:"123.token",refresh_token:"refresh-secret",expires_in:3600,token_type:"Bearer",scope:"listings_r transactions_r"})).mockResolvedValueOnce(Response.json({shop_id:900,user_id:123,shop_name:"Live Shop"})));
    expect(await completeOAuth(db,a.userId,state,"code",vault,config)).toBe(a.storeId);
    const [row]=await db.select().from(schema.connections).where(tenantWhere(schema.connections,a));expect(row.encryptedTokens).not.toContain("refresh-secret");
    await expect(completeOAuth(db,a.userId,state,"code",vault,config)).rejects.toThrow("EXPIRED_OR_REPLAYED_OAUTH_STATE");
    const second=new URL(await beginOAuth(db,a,vault,config));await db.update(schema.oauthStates).set({expiresAt:new Date(0)}).where(tenantWhere(schema.oauthStates,a));
    await expect(completeOAuth(db,a.userId,second.searchParams.get("state")!,"code",vault,config)).rejects.toThrow("EXPIRED_OR_REPLAYED_OAUTH_STATE");
  });
});
