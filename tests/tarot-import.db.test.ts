import {beforeEach,afterEach,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {migrate} from "drizzle-orm/pglite/migrator";
import {eq} from "drizzle-orm";
import * as s from "../src/db/schema";
import type {Database} from "../src/db/client";
import type {Scope} from "../src/modules/intake/contracts";
import {loadBundledDeck} from "../src/modules/media/bundled-deck";
import {platformMediaRegistry} from "../src/modules/media/platform-registry";
import {resolveTarotCardAsset,readFrozenPlatformAssetBytes} from "../src/modules/media/service";
import {configuredPlatformAssets} from "../src/infrastructure/document-runtime";
import {createWorkspace,authorizeStore} from "../src/modules/identity/service";
import {studioPreviewMedia} from "../src/modules/documents/studio-media";
let pg:PGlite,db:Database,a:Scope,b:Scope;
beforeEach(async()=>{pg=new PGlite();await migrate(drizzle(pg,{schema:s}),{migrationsFolder:"drizzle"});db=drizzle(pg,{schema:s}) as unknown as Database;for(const id of ["a","b"])await db.insert(s.users).values({id,name:id});a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));},20000);
afterEach(async()=>pg.close());
it("imports and resolves all 78 real artwork resources; re-import and overlapping imports retain exact inventory",async()=>{
 const p=await loadBundledDeck(),registry=platformMediaRegistry(db);await registry.importApprovedDeck(p);await registry.importApprovedDeck(p);await Promise.all([registry.importApprovedDeck(p),registry.importApprovedDeck(p)]);
 expect(await db.select().from(s.platformAssets)).toHaveLength(78);expect(await db.select().from(s.tarotDecks)).toHaveLength(1);expect(await db.select().from(s.tarotDeckVersions)).toHaveLength(1);
 for(const m of p.version.mappings){const r=await resolveTarotCardAsset(db,{deckKey:p.deck.key,deckVersion:1,cardKey:m.cardKey});expect(r.asset.id).toBe(m.assetId);expect((await readFrozenPlatformAssetBytes(db,configuredPlatformAssets(),r.asset)).length).toBe(r.asset.byteSize);}
 expect(await db.select().from(s.storeTarotPreferences)).toHaveLength(0);expect(await db.select().from(s.units)).toHaveLength(0);
},20000);
it("an immutable existing package conflict rolls back without changing approved metadata",async()=>{
 const p=await loadBundledDeck(),registry=platformMediaRegistry(db);await registry.importApprovedDeck(p);const changed={...p,assets:p.assets.map((a,i)=>i?a:{...a,rights:{...a.rights,notes:"different evidence"}})};await expect(registry.importApprovedDeck(changed)).rejects.toThrow();expect((await db.select().from(s.platformAssets).where(eq(s.platformAssets.id,p.assets[0].id)))[0].metadata).toEqual(p.assets[0]);expect(await db.select().from(s.platformAssets)).toHaveLength(78);
});
it("preview resolves deterministic approved samples only for an authorized Store, without Store or Reading writes",async()=>{
 await platformMediaRegistry(db).importApprovedDeck(await loadBundledDeck());const one=await studioPreviewMedia(db,a),two=await studioPreviewMedia(db,a);expect(one.media).toEqual(two.media);expect(one.media.cards.map(c=>c.cardKey)).toEqual(["THE_FOOL","THE_LOVERS","THE_STAR"]);for(const c of one.media.cards)expect((await one.readAsset(c.asset)).length).toBe(c.asset.byteSize);
 await expect(studioPreviewMedia(db,{...a,userId:b.userId})).rejects.toThrow();await expect(studioPreviewMedia(db,{...a,storeId:b.storeId})).rejects.toThrow();expect(await db.select().from(s.storeTarotPreferences)).toHaveLength(0);expect(await db.select().from(s.documentSnapshots)).toHaveLength(0);expect(await db.select().from(s.units)).toHaveLength(0);
});
it("missing or retired preview deck is recoverable failure, never synthetic replacement",async()=>{
 await expect(studioPreviewMedia(db,a)).rejects.toThrow();const p=await loadBundledDeck(),registry=platformMediaRegistry(db);await registry.importApprovedDeck(p);await registry.retireVersion({deckKey:p.deck.key,deckVersion:1});await expect(studioPreviewMedia(db,a)).rejects.toThrow();expect(await db.select().from(s.units)).toHaveLength(0);
});
