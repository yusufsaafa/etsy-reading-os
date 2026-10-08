import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite,drizzle} from "./adapter";
import {readFileSync,readdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import type {Database} from "../../src/db/client";
import * as schema from "../../src/db/schema";
import {createWorkspace,authorizeStore} from "../../src/modules/identity/service";
import {ingestListing,workspaceData} from "../../src/modules/intake/service";
import {beginEtsyProductDraft,activateProduct,productData} from "../../src/modules/products/service";
import {authorizeHistoricalAdoption} from "../../src/modules/products/historical-adoption";
import {ingestControlledReceipt} from "../../src/modules/etsy/controlled-intake";
import {normalizeEtsyReceipt} from "../../src/modules/etsy/raw-normalizer";
import {fixtureListings} from "../../src/modules/etsy/fixtures";
import {rawReceipt} from "../fixtures/etsy-raw";
import {policy} from "../fixtures/etsy-source";
import type {Scope} from "../../src/modules/intake/contracts";
let pg:PGlite,db:Database,scope:Scope,version:string;
beforeEach(async()=>{vi.stubEnv("ETSY_ADAPTER","fixtures");pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;await db.insert(schema.users).values({id:"owner",name:"Synthetic owner"});scope=await authorizeStore(db,"owner",await createWorkspace(db,"owner","Synthetic","fixtures"));await db.update(schema.stores).set({externalShopId:"77"}).where(eq(schema.stores.id,scope.storeId));for(const listing of fixtureListings)await ingestListing(db,scope,listing);const product=await beginEtsyProductDraft(db,scope,policy());version=(await productData(db,scope,product)).draft!.id;await activateProduct(db,scope,product,version,0,{name:"Reading",configuration:{etsyFulfillment:policy(),inputs:[{id:"question",key:"question",label:"Context",type:"LONG_TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"body",title:"Reading",instruction:"",sortOrder:0}],output:"TEXT",workflow:"ASSISTED"}});},30000);
afterEach(async()=>{vi.unstubAllEnvs();await pg.close();});
function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
async function blockedWriters(){const deadline=Date.now()+5000;while(Date.now()<deadline){const result=await pg.query<{count:number}>("select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock'");if(result.rows[0].count>=2)return;await new Promise(r=>setTimeout(r,10));}throw new Error("Independent lock waiters not observed");}
for(let i=1;i<=3;i++)it(`native fenced Store lock: concurrent adoption and ingestion replay ${i}`,async()=>{
 const r=rawReceipt(),body=JSON.stringify(r),source=normalizeEtsyReceipt(body,{verifiedShopId:"77",observedAt:1700000020})[0];
 const adoption={contractVersion:"etsy-historical-adoption/v2",commandId:randomUUID(),productVersionId:version,source};
 const entered=barrier(),release=barrier();
 const holder=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${scope.storeId} for update`);entered.release();await release.promise;});await entered.promise;
 const approvals=Promise.all([authorizeHistoricalAdoption(db,scope,adoption),authorizeHistoricalAdoption(db,scope,adoption)]);
 try{await blockedWriters();}finally{release.release();}await holder;
 const [one,two]=await approvals;expect(one.id).toBe(two.id);expect(await db.select().from(schema.etsyHistoricalAdoptions)).toHaveLength(1);
 const entered2=barrier(),release2=barrier();const holder2=db.transaction(async tx=>{await tx.execute(sql`select id from stores where id=${scope.storeId} for update`);entered2.release();await release2.promise;});await entered2.promise;
 const command={commandId:randomUUID(),receiptId:"900",approvedVersions:{"901":version}};
 const ingestions=Promise.all([ingestControlledReceipt(db,scope,body,1700000030,command),ingestControlledReceipt(db,scope,body,1700000040,command)]);
 try{await blockedWriters();}finally{release2.release();}await holder2;const [first,second]=await ingestions;expect(first.orderId).toBe(second.orderId);
 const data=await workspaceData(db,scope);expect([data.orders.length,data.lines.length,data.units.length,data.inputs.length]).toEqual([1,1,1,1]);expect(data.units[0].issues).toEqual([]);expect(await db.select().from(schema.productionQueue)).toHaveLength(0);expect(await db.select().from(schema.generations)).toHaveLength(0);
},30000);
it("native independent backend IDs and server metadata",async()=>{const reserved=await Promise.all([pg.client.reserve(),pg.client.reserve(),pg.client.reserve()]);try{const rows=await Promise.all(reserved.map(c=>c`select pg_backend_pid() as pid, current_setting('transaction_isolation') as isolation, version() as version`));expect(new Set(rows.map(r=>r[0].pid)).size).toBe(3);expect(rows.every(r=>r[0].isolation==="read committed")).toBe(true);console.log("Native Etsy acceptance:",rows[0][0].version,"; 3 independent reserved connections; READ COMMITTED");}finally{reserved.forEach(c=>c.release());}});
