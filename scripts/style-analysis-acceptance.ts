// Synthetic-only, offline by default. Never imported by application routes.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { createWorkspace, authorizeStore } from "../src/modules/identity/service";
import { editStyle, addPreviousWork } from "../src/modules/seller-style/service";
import { styleAnalysisRuntime } from "../src/infrastructure/ai/runtime";
import { CentralAIGateway } from "../src/infrastructure/ai/gateway";
import { FakeGenerationProvider } from "../src/infrastructure/ai/fake";
import { pricingFor } from "../src/infrastructure/ai/pricing";
import { StyleAnalysisExecutionService } from "../src/modules/seller-style/analysis-execution";
import { styleIntelligence } from "../src/modules/seller-style/analysis-contracts";
import { acceptanceArguments, claimAcceptanceAttempt } from "./lib/acceptance-attempt";
import { randomUUID } from "node:crypto";
const args=acceptanceArguments(process.argv.slice(2));
assert.equal(args.model,undefined,"Model overrides are not supported by this harness");
const model=process.env.AI_GENERATION_MODEL||"gemini-3.5-flash-lite";
if(args.live){assert.equal(model,"gemini-3.5-flash-lite");assert.equal(process.env.AI_PROVIDER,"google");assert.ok(process.env.GEMINI_API_KEY,"Credentials required");}
const location=mkdtempSync(join(tmpdir(),"reading-os-style-synthetic-")),pg=new PGlite(join(location,"database"));
let dispatches=0;const transport=globalThis.fetch;
try {
 for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));
 const db=drizzle(pg,{schema}) as unknown as Database;
 await db.insert(schema.users).values({id:"style-acceptance-owner",name:"Synthetic Owner"});
 const scope=await authorizeStore(db,"style-acceptance-owner",await createWorkspace(db,"style-acceptance-owner","Synthetic Style Acceptance","fixtures"),true);
 const profile=await editStyle(db,scope);
 for(const [i,text] of ["Thank you for sharing this moment. I begin with a gentle acknowledgment, then explain each idea in short paragraphs. Possibilities remain open, and the closing invites reflection rather than promising an outcome.","Welcome. Let us move through the interpretation one thought at a time. Each paragraph explains the reasoning with calm, ordinary words. A soft transition connects the ideas, and a short closing offers room for personal choice."].entries())await addPreviousWork(db,scope,{title:"Synthetic example "+(i+1),text,commandKey:randomUUID()});
 let commandKey=randomUUID();
 if(args.live){
  const markerDirectory=join(process.cwd(),".style-acceptance");mkdirSync(markerDirectory,{recursive:true,mode:0o700});
  commandKey=claimAcceptanceAttempt(args.attemptId!,markerDirectory,model).commandKey;
  globalThis.fetch=async(input,init)=>{assert.equal(dispatches,0,"Second dispatch forbidden");assert.equal(String(input),"https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent");dispatches++;return transport(input,init);};
 }else globalThis.fetch=async()=>{throw new Error("NETWORK_DISABLED");};
 const fake=new FakeGenerationProvider();
 const service=args.live?styleAnalysisRuntime(db):new StyleAnalysisExecutionService(db,new CentralAIGateway(db,{provider:fake,model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),maxOutputTokens:8192,dailyBudgetNanos:0n,attemptBudgetNanos:0n}));
 let result:Awaited<ReturnType<typeof service.execute>>|undefined;
 try{result=await service.executeForSeller(scope,{styleProfileId:profile.styleProfileId,commandKey});}catch{ /* Report only durable safe state; never print provider exceptions. */ }
 const requests=await db.select().from(schema.aiRequests),usage=await db.select().from(schema.usageEvents),analyses=await db.select().from(schema.styleAnalysisVersions);
 assert.ok(requests.length<=1&&usage.length<=1&&dispatches<=1);
 console.log(JSON.stringify({live:args.live,attemptId:args.attemptId??null,realDispatchCount:dispatches,fakeDispatchCount:fake.calls,aiRequestCount:requests.length,usageEventCount:usage.length,analysisStatus:result?.status??analyses[0]?.status??"NOT_ADMITTED",contractValidated:result?.status==="READY"&&styleIntelligence.safeParse(result.payload).success,requestStatus:requests[0]?.status??null,costState:usage[0]?.costState??null,settledAmountNanos:usage[0]?.amountNanos?.toString()??null,accountingSettled:!!requests[0]?.finishedAt,isolatedSyntheticDatabase:location}));
 if(!result||result.status!=="READY")process.exitCode=1;
}finally{globalThis.fetch=transport;await pg.close();}
