import {afterEach, expect, it, vi} from "vitest";
import type {DbExecutor} from "../src/db/client";
import {webhookSecretConfigured} from "../src/modules/etsy/webhook-digest";
vi.mock("../src/modules/intake/service",async importOriginal=>({...await importOriginal<object>(),verifyScope:vi.fn(async()=>{})}));
import {webhookIntakeStatus} from "../src/modules/etsy/webhook-intake";
const scope={organizationId:"synthetic-org",storeId:"synthetic-store",userId:"synthetic-user"};
const encoded=Buffer.from("synthetic-etsy-signing-key").toString("base64");
afterEach(()=>vi.unstubAllEnvs());
it.each([encoded,"whsec_"+encoded,"","plain-secret","AB","whsec_!"])("intake status uses the receiver's shared secret validation (case %#)",async secret=>{
 vi.stubEnv("ETSY_WEBHOOK_SIGNING_SECRET",secret);
 const results=[[{source:"etsy",externalShopId:"77"}],[{status:"connected",encryptedTokens:"synthetic",scopes:["transactions_r"],epoch:1}],[]];
 const select=vi.fn(()=>{const rows=results.shift();const query={from:()=>query,where:()=>query,orderBy:()=>query,limit:()=>query,then:(resolve:(rows:unknown)=>unknown)=>Promise.resolve(rows).then(resolve)};return query;});
 const status=await webhookIntakeStatus({select} as unknown as DbExecutor,scope);
 expect(status.includes("Webhook receiver configured.")).toBe(webhookSecretConfigured(secret));
 expect(select).toHaveBeenCalledTimes(webhookSecretConfigured(secret)?3:2);
});
