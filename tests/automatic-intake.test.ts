import {it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {readReceiptPage,ReceiptPilotError} from "../src/modules/etsy/receipt-read";
import {automaticIntakeConfigured} from "../src/modules/etsy/automatic-intake";
const window={cutoff:1700000000,from:1700000000,through:1700000600,offset:0};
const result={receipt_id:900,shop_id:77,created_timestamp:1700000000,updated_timestamp:1700000100,customer_answers:"not retained"};
const fetcher=(body:unknown)=>vi.fn(async()=>new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}})) as unknown as typeof fetch;
it("uses documented bounded OAuth enumeration, retains only receipt identity, and does not filter away canceled receipts",async()=>{
 const f=fetcher({count:11,results:[result]});const page=await readReceiptPage("77","synthetic-token",{clientId:"app",secret:"synthetic"},window,f);
 expect(page).toEqual({receipts:[{receiptId:"900",modified:1700000100}],complete:false});
 const [url,options]=vi.mocked(f).mock.calls[0];const u=new URL(String(url));expect(u.hostname).toBe("api.etsy.com");expect(u.searchParams.get("limit")).toBe("10");expect(u.searchParams.get("sort_on")).toBe("receipt_id");expect(u.searchParams.get("was_paid")).toBeNull();expect(u.searchParams.get("was_canceled")).toBeNull();expect(options?.redirect).toBe("error");
 expect(JSON.stringify(page)).not.toContain("customer_answers");
});
it("offset continuity and final-page exhaustion are explicit",async()=>{
 const page=await readReceiptPage("77","token",{clientId:"app",secret:"secret"},{...window,offset:10},fetcher({count:11,results:[result]}));expect(page.complete).toBe(true);
});
it.each([{...result,shop_id:88},{...result,created_timestamp:1699999999},{...result,updated_timestamp:1700000601},{receipt_id:900},{...result,receipt_id:0}])("rejects unresolved ownership/timestamps/unsafe identity",async r=>{await expect(readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,fetcher({count:1,results:[r]}))).rejects.toThrow();});
it("rejects duplicate, empty partial and oversized pages",async()=>{for(const data of [{count:2,results:[result,result]},{count:1,results:[]},{count:11,results:Array.from({length:11},()=>result)}])await expect(readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,fetcher(data))).rejects.toThrow();});
it("rate limiting and timeouts propagate without implicit retries",async()=>{
 const rate=vi.fn(async()=>new Response("",{status:429,headers:{"retry-after":"120"}})) as unknown as typeof fetch;
 await expect(readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,rate)).rejects.toMatchObject({httpStatus:429,retryAfterSeconds:120});expect(rate).toHaveBeenCalledTimes(1);
 const timeout=vi.fn(async()=>{throw new DOMException("synthetic","TimeoutError");}) as unknown as typeof fetch;await expect(readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,timeout)).rejects.toThrow();expect(timeout).toHaveBeenCalledTimes(1);
});
it("response byte bound and invalid JSON fail safely",async()=>{
 const large=vi.fn(async()=>new Response("x".repeat(1048577),{headers:{"content-type":"application/json"}})) as unknown as typeof fetch;
 await expect(readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,large)).rejects.toBeInstanceOf(ReceiptPilotError);
});
it("normal Orders has no receipt form and diagnostics are gated at page and command boundaries",()=>{
 const page=readFileSync("src/app/(operations)/orders/page.tsx","utf8"),diagnostics=readFileSync("src/app/etsy/diagnostics/page.tsx","utf8"),action=readFileSync("src/app/(operations)/orders/actions.ts","utf8");
 expect(page).not.toContain("OrderSync");expect(page).not.toContain("receiptId");expect(page).toContain("automaticIntakeStatus");expect(diagnostics).toContain("internalOperatorAllowed");expect(diagnostics).toContain("verifyScope(database(),scope,true)");expect(action).toContain("assertInternalOperator(scope.userId)");
 const worker=readFileSync("scripts/etsy-intake-worker.ts","utf8");expect(worker).not.toMatch(/productionRuntime|GenerationService|Gemini|documentRuntime/);
});
it("configuration alone is not a runtime activity claim",()=>{expect(automaticIntakeConfigured({ETSY_AUTOMATIC_INTAKE_ENABLED:"true"})).toBe(false);expect(automaticIntakeConfigured({ETSY_AUTOMATIC_INTAKE_ENABLED:"true",ETSY_ADAPTER:"etsy",ETSY_LIVE_OAUTH_ENABLED:"true"})).toBe(true);});

it("HTTP integer lexemes beyond JavaScript precision remain exact strings",async()=>{const f=vi.fn(async()=>new Response('{"count":1,"results":[{"receipt_id":9007199254740993,"created_timestamp":1700000000,"updated_timestamp":1700000100}]}',{headers:{"content-type":"application/json"}})) as unknown as typeof fetch;expect((await readReceiptPage("77","token",{clientId:"app",secret:"secret"},window,f)).receipts[0].receiptId).toBe("9007199254740993");});
