import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {readFileSync,readdirSync} from "node:fs";
import {eq} from "drizzle-orm";
import type {Database} from "../src/db/client";
import * as schema from "../src/db/schema";
import {authorizeStore,createWorkspace} from "../src/modules/identity/service";
import {ingestOrder} from "../src/modules/intake/service";
import {fixtureOrders} from "../src/modules/etsy/fixtures";
import type {Scope} from "../src/modules/intake/contracts";
import {captureReceiptFinanceInTransaction as capture,orderFinanceView,refreshOrderFinance,backfillOrderFinance} from "../src/modules/orders-finance/service";
import {ReceiptPilotError} from "../src/modules/etsy/receipt-read";
let pg:PGlite,db:Database,a:Scope,b:Scope,id:string;
const receipt=(patch:Record<string,unknown>={})=>JSON.stringify({receipt_id:2001,updated_timestamp:100,is_paid:true,status:"paid",refunds:[],grandtotal:{amount:"9223372036854775807",divisor:1000,currency_code:"BHD"},...patch});
const save=(body=receipt(),scope=a,orderId=id,shop="77")=>db.transaction(tx=>capture(tx,scope,orderId,body,shop));
async function order(scope=a,externalId="2001"){
 return ingestOrder(db,scope,{...fixtureOrders[0],externalId,lines:[{...fixtureOrders[0].lines[0],externalId:externalId+"1"}]},{suppressProductionAdmission:true});
}
async function operational(){
 const result:Record<string,unknown>={};
 for(const key of ["orders","lineItems","units","customerInputs","generations","productionQueue","aiRequests","documentSnapshots","documentArtifacts","auditLogs"] as const)result[key]=await db.select().from(schema[key]);
 return result;
}
beforeEach(async()=>{
 pg=new PGlite();for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+f,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const user of ["a","b","member"])await db.insert(schema.users).values({id:user,name:user});
 a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","etsy"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","etsy"));
 for(const scope of [a,b]){await db.update(schema.stores).set({externalShopId:scope===a?"77":"88"}).where(eq(schema.stores.id,scope.storeId));await db.update(schema.connections).set({status:"connected"}).where(eq(schema.connections.storeId,scope.storeId));}
 id=await order();
},20000);
afterEach(async()=>{await pg.close();});
it("persists exact int64/currency with provenance, idempotent replay and verified zero",async()=>{
 expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});expect(await save()).toMatchObject({state:"VERIFIED",result:"UPDATED"});
 expect(await save()).toMatchObject({result:"UNCHANGED"});expect(await db.select().from(schema.orderFinances)).toHaveLength(1);
 const [row]=await db.select().from(schema.orderFinances);expect(row).toMatchObject({amount:9223372036854775807n,divisor:1000n,currency:"BHD",receiptId:"2001",shopId:"77",source:"etsy",contract:"etsy-receipt-finance/v1"});expect(row.totalVerifiedAt).toBeInstanceOf(Date);
 expect(await orderFinanceView(db,a,id)).toEqual({state:"VERIFIED",total:{amount:"9223372036854775807",divisor:"1000",currency:"BHD"}});
 await save(receipt({updated_timestamp:101,grandtotal:{amount:0,divisor:1,currency_code:"JPY"}}));expect(await orderFinanceView(db,a,id)).toEqual({state:"VERIFIED",total:{amount:"0",divisor:"1",currency:"JPY"}});
});
it("rejects tenant/order/receipt/shop mismatch before financial writes or HTTP",async()=>{
 const other=await order(b);const reader=vi.fn();
 for(const scope of [b,{...a,userId:"b"},{...a,storeId:b.storeId},{...a,organizationId:b.organizationId}]){await expect(orderFinanceView(db,scope,id)).rejects.toThrow();await expect(refreshOrderFinance(db,scope,id,reader)).rejects.toThrow();}
 await expect(save(receipt({receipt_id:2002}))).rejects.toThrow("FINANCE_RECEIPT_MISMATCH");await expect(save(receipt(),a,other)).rejects.toThrow();await expect(save(receipt(),a,id,"88")).rejects.toThrow();
 expect(reader).not.toHaveBeenCalled();expect(await db.select().from(schema.orderFinances)).toHaveLength(0);
});
it("members can read owned finance but only persisted owners can refresh/backfill",async()=>{
 await save();await db.insert(schema.memberships).values({organizationId:a.organizationId,userId:"member",role:"operator"});const member={...a,userId:"member"};
 expect((await orderFinanceView(db,member,id)).state).toBe("VERIFIED");await expect(refreshOrderFinance(db,member,id,vi.fn())).rejects.toThrow();await expect(backfillOrderFinance(db,member,{})).rejects.toThrow();
 await db.delete(schema.memberships).where(eq(schema.memberships.userId,"a"));await expect(orderFinanceView(db,a,id)).rejects.toThrow();
});
it("schema prevents forged receipt identity, cross-store rows, missing verified values and invalid divisors",async()=>{
 await save();const [row]=await db.select().from(schema.orderFinances);const {id:_,...values}=row;
 for(const patch of [{storeId:b.storeId},{receiptId:"2002"},{amount:null},{divisor:null},{divisor:0n},{divisor:3n},{divisor:1024n},{currency:null},{currency:"usd"},{state:"MISSING"}])await expect(db.update(schema.orderFinances).set(patch).where(eq(schema.orderFinances.id,row.id))).rejects.toThrow();
 await expect(db.insert(schema.orderFinances).values(values)).rejects.toThrow();
});
it("invalid/missing and first-seen refund evidence expose no invented amount",async()=>{
 for(const [patch,state] of [[{grandtotal:null},"MISSING"],[{updated_timestamp:101,grandtotal:{amount:1,divisor:3,currency_code:"USD"}},"INVALID"],[{updated_timestamp:102,refunds:[{}]},"UNCERTAIN"]] as const){expect((await save(receipt(patch))).state).toBe(state);expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});}
});
it("stale receipt cannot overwrite newer evidence; equal-version conflicts stay unavailable until newer evidence",async()=>{
 await save();expect((await save(receipt({updated_timestamp:99}))).result).toBe("STALE");expect((await save(receipt({grandtotal:{amount:10,divisor:1,currency_code:"USD"}}))).state).toBe("UNCERTAIN");
 expect((await save()).state).toBe("UNCERTAIN");expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});expect((await save(receipt({updated_timestamp:101}))).state).toBe("VERIFIED");
});
it("retains pre-refund total while ordinary refund classification and all reading state remain untouched",async()=>{
 await save();const before=await operational();expect((await save(receipt({updated_timestamp:101,refunds:[{}],grandtotal:{amount:1,divisor:100,currency_code:"USD"}}))).result).toBe("RETAINED_ORIGINAL");
 await save(receipt({updated_timestamp:102,grandtotal:{amount:1,divisor:100,currency_code:"USD"}}));expect((await orderFinanceView(db,a,id))).toMatchObject({total:{amount:"9223372036854775807",currency:"BHD"}});expect(await operational()).toEqual(before);
});
it("finance-only refresh is one GET, retry-safe and never recreates readings, increments revisions or mutates execution/PDF state",async()=>{
 const before=await operational(),reader=vi.fn().mockResolvedValue({body:receipt(),shopId:"77",epoch:0,evidence:[]});
 expect(await refreshOrderFinance(db,a,id,reader)).toMatchObject({status:"OK",finance:{state:"VERIFIED"}});expect(await refreshOrderFinance(db,a,id,reader)).toMatchObject({status:"OK",finance:{result:"UNCHANGED"}});
 expect(reader).toHaveBeenCalledTimes(2);expect(reader.mock.calls[0][2]).toBe("2001");expect(await operational()).toEqual(before);
});
it.each([[429,"RATE_LIMIT"],[401,"AUTHORIZATION"],[403,"AUTHORIZATION"],[404,"MISSING_RECEIPT"],[500,"TEMPORARY_FAILURE"]])("handles HTTP %s without financial/operational damage",async(status,outcome)=>{
 await save();const before=await operational(),reader=vi.fn().mockRejectedValue(new ReceiptPilotError("detail",status,120));expect(await refreshOrderFinance(db,a,id,reader)).toMatchObject({status:outcome,...(status===429?{retryAfterSeconds:120}:{})});expect(reader).toHaveBeenCalledOnce();expect(await operational()).toEqual(before);expect((await orderFinanceView(db,a,id)).state).toBe("VERIFIED");
});
it("timeouts, malformed source, missing receipt and changed grant fail safely",async()=>{
 for(const [reader,status] of [[vi.fn().mockRejectedValue(new Error("timeout")),"TEMPORARY_FAILURE"],[vi.fn().mockResolvedValue({body:"{bad",shopId:"77",epoch:0,evidence:[]}),"INVALID_SOURCE"],[vi.fn().mockResolvedValue({body:receipt({receipt_id:2002}),shopId:"77",epoch:0,evidence:[]}),"INVALID_SOURCE"],[vi.fn().mockResolvedValue({body:receipt(),shopId:"77",epoch:1,evidence:[]}),"AUTHORIZATION"]] as const)expect(await refreshOrderFinance(db,a,id,reader)).toMatchObject({status});
 expect(await db.select().from(schema.orderFinances)).toHaveLength(0);
});
it("backfill is bounded, store-scoped, resumable and stops on rate limit without advancing failed order",async()=>{
 for(const externalId of ["2002","2003","2004"])await order(a,externalId);await order(b);const before=await operational();
 const refresh=vi.fn().mockResolvedValueOnce({status:"OK",finance:{state:"MISSING",result:"UPDATED"}}).mockResolvedValueOnce({status:"RATE_LIMIT",retryAfterSeconds:120});
 const first=await backfillOrderFinance(db,a,{limit:3},refresh);expect(first).toMatchObject({done:false,stopped:"RATE_LIMIT",retryAfterSeconds:120});expect(first.results).toHaveLength(2);expect(first.next).toBe(first.results[0].orderId);
 const resumed=vi.fn().mockResolvedValue({status:"MISSING_RECEIPT"});const second=await backfillOrderFinance(db,a,{limit:2,after:first.next!},resumed);expect(second.results[0].orderId).toBe(first.results[1].orderId);expect(second.results).toHaveLength(2);expect(second.done).toBe(false);
 const last=await backfillOrderFinance(db,a,{limit:2,after:second.next!},resumed);expect(last.done).toBe(true);expect(last.results).toHaveLength(1);expect(await operational()).toEqual(before);
 const foreign=await order(b,"2005");await expect(backfillOrderFinance(db,a,{after:foreign},resumed)).rejects.toThrow();await expect(backfillOrderFinance(db,a,{limit:21},resumed)).rejects.toThrow();
});
it("backfill stops authorization/DB failures and retries the same first cursor safely",async()=>{
 for(const refresh of [vi.fn().mockResolvedValue({status:"AUTHORIZATION"}),vi.fn().mockRejectedValue(new Error("database"))]){const result=await backfillOrderFinance(db,a,{limit:20},refresh);expect(result.done).toBe(false);expect(result.next).toBeNull();expect(result.results).toHaveLength(1);}
});
it("optional finance read/database write failure does not destroy ordinary orders or previous verified evidence",async()=>{
 await save();const before=await operational();await pg.exec('ALTER TABLE order_finances RENAME TO unavailable_finances');
 expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});expect(await refreshOrderFinance(db,a,id,vi.fn().mockResolvedValue({body:receipt(),shopId:"77",epoch:0,evidence:[]}))).toMatchObject({status:"TEMPORARY_FAILURE"});expect(await operational()).toEqual(before);
});

it("refund observations at the same timestamp still permanently fence replacement totals",async()=>{
 await save();await save(receipt({refunds:[{}],grandtotal:{amount:1,divisor:100,currency_code:"USD"}}));
 await save(receipt({updated_timestamp:101,grandtotal:{amount:1,divisor:100,currency_code:"USD"}}));expect(await orderFinanceView(db,a,id)).toMatchObject({total:{amount:"9223372036854775807",currency:"BHD"}});
 const [row]=await db.select().from(schema.orderFinances);expect(row.refundObservedAt).toBeInstanceOf(Date);expect(row.totalSourceUpdatedAt).toBe(100);
});
it("shop rebinding cannot expose or overwrite the previous shop's financial evidence",async()=>{
 await save();await db.update(schema.stores).set({externalShopId:"99"}).where(eq(schema.stores.id,a.storeId));expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});await expect(save(receipt({updated_timestamp:101}),a,id,"99")).rejects.toThrow();
});

it("a refund with missing timestamp fences the proven original without moving source version backwards",async()=>{
 await save();await save(receipt({updated_timestamp:null,refunds:[{}]}));await save(receipt({updated_timestamp:101,grandtotal:{amount:1,divisor:100,currency_code:"USD"}}));expect(await orderFinanceView(db,a,id)).toMatchObject({total:{amount:"9223372036854775807",currency:"BHD"}});
 const [row]=await db.select().from(schema.orderFinances);expect(row.sourceUpdatedAt).toBe(101);expect(row.refundObservedAt).toBeInstanceOf(Date);
});

it("a first-seen refund cannot later become a verified original merely because refund evidence disappears",async()=>{
 await save(receipt({refunds:[{}]}));expect((await save(receipt({updated_timestamp:101}))).state).toBe("UNCERTAIN");expect(await orderFinanceView(db,a,id)).toEqual({state:"UNAVAILABLE"});const [row]=await db.select().from(schema.orderFinances);expect(row.refundObservedAt).toBeInstanceOf(Date);expect(row.amount).toBeNull();
});
it("concurrent duplicate refreshes converge to one financial record without operational effects",async()=>{
 const before=await operational(),reader=vi.fn().mockResolvedValue({body:receipt(),shopId:"77",epoch:0,evidence:[]});
 const results=await Promise.all([refreshOrderFinance(db,a,id,reader),refreshOrderFinance(db,a,id,reader)]);expect(results.every(result=>result.status==="OK")).toBe(true);expect(await db.select().from(schema.orderFinances)).toHaveLength(1);expect(await operational()).toEqual(before);
});
it("real finance backfill composition fetches only its bounded owned page and persists each exact receipt once",async()=>{
 await order(a,"2002");await order(a,"2003");await order(b);const before=await operational();
 const reader=vi.fn(async(_db:Database,_scope:Scope,receiptId:string)=>({body:receipt({receipt_id:receiptId}),shopId:"77",epoch:0,evidence:[]}));
 const refresh=(db:Database,scope:Scope,orderId:string)=>refreshOrderFinance(db,scope,orderId,reader);
 const first=await backfillOrderFinance(db,a,{limit:2},refresh);expect(first.results).toHaveLength(2);expect(first.done).toBe(false);expect(reader).toHaveBeenCalledTimes(2);expect(await db.select().from(schema.orderFinances)).toHaveLength(2);
 const last=await backfillOrderFinance(db,a,{limit:2,after:first.next!},refresh);expect(last.done).toBe(true);expect(reader).toHaveBeenCalledTimes(3);const rows=await db.select().from(schema.orderFinances);expect(rows).toHaveLength(3);expect(rows.every(row=>row.storeId===a.storeId&&row.shopId==="77")).toBe(true);expect(new Set(rows.map(row=>row.receiptId)).size).toBe(3);expect(await operational()).toEqual(before);
});
