import { beforeEach,afterEach,it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readFileSync,readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as s from "../src/db/schema";
import { authorizeStore,createWorkspace } from "../src/modules/identity/service";
import type { Scope } from "../src/modules/intake/contracts";
import * as media from "../src/modules/media/service";
import { platformMediaRegistry } from "../src/modules/media/platform-registry";
import { CANONICAL_CARDS } from "../src/modules/media/catalog";
import { mappingHash } from "../src/modules/media/contracts";
import { assetFixture,deckFixture,bytes } from "./media.fixture";
let pg:PGlite,db:Database,a:Scope,b:Scope,sibling:Scope,registry:ReturnType<typeof platformMediaRegistry>;
beforeEach(async()=>{
 pg=new PGlite();await migrate(drizzle(pg,{schema:s}),{migrationsFolder:"drizzle"});db=drizzle(pg,{schema:s}) as unknown as Database;registry=platformMediaRegistry(db);
 for(const id of ["a","b"])await db.insert(s.users).values({id,name:id});
 a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));
 const [store]=await db.insert(s.stores).values({organizationId:a.organizationId,name:"Sibling",importSince:new Date()}).returning();sibling=await authorizeStore(db,"a",store.id);
},20000);
afterEach(async()=>pg.close());
async function publish(key="synthetic",version=1) {const asset=assetFixture();await registry.registerAsset(asset);if(!(await db.select().from(s.tarotDecks).where(eq(s.tarotDecks.key,key))).length)await registry.registerDeck({key,name:"Synthetic Deck",description:"Synthetic fixtures only"});const deck=deckFixture(asset.id,key,version);await registry.publishVersion(deck);return {asset,deck};}
const set=(deckKey="synthetic",expectedRevision=0,scope=a,deckVersion=1)=>media.setStorePreferredTarotDeck(db,scope,{deckKey,deckVersion,expectedRevision});
it("safe catalog/exact resolution/verified storage are detached and expose no internals or customer/provider data",async()=>{
 const {asset}=await publish();const catalog=await media.listSelectableTarotDecks(db,a);expect(catalog).toEqual([{deckKey:"synthetic",deckVersion:1,displayName:"Synthetic Deck",description:"Synthetic fixtures only"}]);expect(Object.isFrozen(catalog[0])).toBe(true);
 const card=await media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:1,cardKey:"THE_LOVERS"});expect(card.asset.id).toBe(asset.id);expect(Object.isFrozen(card.asset)).toBe(true);expect(Object.keys(card.asset).sort()).toEqual(["byteSize","contentHash","height","id","mediaType","width"]);
 let key="";const output=await media.readPlatformAssetBytes(db,{read:async input=>{key=input.objectKey;return bytes;}},{assetId:card.asset.id});expect(key).toBe(asset.objectKey);expect(output).toEqual(bytes);output[0]=0;expect(bytes[0]).toBe(137);
 for(const wrong of [Uint8Array.from([0]),Uint8Array.from(bytes.map(v=>v+1))])await expect(media.readPlatformAssetBytes(db,{read:async()=>wrong},{assetId:asset.id})).rejects.toThrow("MEDIA_UNAVAILABLE");
 await expect(media.readPlatformAssetBytes(db,{read:async()=>bytes},{assetId:randomUUID()})).rejects.toThrow();await expect(media.readPlatformAssetBytes(db,{read:async()=>bytes},{assetId:asset.id,objectKey:"https://example.invalid"})).rejects.toThrow();
 for(const command of [{deckKey:"unknown",deckVersion:1,cardKey:"THE_MOON"},{deckKey:"synthetic",deckVersion:99,cardKey:"THE_MOON"},{deckKey:"synthetic",deckVersion:1,cardKey:"not-a-card"}])await expect(media.resolveTarotCardAsset(db,command)).rejects.toThrow();
});
it("Store preference has no default; coherent revisions support change/idempotence/conflict",async()=>{
 expect(await media.getStorePreferredTarotDeck(db,a)).toEqual({status:"NOT_CONFIGURED",revision:0});await publish();await publish("second");expect(await db.select().from(s.storeTarotPreferences)).toHaveLength(0);
 const first=await set();expect(first).toEqual({status:"CONFIGURED",revision:1,deckKey:"synthetic",deckVersion:1});expect(Object.isFrozen(first)).toBe(true);expect(await set("synthetic",1)).toEqual(first);await expect(set("second",0)).rejects.toThrow("CONFLICT");expect((await set("second",1)).revision).toBe(2);expect(first).toMatchObject({deckKey:"synthetic"});
 expect(await media.getStorePreferredTarotDeck(db,sibling)).toEqual({status:"NOT_CONFIGURED",revision:0});
});
it("authenticated ownership blocks cross-org, sibling and forged target/preferences; platform writes have no seller boundary",async()=>{
 await publish();await set();
 for(const forged of [{...a,userId:"b"},{...a,storeId:b.storeId},{...a,storeId:sibling.storeId,userId:"b"},{...a,storeId:randomUUID()}]) {
  await expect(media.getStorePreferredTarotDeck(db,forged)).rejects.toThrow();await expect(set("synthetic",1,forged)).rejects.toThrow();await expect(media.listSelectableTarotDecks(db,forged)).rejects.toThrow();
 }
 for(const scope of [b,sibling]) {expect(await media.getStorePreferredTarotDeck(db,scope)).toEqual({status:"NOT_CONFIGURED",revision:0});await expect(media.setStorePreferredTarotDeck(db,scope,{deckKey:"synthetic",deckVersion:1,expectedRevision:1,storeId:a.storeId})).rejects.toThrow();}
 expect(media).not.toHaveProperty("publishVersion");expect(media).not.toHaveProperty("registerAsset");expect(media).not.toHaveProperty("retireVersion");await expect(registry.registerDeck(a)).rejects.toThrow();await expect(registry.publishVersion(a)).rejects.toThrow();
 await expect(db.insert(s.storeTarotPreferences).values({organizationId:a.organizationId,storeId:b.storeId,deckKey:"synthetic",deckVersion:1,revision:1})).rejects.toThrow();
});
it("publication rejects incomplete/duplicate/unknown/missing/unusable/unapproved manifests and SQL bypasses",async()=>{
 const good=assetFixture();await registry.registerAsset(good);await registry.registerDeck({key:"synthetic",name:"Synthetic",description:""});
 for(const change of ["77","79","duplicate","unknown","missing","deck-rights","asset-rights","unusable","wrong-kind","hash"]) {
  const d:Record<string,any>=deckFixture(good.id);if(change==="77")d.mappings.pop();if(change==="79")d.mappings.push({...d.mappings[0]});if(change==="duplicate")d.mappings[1]={...d.mappings[0]};if(change==="unknown")d.mappings[0].cardKey="UNKNOWN";if(change==="missing")d.mappings[0].assetId=randomUUID();if(change==="deck-rights")d.rights.state="UNVERIFIED";if(change==="hash")d.mappingHash="0".repeat(64);
  if(["asset-rights","unusable","wrong-kind"].includes(change)) {const bad=assetFixture();if(change==="asset-rights")bad.rights.state="UNVERIFIED" as never;if(change==="unusable")bad.status="UNAVAILABLE" as never;if(change==="wrong-kind") {await expect(registry.registerAsset({...bad,kind:"LOGO"})).rejects.toThrow();continue;}await registry.registerAsset(bad);d.mappings[0].assetId=bad.id;}
  if(change!=="hash")d.mappingHash=mappingHash(d.mappings);
  await expect(registry.publishVersion(d)).rejects.toThrow();
  if(!["hash"].includes(change))await expect(db.insert(s.tarotDeckVersions).values({deckKey:"synthetic",version:1,status:"PUBLISHED",manifest:d as never})).rejects.toThrow();
 }
 expect(await db.select().from(s.tarotDeckVersions)).toHaveLength(0);
});
it("assets and published mapping semantics are immutable; new identities/versions preserve originals",async()=>{
 const {asset,deck}=await publish();
 await expect(db.update(s.platformAssets).set({metadata:{...asset,contentHash:"0".repeat(64)}}).where(eq(s.platformAssets.id,asset.id))).rejects.toThrow();await expect(db.delete(s.platformAssets).where(eq(s.platformAssets.id,asset.id))).rejects.toThrow();await expect(registry.registerAsset({...asset,id:randomUUID()})).rejects.toThrow();
 const replacement=assetFixture();await registry.registerAsset(replacement);const changed=deckFixture(replacement.id);
 await expect(db.update(s.tarotDeckVersions).set({manifest:changed}).where(eq(s.tarotDeckVersions.deckKey,"synthetic"))).rejects.toThrow();await expect(db.delete(s.tarotDeckVersions).where(eq(s.tarotDeckVersions.deckKey,"synthetic"))).rejects.toThrow();
 await registry.retireVersion({deckKey:"synthetic",deckVersion:1});await registry.publishVersion({...changed,version:2});
 const old=await media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:1,cardKey:"THE_LOVERS"}),next=await media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:2,cardKey:"THE_LOVERS"});expect(old.asset.id).toBe(asset.id);expect(next.asset.id).toBe(replacement.id);expect(deck.mappingHash).not.toBe(changed.mappingHash);
});
it("retirement keeps historical resolution, blocks new selection and requires explicit preference migration",async()=>{
 await publish();await set();await registry.retireVersion({deckKey:"synthetic",deckVersion:1});await registry.retireVersion({deckKey:"synthetic",deckVersion:1});
 expect(await media.listSelectableTarotDecks(db,a)).toEqual([]);await expect(media.getStorePreferredTarotDeck(db,a)).rejects.toThrow("MEDIA_UNAVAILABLE");await expect(set("synthetic",1)).rejects.toThrow();expect((await media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:1,cardKey:"THE_MOON"})).cardKey).toBe("THE_MOON");
 await publish("second");expect(await set("second",1)).toMatchObject({deckKey:"second"});await expect(set("unknown",2)).rejects.toThrow();await expect(set("second",2,a,99)).rejects.toThrow();
 await expect(db.update(s.tarotDeckVersions).set({status:"PUBLISHED",manifest:{...deckFixture((await db.select().from(s.platformAssets))[0].id),status:"PUBLISHED"}}).where(eq(s.tarotDeckVersions.deckKey,"synthetic"))).rejects.toThrow();
});
it("concurrent preference changes conflict safely; retirement/selection and publication/selection commit coherent results",async()=>{
 await publish();await publish("second");const outcomes=await Promise.allSettled([set(),set("second")]);expect(outcomes.filter(v=>v.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(v=>v.status==="rejected")).toHaveLength(1);expect(await db.select().from(s.storeTarotPreferences)).toHaveLength(1);
 await publish("race");await Promise.allSettled([set("race",1),registry.retireVersion({deckKey:"race",deckVersion:1})]);const row=(await db.select().from(s.storeTarotPreferences))[0];expect(row.revision).toBeGreaterThanOrEqual(1);await expect(set("race",row.revision)).rejects.toThrow();expect((await media.resolveTarotCardAsset(db,{deckKey:"race",deckVersion:1,cardKey:"THE_FOOL"})).asset.id).toBeTruthy();
 const asset=assetFixture();await registry.registerAsset(asset);await registry.registerDeck({key:"publishing",name:"Publishing",description:""});await Promise.allSettled([registry.publishVersion(deckFixture(asset.id,"publishing")),set("publishing",row.revision)]);const current=(await db.select().from(s.storeTarotPreferences))[0];if(current.deckKey==="publishing")expect((await media.getStorePreferredTarotDeck(db,a)).status).toBe("CONFIGURED");
});
it("corrupt durable mappings fail closed without fallback/repair, including hash and invalid asset metadata",async()=>{
 const {asset,deck}=await publish();await set();
 const corruptions=[{...deck,mappings:deck.mappings.slice(1)},{...deck,mappings:deck.mappings.map((m,i)=>i===1 ? deck.mappings[0] : m)},{...deck,mappingHash:"0".repeat(64)},{...deck,mappings:deck.mappings.map((m,i)=>i===0 ? {...m,assetId:randomUUID()} : m)}];
 for(const bad of corruptions) {await pg.exec("ALTER TABLE tarot_deck_versions DISABLE TRIGGER tarot_version_guard");await db.update(s.tarotDeckVersions).set({manifest:bad}).where(eq(s.tarotDeckVersions.deckKey,"synthetic"));await pg.exec("ALTER TABLE tarot_deck_versions ENABLE TRIGGER tarot_version_guard");await expect(media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:1,cardKey:"THE_MOON"})).rejects.toThrow("MEDIA_UNAVAILABLE");await expect(media.getStorePreferredTarotDeck(db,a)).rejects.toThrow();await expect(media.listSelectableTarotDecks(db,a)).rejects.toThrow();}
 await pg.exec("ALTER TABLE tarot_deck_versions DISABLE TRIGGER tarot_version_guard");await db.update(s.tarotDeckVersions).set({manifest:deck}).where(eq(s.tarotDeckVersions.deckKey,"synthetic"));await pg.exec("ALTER TABLE tarot_deck_versions ENABLE TRIGGER tarot_version_guard");
 await pg.exec("ALTER TABLE platform_assets DISABLE TRIGGER platform_asset_guard");await db.update(s.platformAssets).set({metadata:{...asset,width:0}}).where(eq(s.platformAssets.id,asset.id));await pg.exec("ALTER TABLE platform_assets ENABLE TRIGGER platform_asset_guard");await expect(media.resolveTarotCardAsset(db,{deckKey:"synthetic",deckVersion:1,cardKey:"THE_FOOL"})).rejects.toThrow();
});
it("corrupt preference fails closed, never defaults; malformed revisions cannot repair corrupt state",async()=>{
 await publish();await set();await pg.exec("ALTER TABLE store_tarot_preferences DISABLE TRIGGER ALL");await db.update(s.storeTarotPreferences).set({deckVersion:99}).where(eq(s.storeTarotPreferences.storeId,a.storeId));await pg.exec("ALTER TABLE store_tarot_preferences ENABLE TRIGGER ALL");await expect(media.getStorePreferredTarotDeck(db,a)).rejects.toThrow();await expect(set("synthetic",1)).rejects.toThrow();expect((await db.select().from(s.storeTarotPreferences))[0].deckVersion).toBe(99);
});
it("migration runner repeat is no-op; schema matches generated snapshot and canonical SQL keys",async()=>{
 await publish();await set();const before=await db.select().from(s.storeTarotPreferences);await migrate(drizzle(pg,{schema:s}),{migrationsFolder:"drizzle"});expect(await db.select().from(s.storeTarotPreferences)).toEqual(before);
 const sql=readFileSync("drizzle/0018_eminent_human_torch.sql","utf8");const sqlKeys=sql.match(/keys IS DISTINCT FROM ARRAY\[(.*?)\]::text/)![1].split(",").map(k=>k.slice(1,-1));expect(sqlKeys).toEqual(CANONICAL_CARDS.map(c=>c.key).sort());
 const snapshot=JSON.parse(readFileSync("drizzle/meta/0018_snapshot.json","utf8"));for(const table of ["platform_assets","tarot_decks","tarot_deck_versions","store_tarot_preferences"])expect(snapshot.tables["public."+table]).toBeDefined();
});
it("additive media migration preserves populated pre-media history and creates no preferences/assets",async()=>{
 const legacy=new PGlite();try {for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql") && f < "0018").sort())await legacy.exec(readFileSync("drizzle/"+file,"utf8"));const old=drizzle(legacy,{schema:s}) as unknown as Database;await old.insert(s.users).values({id:"legacy",name:"Legacy"});const id=await createWorkspace(old,"legacy","Historical","fixtures");const scope=await authorizeStore(old,"legacy",id);const [product]=await old.insert(s.products).values({organizationId:scope.organizationId,storeId:id,name:"Historical product"}).returning();const tables=await legacy.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const before=new Map<string,unknown>();for(const entry of tables.rows as {tablename:string}[])before.set(entry.tablename,(await legacy.query(`SELECT * FROM "${entry.tablename}"`)).rows);
 await legacy.exec(readFileSync("drizzle/0018_eminent_human_torch.sql","utf8"));for(const [table,rows] of before)expect((await legacy.query(`SELECT * FROM "${table}"`)).rows).toEqual(rows);expect((await old.select().from(s.products))[0].id).toBe(product.id);for(const table of [s.platformAssets,s.tarotDecks,s.tarotDeckVersions,s.storeTarotPreferences])expect(await old.select().from(table)).toHaveLength(0);
 }finally {await legacy.close();}
},20000);

it("null metadata and unapproved staged versions cannot bypass durable selection guards",async()=>{
 const good=assetFixture();await registry.registerAsset(good);await registry.registerDeck({key:"staged",name:"Staged",description:""});
 const manifest={...deckFixture(good.id,"staged"),status:"DRAFT",rights:{...good.rights,state:"UNVERIFIED"}};
 await db.insert(s.tarotDeckVersions).values({deckKey:"staged",version:1,status:"DRAFT",manifest:manifest as never});
 await expect(set("staged")).rejects.toThrow();await expect(media.resolveTarotCardAsset(db,{deckKey:"staged",deckVersion:1,cardKey:"THE_FOOL"})).rejects.toThrow();expect(await media.listSelectableTarotDecks(db,a)).toEqual([]);
 await expect(db.update(s.tarotDeckVersions).set({status:"PUBLISHED",manifest:{...manifest,status:"PUBLISHED"} as never}).where(eq(s.tarotDeckVersions.deckKey,"staged"))).rejects.toThrow();
 for(const field of ["mediaType","contentHash","width","height","byteSize","createdAt"]) {const value={...assetFixture(),[field]:null};await expect(db.insert(s.platformAssets).values({id:value.id,objectKey:value.objectKey,metadata:value as never})).rejects.toThrow();}
});
