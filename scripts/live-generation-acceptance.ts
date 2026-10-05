import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client";
import { authorizeStore } from "../src/modules/identity/service";
import { generationRuntime } from "../src/infrastructure/ai/runtime";
import { generationAccounting } from "../src/modules/generation/service";
// Explicitly opt-in, one eligible synthetic reading, same application command and accounting.
if(process.env.LIVE_AI_ACCEPTANCE!=="1")throw new Error("Set LIVE_AI_ACCEPTANCE=1 to authorize one provider request");
if(!process.env.GEMINI_API_KEY){console.log("Live provider acceptance not executed because credentials were not available.");process.exit(0);}
if(process.env.AI_PROVIDER!=="google")throw new Error("AI_PROVIDER=google required");
const url=process.env.DATABASE_URL;
if(!url||!process.env.LIVE_AI_STORE_ID||!process.env.LIVE_AI_UNIT_ID||!process.env.LIVE_AI_USER_ID)throw new Error("DATABASE_URL and LIVE_AI_USER_ID/STORE_ID/UNIT_ID required");
const parsed=new URL(url);
if(!["localhost","127.0.0.1"].includes(parsed.hostname)||!parsed.pathname.startsWith("/reading_os_acceptance"))throw new Error("Use an isolated local reading_os_acceptance database with synthetic customer data");
const {db,client}=createDatabase(url);
try{
 const scope=await authorizeStore(db,process.env.LIVE_AI_USER_ID,process.env.LIVE_AI_STORE_ID,true);
 const result=await generationRuntime(db).prepare(scope,{unitId:process.env.LIVE_AI_UNIT_ID,commandKey:randomUUID()});
 const {attempts,knownNanos,hasUnknown}=await generationAccounting(db,scope,result.id),attempt=attempts.at(-1)!;
 console.log(JSON.stringify({status:result.status,schemaValidated:result.status==="SUCCEEDED",provider:attempt.provider,model:attempt.model,resolvedModel:attempt.resolvedModel,inputTokens:attempt.inputTokens,outputTokens:attempt.outputTokens,totalTokens:attempt.totalTokens,durationMs:attempt.durationMs,estimatedNanos:String(knownNanos),costState:hasUnknown?"unknown":attempt.costState,currency:"USD"}));
}finally{await client.end();}
