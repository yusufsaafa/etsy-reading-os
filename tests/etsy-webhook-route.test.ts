import {afterEach,it,expect,vi} from "vitest";
import {createHmac} from "node:crypto";
const calls=vi.hoisted(()=>({db:vi.fn(()=>({synthetic:true})),accept:vi.fn(async()=>({id:"synthetic"}))}));
vi.mock("../src/db/client",()=>({database:calls.db}));
vi.mock("../src/modules/etsy/webhook-intake",()=>({acceptVerifiedWebhook:calls.accept}));
import {POST} from "../src/app/api/webhooks/etsy/route";
const secret="whsec_"+Buffer.from("synthetic-etsy-signing-key").toString("base64");
function signedRequest(){
  const id="msg_route",timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify({event_type:"order.paid",resource_url:"https://api.etsy.com/v3/application/shops/77/receipts/900",shop_id:77});
  const signature="v1,"+createHmac("sha256",Buffer.from(secret.slice(6),"base64")).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://reading.example/api/webhooks/etsy",{method:"POST",body,headers:{"webhook-id":id,"webhook-timestamp":timestamp,"webhook-signature":signature}});
}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("actual route rejects unsigned requests before opening the database",async()=>{
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);const response=await POST(new Request("https://reading.example",{method:"POST",body:"{}"}));
  expect(response.status).toBe(401);expect(calls.db).not.toHaveBeenCalled();expect(calls.accept).not.toHaveBeenCalled();
});
it("actual route uses server configuration and durable acceptance for a signed event",async()=>{
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);expect((await POST(signedRequest())).status).toBe(204);expect(calls.db).toHaveBeenCalledOnce();expect(calls.accept).toHaveBeenCalledOnce();
});
it("actual route refuses acceptance when persistence fails",async()=>{
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);calls.accept.mockRejectedValueOnce(new Error("synthetic secret internal details"));const response=await POST(signedRequest());expect(response.status).toBe(503);expect(await response.text()).toBe("");
});

it("actual route accepts a prefixless Base64 key with the unchanged v1 signature", async()=>{
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret.slice(6));
  expect((await POST(signedRequest())).status).toBe(204);
  expect(calls.accept).toHaveBeenCalledOnce();
});
it.each(["", "plain-secret", "AB", "whsec_!"])("actual route rejects malformed secret before opening the database (case %#)",async configured=>{
  vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",configured);
  expect((await POST(signedRequest())).status).toBe(503);
  expect(calls.db).not.toHaveBeenCalled();
  expect(calls.accept).not.toHaveBeenCalled();
});

it("signed Portal route never constructs a database or invokes durable acceptance",async()=>{
 vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);
 const req=signedRequest();req.headers.set("webhook-test","true");
 expect((await POST(req)).status).toBe(204);
 expect(calls.db).not.toHaveBeenCalled();expect(calls.accept).not.toHaveBeenCalled();
});
