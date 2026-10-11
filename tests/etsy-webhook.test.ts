import {it,expect,vi} from "vitest";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {verifyEtsyWebhookSignature} from "../src/modules/etsy/webhook-digest";
import {authenticateEtsyWebhook,handleEtsyWebhook,type VerifiedWebhook} from "../src/modules/etsy/webhook-receiver";

const secret="whsec_"+Buffer.from("synthetic-etsy-signing-key").toString("base64");
const now=1791722935;
const body=Buffer.from(JSON.stringify({event_type:"order.paid",resource_url:"https://api.etsy.com/v3/application/shops/77/receipts/900",shop_id:77}));
function proof(rawBody=body) {
  const messageId="msg_fixture",timestamp=String(now);
  const digest=createHmac("sha256",Buffer.from(secret.slice(6),"base64")).update(`${messageId}.${timestamp}.`).update(rawBody).digest("base64");
  return {messageId,timestamp,rawBody,signature:`v1,${digest}`,secret,nowSeconds:now};
}
function request(rawBody=body,headers:Record<string,string>={}) {
  const p=proof(rawBody);
  return new Request("https://reading.example/api/webhooks/etsy",{method:"POST",body:new Uint8Array(rawBody),headers:{"webhook-id":p.messageId,"webhook-timestamp":p.timestamp,"webhook-signature":p.signature,...headers}});
}
it("verifies v1 and multiple rotation entries with any matching digest",()=>{
  const p=proof(),wrong=Buffer.alloc(32).toString("base64");
  expect(verifyEtsyWebhookSignature(p)).toBe(true);
  expect(verifyEtsyWebhookSignature({...p,signature:`v1,${wrong} ${p.signature}`})).toBe(true);
  expect(verifyEtsyWebhookSignature({...p,signature:`${p.signature} v1,${wrong}`})).toBe(true);
});
it.each(["v2,AAAA","AAAA","v1,%%%","v1,AAAA","v1,AAAA=="])("rejects unsupported or malformed header %s",signature=>{
  expect(verifyEtsyWebhookSignature({...proof(),signature})).toBe(false);
});
it("malformed or unknown entries invalidate even an otherwise valid header",()=>{
  for(const extra of [" v2,AAAA"," v1,%%%"," ","\tv1,AAAA",",v1,AAAA"])
    expect(verifyEtsyWebhookSignature({...proof(),signature:proof().signature+extra})).toBe(false);
});
it("bounds entries, identity and header size without unversioned fallback",()=>{
  const p=proof();
  for(const signature of [Array(9).fill(p.signature).join(" "),"v1,"+"A".repeat(4096),p.signature.slice(3)])expect(verifyEtsyWebhookSignature({...p,signature})).toBe(false);
  expect(verifyEtsyWebhookSignature({...p,messageId:"msg.with.dot"})).toBe(false);
});
it.each(["signature","timestamp","messageId","secret"] as const)("rejects missing %s",field=>{
  expect(verifyEtsyWebhookSignature({...proof(),[field]:undefined})).toBe(false);
});
it("raw body integrity and timestamp freshness remain mandatory",()=>{
  expect(verifyEtsyWebhookSignature({...proof(),rawBody:Buffer.from("{}")})).toBe(false);
  expect(verifyEtsyWebhookSignature({...proof(),nowSeconds:now+301})).toBe(false);
});
it("durably accepts only after verification, with bounded evidence and no raw payload",async()=>{
  const accept=vi.fn(async(_event:VerifiedWebhook)=>{});
  expect((await handleEtsyWebhook(request(),{secret,nowSeconds:now,accept})).status).toBe(204);
  const event=accept.mock.calls[0][0];expect(event).toMatchObject({eventId:"msg_fixture",shopId:"77",receiptId:"900",eventType:"order.paid"});
  expect(Object.keys(event)).toEqual(["eventId","eventType","shopId","receiptId","bodyHash","signedAt"]);
  expect(Object.isFrozen(event)).toBe(true);
});
it("invalid signature, altered body and missing headers never reach persistence",async()=>{
  for(const req of [request(body,{"webhook-signature":"v1,"+Buffer.alloc(32).toString("base64")}),request(Buffer.from("{}"),{"webhook-signature":proof().signature}),request(body,{"webhook-timestamp":""}),request(body,{"webhook-id":""})]){
    const accept=vi.fn(async()=>{});expect((await handleEtsyWebhook(req,{secret,nowSeconds:now,accept})).status).toBe(401);expect(accept).not.toHaveBeenCalled();
  }
});
it.each(["{}","{",JSON.stringify({event_type:"unknown",resource_url:"https://api.etsy.com/v3/application/shops/77/receipts/900",shop_id:77})])("rejects signed malformed/unsupported payload before acceptance",async raw=>{
  const accept=vi.fn(async()=>{});expect((await handleEtsyWebhook(request(Buffer.from(raw)),{secret,nowSeconds:now,accept})).status).toBe(400);expect(accept).not.toHaveBeenCalled();
});
it.each(["https://evil.example/v3/application/shops/77/receipts/900","https://api.etsy.com@evil.example/v3/application/shops/77/receipts/900","https://api.etsy.com/v3/application/shops/88/receipts/900","https://api.etsy.com/v3/application/shops/77/receipts/900?secret=1","http://api.etsy.com/v3/application/shops/77/receipts/900"])("rejects resource substitution %s",resource_url=>{
  const raw=Buffer.from(JSON.stringify({event_type:"order.paid",resource_url,shop_id:77}));expect(()=>authenticateEtsyWebhook(proof(raw))).toThrow("INVALID_WEBHOOK_PAYLOAD");
});
it("retains large identifier precision from raw JSON",()=>{
  const raw=Buffer.from('{"event_type":"order.paid","resource_url":"https://api.etsy.com/v3/application/shops/9007199254740993/receipts/900","shop_id":9007199254740993}');
  expect(authenticateEtsyWebhook(proof(raw))?.shopId).toBe("9007199254740993");
});
it("missing secret, non-POST, oversized body and invalid UTF-8 fail safely",async()=>{
  const accept=vi.fn(async()=>{});
  expect((await handleEtsyWebhook(request(),{accept,nowSeconds:now})).status).toBe(503);
  expect((await handleEtsyWebhook(new Request("https://reading.example",{method:"GET"}),{accept,secret})).status).toBe(405);
  expect((await handleEtsyWebhook(request(Buffer.alloc(65537)),{accept,secret,nowSeconds:now})).status).toBe(413);
  expect((await handleEtsyWebhook(request(body,{"content-length":"65537"}),{accept,secret,nowSeconds:now})).status).toBe(413);
  expect((await handleEtsyWebhook(request(Buffer.from([255])),{accept,secret,nowSeconds:now})).status).toBe(400);
  expect(accept).not.toHaveBeenCalled();
});
it("durable insert failure is not falsely acknowledged",async()=>{
  const accept=vi.fn(async()=>{throw new Error("synthetic database failure");});
  const response=await handleEtsyWebhook(request(),{accept,secret,nowSeconds:now});expect(response.status).toBe(503);expect(await response.text()).toBe("");
});
it("does not acknowledge before the durable write resolves",async()=>{
  let release!:()=>void;const durable=new Promise<void>(resolve=>{release=resolve;});
  const accept=vi.fn(()=>durable);let settled=false;
  const response=handleEtsyWebhook(request(),{accept,secret,nowSeconds:now}).then(r=>{settled=true;return r;});
  await vi.waitFor(()=>expect(accept).toHaveBeenCalled());expect(settled).toBe(false);release();expect((await response).status).toBe(204);
});
it("normal Orders contains no developer configuration and diagnostics retain both gates",()=>{
  const page=readFileSync("src/app/(operations)/orders/page.tsx","utf8"),diag=readFileSync("src/app/etsy/diagnostics/page.tsx","utf8"),worker=readFileSync("scripts/etsy-webhook-worker.ts","utf8");
  expect(page).not.toContain("receiptId");expect(page).not.toContain("SIGNING_SECRET");expect(page).toContain("webhookIntakeStatus");expect(page).toContain("Backup polling / reconciliation");
  expect(diag).toContain("internalOperatorAllowed");expect(diag).toContain("verifyScope(database(),scope,true)");expect(diag).toContain("Webhook intake history");
  expect(worker).not.toMatch(/runAutomaticIntakeTick|Gemini|GenerationService|productionRuntime|documentRuntime/);
});
