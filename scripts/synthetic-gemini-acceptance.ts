// Explicit opt-in acceptance harness. Ordinary tests never import/run this file.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync,readdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import * as schema from '../src/db/schema';
import type { Database } from '../src/db/client';
import { createWorkspace,authorizeStore } from '../src/modules/identity/service';
import { ingestListing,ingestOrder,workspaceData } from '../src/modules/intake/service';
import { beginListingDraft,productData,activateProduct } from '../src/modules/products/service';
import { saveSellerProfile,editStyle,applyStyle } from '../src/modules/seller-style/service';
import { buildGenerationContext } from '../src/modules/generation/context';
import { assembleInstructions } from '../src/modules/generation/instructions';
import { validateCanonical } from '../src/modules/generation/contracts';
import { generationRuntime } from '../src/infrastructure/ai/runtime';
import { pricingFor,reserveCost,calculateCost } from '../src/infrastructure/ai/pricing';
import type { Configuration } from '../src/modules/products/contracts';
const stringify=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
assert.equal(process.env.AI_PROVIDER,'google');assert.equal(process.env.AI_GENERATION_MODEL,'gemini-3.8-flash');
assert.ok(process.env.GEMINI_API_KEY);
const budget=(n:string)=>{const v=process.env[n];assert.ok(v&&/^\d+$/.test(v),n+' invalid');return BigInt(v);};
const daily=budget('AI_DAILY_BUDGET_NANOS'),attempt=budget('AI_ATTEMPT_BUDGET_NANOS');
const live=process.argv.includes('--live');
const location=mkdtempSync(join(tmpdir(),'reading-os-synthetic-gemini-'));
const pg=new PGlite(join(location,'database'));
let calls=0,payload:unknown,rawResponse:unknown,httpStatus:number|undefined;
const originalFetch=globalThis.fetch;
try {
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync('drizzle/'+file,'utf8'));
 const db=drizzle(pg,{schema}) as unknown as Database;
 await db.insert(schema.users).values({id:'gemini-acceptance-owner',name:'Synthetic Owner'});
 const scope=await authorizeStore(db,'gemini-acceptance-owner',await createWorkspace(db,'gemini-acceptance-owner','Gemini Acceptance Test Store','fixtures'));
 const now=Math.floor(Date.now()/1000);
 await ingestListing(db,scope,{externalId:'990101',title:'Synthetic Love Reading',state:'active',updatedAt:now,personalization:[{label:'Question',type:'text_input',required:true}]});
 await db.insert(schema.listingSelections).values({organizationId:scope.organizationId,storeId:scope.storeId,listingExternalId:'990101',selectedBy:scope.userId});
 const productId=await beginListingDraft(db,scope,'990101','default'),product=await productData(db,scope,productId);
 const sections=[{id:'current-feelings',title:'Current Feelings',instruction:'Explore the fictional current emotional dynamic.',sortOrder:0},{id:'their-intentions',title:'Their Intentions',instruction:'Discuss possible fictional intentions without claiming certainty.',sortOrder:1},{id:'relationship-direction',title:'Relationship Direction',instruction:'Offer grounded guidance and possible directions for this fictional relationship.',sortOrder:2}];
 const configuration:Configuration={inputs:[{id:'name',key:'name',label:'Name',type:'TEXT',required:true,helpText:'',sortOrder:0},{id:'question',key:'question',label:'Question',type:'LONG_TEXT',required:true,helpText:'',sortOrder:1}],sections,output:'TEXT',workflow:'MANUAL'};
 const versionId=await activateProduct(db,scope,productId,product.draft!.id,0,{name:'Synthetic Love Reading',configuration});
 await saveSellerProfile(db,scope,{displayName:'Acceptance Test Reader',shortBio:'Synthetic reader for a controlled acceptance check; no real customer involved.'});
 const draft=await editStyle(db,scope);
 const style=await applyStyle(db,scope,draft.id,0,{tone:'WARM',detail:'DETAILED',approach:'CONVERSATIONAL',preferredExpressions:[],avoidExpressions:[],instructions:'Write clearly and compassionately. This is fictional test data. Keep each section concise, approximately 100 words.'});
 await ingestOrder(db,scope,{externalId:'990201',buyerName:'Jane Test',createdAt:now,updatedAt:now,paid:true,canceled:false,refund:'none',lines:[{externalId:'990301',listingId:'990101',title:'Synthetic Love Reading',quantity:1,sku:null,variantKey:'default',variations:[],answers:[{label:'Name',value:'Jane Test',kind:'text'},{label:'Question',value:'How is my fictional relationship likely to develop?',kind:'text'}],digital:true}]});
 const unit=(await workspaceData(db,scope)).units[0];assert.ok(unit);
 const context=await db.transaction(tx=>buildGenerationContext(tx,scope,unit.id),{isolationLevel:'repeatable read'});
 assert.equal(context.product.id,versionId);assert.equal(context.style.id,style.id);
 const instructions=assembleInstructions(context),pricing=pricingFor('google',process.env.AI_GENERATION_MODEL!);
 const reserved=reserveCost(Buffer.byteLength(instructions.system+instructions.data),8192,pricing);
 if(reserved>attempt||reserved>daily){console.log(stringify({preflight:'BLOCKED_BUDGET_RESERVATION',provider:process.env.AI_PROVIDER,model:process.env.AI_GENERATION_MODEL,keyPresent:true,budgetsParsed:true,admission:'PASS',requiredReservationNanos:reserved,attemptBudgetFits:reserved<=attempt,dailyBudgetFits:reserved<=daily,providerAttempts:0}));throw new Error('BUDGET_LIMIT_PREFLIGHT');}
 assert.equal((await db.select().from(schema.productionQueue)).length,0);
 assert.equal((await db.select().from(schema.aiRequests)).length,0);
 // Instantiate the EXISTING runtime, without invocation during pre-flight.
 const runtime=generationRuntime(db);
 const preflight={provider:'google',model:process.env.AI_GENERATION_MODEL,keyPresent:true,budgetsParsed:true,budgetReservationFits:true,isolatedDatabase:'file-backed PGlite at temporary synthetic-only directory; DATABASE_URL never read',admission:'PASS',queueItems:0,pricing,expectedSections:sections.map(({id,title})=>({sectionId:id,title})),system:instructions.system,userData:JSON.parse(instructions.data)};
 if(!live){console.log(stringify({preflight,providerAttempts:0}));}
 else {
  // Durable global one-shot marker before any dispatch, never removed automatically.
  writeFileSync(join(tmpdir(),'reading-os-gemini-acceptance-2026-10-06.dispatched'),'single authorized acceptance intent\n',{flag:'wx',mode:0o600});
  globalThis.fetch=async(input,init)=>{
   assert.equal(calls,0,'Second network invocation forbidden');
   assert.ok(String(input).startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'));
   payload=JSON.parse(String(init?.body));calls++;
   const response=await originalFetch(input,init);httpStatus=response.status;
   // Capture response without headers; only synthetic generation content.
   const raw=await response.clone().text();try{rawResponse=JSON.parse(raw);}catch{rawResponse={unparseable:true};}
   return response;
  };
  let result:typeof schema.generations.$inferSelect|undefined,failure:string|undefined;
  try{result=await runtime.prepare(scope,{unitId:unit.id,commandKey:randomUUID()});}catch(e){failure=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'APPLICATION_ERROR';}
  const requests=await db.select().from(schema.aiRequests),usage=await db.select().from(schema.usageEvents),audit=await db.select().from(schema.auditLogs);
  const secret=process.env.GEMINI_API_KEY!;
  assert.ok(!stringify({result,requests,usage,audit,payload,rawResponse}).includes(secret),'SECRET_LEAK');
  assert.ok(calls<=1&&requests.length<=1&&usage.length<=1,'Acceptance cardinality');
  let canonicalValidated=false;
  if(result?.status==='SUCCEEDED'){
   assert.deepEqual(validateCanonical(JSON.stringify(result.result),context),result.result);canonicalValidated=true;
   assert.equal(requests.length,1);assert.equal(usage.length,1);assert.equal(requests[0].ambiguous,false);
   assert.equal(usage[0].aiRequestId,requests[0].id);assert.equal(requests[0].generationId,result.id);
   assert.equal(calculateCost({inputTokens:requests[0].inputTokens??undefined,outputTokens:requests[0].outputTokens??undefined,cachedTokens:requests[0].cachedTokens??undefined},requests[0].pricing).nanos,requests[0].estimatedNanos);
   assert.equal(usage[0].amountNanos,requests[0].estimatedNanos);
  }
  const output={preflight,intentionalProviderAttempts:calls,httpStatus,status:result?.status??'REJECTED',normalizedFailure:requests[0]?.failureCode??failure??null,canonicalValidated,requestPayload:payload??null,rawProviderResponse:rawResponse??null,generation:result??null,aiRequests:requests,usageEvents:usage,security:{secretAbsent:true,redactedAudit: true,auditFields:Object.keys(audit[0]??{})},databaseLocation:location};
  writeFileSync(join(location,'acceptance-result.json'),stringify(output),{mode:0o600});
  console.log(stringify({status:output.status,normalizedFailure:output.normalizedFailure,providerAttempts:calls,canonicalValidated,resultFile:join(location,'acceptance-result.json')}));
 }
}finally{globalThis.fetch=originalFetch;await pg.close();}
