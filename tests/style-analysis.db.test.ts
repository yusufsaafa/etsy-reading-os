import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as s from "../src/db/schema";
import type { Scope } from "../src/modules/intake/contracts";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import { tenantWhere } from "../src/modules/intake/service";
import { addPreviousWork, editStyle } from "../src/modules/seller-style/service";
import { StyleAnalysisExecutionService } from "../src/modules/seller-style/analysis-execution";
import { latestUsableStyleAnalysis, styleAnalysisSourceProvenance, completeStyleAnalysisVersion } from "../src/modules/seller-style/analysis-service";
import { CentralAIGateway } from "../src/infrastructure/ai/gateway";
import { FakeGenerationProvider } from "../src/infrastructure/ai/fake";
import { ProviderFailure, type GenerationProvider, type ProviderRequest } from "../src/infrastructure/ai/provider";
import { pricingFor, reserveCost } from "../src/infrastructure/ai/pricing";
import { intelligence } from "./style-intelligence.fixture";
import { analysisInputManifest, sha256 } from "../src/modules/seller-style/analysis-input";
let pg:PGlite,db:Database,a:Scope,b:Scope,profile:string,ids:string[];
beforeEach(async()=>{
 pg=new PGlite();const native=drizzle(pg,{schema:s});await migrate(native,{migrationsFolder:"drizzle"});db=native as unknown as Database;
 for(const userId of ["execution-a","execution-b"])await db.insert(s.users).values({id:userId,name:userId});
 a=await authorizeStore(db,"execution-a",await createWorkspace(db,"execution-a","A","fixtures"));
 b=await authorizeStore(db,"execution-b",await createWorkspace(db,"execution-b","B","fixtures"));profile=(await editStyle(db,a)).styleProfileId;
 ids=[];for(const title of ["A","B"])ids.push(await addPreviousWork(db,a,{title,text:"Synthetic evidence with a calm writing voice.",commandKey:randomUUID()}));
 vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw new Error("REAL_NETWORK_FORBIDDEN");});
},20000);
afterEach(async()=>{expect(globalThis.fetch).not.toHaveBeenCalled();vi.restoreAllMocks();await pg.close();});
const command=(sourceIds?:string[])=>({styleProfileId:profile,commandKey:randomUUID(),...(sourceIds?{sourceIds}:{})});
function setup(provider:GenerationProvider=new FakeGenerationProvider(),budget=1000000000n) {
 const model=provider.name==="fake"?"deterministic-v1":"gemini-3.5-flash-lite";
 const gateway=new CentralAIGateway(db,{provider,model,pricing:pricingFor(provider.name,model),maxOutputTokens:8192,dailyBudgetNanos:budget,attemptBudgetNanos:budget});
 return {service:new StyleAnalysisExecutionService(db,gateway),gateway};
}
async function accounting(versionId:string){
 const [version]=await db.select().from(s.styleAnalysisVersions).where(eq(s.styleAnalysisVersions.id,versionId));
 const [request]=await db.select().from(s.aiRequests).where(eq(s.aiRequests.styleAnalysisVersionId,versionId));
 const [usage]=request?await db.select().from(s.usageEvents).where(eq(s.usageEvents.aiRequestId,request.id)):[];
 return {version,request,usage};
}
it("executes first-class analysis with exact attribution and settled usage; generation remains empty",async()=>{
 const provider=new FakeGenerationProvider();const result=await setup(provider).service.execute(a,command(ids));const {request,usage}=await accounting(result.id);
 expect(result.status).toBe("READY");expect(result.payload?.contractVersion).toBe("style-intelligence/v1");expect(result.aiRequestId).toBe(request.id);
 expect(request).toMatchObject({operation:"style-analysis/v1",styleAnalysisVersionId:result.id,generationId:null,status:"SUCCEEDED",inputTokens:100,outputTokens:200,costState:"known_zero"});
 expect(usage).toMatchObject({aiRequestId:request.id,costState:"known_zero",amountNanos:0n});expect(provider.calls).toBe(1);
 expect(await db.select().from(s.generations)).toHaveLength(0);expect(await db.select().from(s.aiRequests)).toHaveLength(1);expect(await db.select().from(s.usageEvents)).toHaveLength(1);
});
it("bounds selected prefixes, exact frozen membership and Unicode truncation metadata",async()=>{
 const big=[];for(let i=0;i<8;i++)big.push(await addPreviousWork(db,a,{title:"Large "+i,text:"😀".repeat(12000),commandKey:randomUUID()}));
 let sent:ProviderRequest|undefined;const fake=new FakeGenerationProvider();const p:GenerationProvider={name:"fake",generate:r=>{sent=r;return fake.generate(r);}};
 const result=await setup(p).service.execute(a,command(big));const manifest=analysisInputManifest.parse(result.inputManifest);
 expect(manifest.sources).toHaveLength(4);expect(manifest.sources.reduce((n,x)=>n+x.includedLength,0)).toBe(24000);
 for(const item of manifest.sources)expect(item).toMatchObject({originalLength:12000,includedLength:6000,truncated:true});
 const provenance=await styleAnalysisSourceProvenance(db,a,result.id);expect(provenance.map(x=>x.sourceId).sort()).toEqual(manifest.sources.map(x=>x.sourceId).sort());
 const envelope=JSON.parse(sent!.data);expect(envelope.sources).toHaveLength(4);expect(Array.from(envelope.sources[0].text)).toHaveLength(6000);expect(manifest.sources[0].includedHash).toBe(sha256(envelope.sources[0].text));
 await addPreviousWork(db,a,{title:"New",text:"New synthetic evidence",commandKey:randomUUID()});expect(await styleAnalysisSourceProvenance(db,a,result.id)).toEqual(provenance);
 await expect(db.update(s.styleAnalysisVersions).set({inputManifest:{...manifest,inputBytes:manifest.inputBytes+1}}).where(eq(s.styleAnalysisVersions.id,result.id))).rejects.toThrow();
});
it("automatic selection chooses six oldest stable sources; does not load the whole library",async()=>{
 for(let i=0;i<8;i++)await addPreviousWork(db,a,{title:"Short "+i,text:"Synthetic short text",commandKey:randomUUID()});
 const result=await setup().service.execute(a,command());expect(result.inputManifest?.sources).toHaveLength(6);
 expect(result.inputManifest?.sources.slice(0,2).map(x=>x.sourceId)).toEqual(ids);
});
it.each(["broken JSON",JSON.stringify({...intelligence(),customerName:"private"}),JSON.stringify({...intelligence(),tone:Array(7).fill("x")})])("invalid structured output fails durably with accounting: %s",async output=>{
 const provider=new FakeGenerationProvider({output});const result=await setup(provider).service.execute(a,command());const {request,usage}=await accounting(result.id);
 expect(result).toMatchObject({status:"FAILED",failureCode:"INVALID_RESULT",payload:null});expect(request).toMatchObject({status:"FAILED",failureCode:"INVALID_OUTPUT",inputTokens:100});expect(usage).toBeDefined();expect(provider.calls).toBe(1);
});
it.each(["private@example.com","Order #AB-1234","1990-03-12"])("contamination rejects %s without losing paid measured accounting",async fact=>{
 const fake=new FakeGenerationProvider({output:JSON.stringify({...intelligence(),voiceSummary:"Preserved historical fact "+fact})});
 const result=await setup({name:"google",generate:r=>fake.generate(r)}).service.execute(a,command());const {request,usage}=await accounting(result.id);
 expect(result).toMatchObject({status:"FAILED",failureCode:"POLICY_REJECTED",payload:null});expect(request).toMatchObject({status:"FAILED",failureCode:"POLICY_REJECTED",costState:"estimated",estimatedNanos:530000n});expect(usage.amountNanos).toBe(530000n);
});
it("verbatim source copying fails instead of being sanitized into READY",async()=>{
 const passage="This unusually detailed historical passage describes careful personal reflection through patient explanations and meaningful thoughtful observations";
 const source=await addPreviousWork(db,a,{title:"Synthetic copied passage",text:passage,commandKey:randomUUID()});
 const result=await setup(new FakeGenerationProvider({output:JSON.stringify({...intelligence(),voiceSummary:passage})})).service.execute(a,command([source]));expect(result.failureCode).toBe("POLICY_REJECTED");
});
it("failed newer analysis retains last usable READY version",async()=>{
 const ready=await setup().service.execute(a,command()),failed=await setup(new FakeGenerationProvider({output:"bad"})).service.execute(a,command());
 expect(failed.versionNumber).toBe(ready.versionNumber+1);expect((await latestUsableStyleAnalysis(db,a,profile))?.id).toBe(ready.id);
});
it("known provider failure retains returned usage and resolved model",async()=>{
 const fake=new FakeGenerationProvider({failure:new ProviderFailure("RATE_LIMIT",{inputTokens:10,outputTokens:2},"safe-id",false,"resolved-model")});
 const result=await setup({name:"google",generate:r=>fake.generate(r)}).service.execute(a,command());const {request,usage}=await accounting(result.id);
 expect(result.failureCode).toBe("PROVIDER_FAILURE");expect(request).toMatchObject({status:"FAILED",ambiguous:false,resolvedModel:"resolved-model",estimatedNanos:8000n});expect(usage.amountNanos).toBe(8000n);
});
it("ambiguous failure retains UNKNOWN liability and replay never issues another paid attempt",async()=>{
 const fake=new FakeGenerationProvider({failure:new ProviderFailure("TIMEOUT",{},undefined,false)}),{service}=setup({name:"google",generate:r=>fake.generate(r)}),c=command();
 const result=await service.execute(a,c),replay=await service.execute(a,c),{request,usage}=await accounting(result.id);
 expect(replay.id).toBe(result.id);expect(result.failureCode).toBe("AMBIGUOUS_EXECUTION");expect(request).toMatchObject({ambiguous:true,costState:"unknown",estimatedNanos:null});expect(request.reservedNanos).toBeGreaterThan(0n);expect(usage.amountNanos).toBeNull();expect(fake.calls).toBe(1);
});
it("pre-dispatch budget rejection is a durable FAILED command with no request or provider call",async()=>{
 const fake=new FakeGenerationProvider(),{service}=setup({name:"google",generate:r=>fake.generate(r)},1n),c=command();
 const result=await service.execute(a,c);expect(result).toMatchObject({status:"FAILED",failureCode:"BUDGET_REJECTED",aiRequestId:null});expect((await service.execute(a,c)).id).toBe(result.id);
 expect(fake.calls).toBe(0);expect(await db.select().from(s.aiRequests)).toHaveLength(0);expect(await db.select().from(s.usageEvents)).toHaveLength(0);
});
it("measured success uses central pricing and conservative exact request reservation",async()=>{
 const fake=new FakeGenerationProvider();const result=await setup({name:"google",generate:r=>fake.generate(r)}).service.execute(a,command());const {request,usage}=await accounting(result.id);
 expect(request.estimatedNanos).toBe(530000n);expect(usage.amountNanos).toBe(530000n);expect(request.reservedNanos).toBe(reserveCost(result.inputManifest!.inputBytes,8192,request.pricing));
});
it("completed command replay is durable and incompatible reuse fails",async()=>{
 const fake=new FakeGenerationProvider(),{service}=setup(fake),c=command(ids),first=await service.execute(a,c);
 expect((await service.execute(a,{...c,sourceIds:[...ids].reverse()})).id).toBe(first.id);expect(fake.calls).toBe(1);
 await expect(service.execute(a,{...c,sourceIds:[ids[0]]})).rejects.toThrow("COMMAND_CONFLICT");expect(fake.calls).toBe(1);
});
it("simultaneous duplicate submissions converge on one dispatch and ledger row",async()=>{
 let release!:()=>void;const delay=new Promise<void>(r=>{release=r;}),provider=new FakeGenerationProvider({delay}),{service}=setup(provider),c=command();
 const first=service.execute(a,c),second=service.execute(a,c);
 await vi.waitFor(()=>expect(provider.calls).toBe(1),{timeout:3000,interval:5});const replay=await service.execute(a,c);expect(replay.status).toBe("ANALYZING");release();
 const results=await Promise.all([first,second]);expect(results[0].id).toBe(results[1].id);expect(provider.calls).toBe(1);expect(await db.select().from(s.aiRequests)).toHaveLength(1);expect(await db.select().from(s.usageEvents)).toHaveLength(1);
});
it("foreign Store/source and forged scopes cannot admit analysis or expose its usable result",async()=>{
 const provider=new FakeGenerationProvider(),{service}=setup(provider);await expect(service.execute(b,command(ids))).rejects.toThrow();await expect(service.execute({...a,userId:b.userId},command())).rejects.toThrow();
 const bp=(await editStyle(db,b)).styleProfileId;await expect(service.execute(b,{...command(ids),styleProfileId:bp})).rejects.toThrow();expect(provider.calls).toBe(0);
 const result=await service.execute(a,command());expect(await latestUsableStyleAnalysis(db,b,profile)).toBeUndefined();
 await expect(db.insert(s.aiRequests).values({organizationId:b.organizationId,storeId:b.storeId,styleAnalysisVersionId:result.id,attemptNumber:1,commandKey:randomUUID(),commandHash:"a".repeat(64),operation:"style-analysis/v1",provider:"fake",model:"deterministic-v1",pricing:pricingFor("fake","deterministic-v1"),reservedNanos:0n})).rejects.toThrow();
});
it("no provider call occurs when initial accounting persistence fails",async()=>{
 await pg.exec("CREATE FUNCTION fail_analysis_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_USAGE_FAILURE'; END $$; CREATE TRIGGER reject_analysis_usage BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION fail_analysis_usage();");
 const provider=new FakeGenerationProvider();await expect(setup(provider).service.execute(a,command())).rejects.toThrow();expect(provider.calls).toBe(0);expect(await db.select().from(s.styleAnalysisVersions)).toHaveLength(0);
});
it("lost settlement leaves non-usable ANALYZING/RUNNING/UNKNOWN, replay never redispatches",async()=>{
 await pg.exec("CREATE FUNCTION fail_analysis_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='READY' THEN RAISE EXCEPTION 'TEST_SETTLEMENT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_analysis_completion BEFORE UPDATE ON style_analysis_versions FOR EACH ROW EXECUTE FUNCTION fail_analysis_completion();");
 const provider=new FakeGenerationProvider(),{service}=setup(provider),c=command();await expect(service.execute(a,c)).rejects.toThrow();const replay=await service.execute(a,c),{request,usage}=await accounting(replay.id);
 expect(replay.status).toBe("ANALYZING");expect(request).toMatchObject({status:"RUNNING",costState:"unknown",estimatedNanos:null});expect(usage.amountNanos).toBeNull();expect(await latestUsableStyleAnalysis(db,a,profile)).toBeUndefined();expect(provider.calls).toBe(1);
});
it("request hash fence rejects changed dispatch envelope without provider calls",async()=>{
 const provider=new FakeGenerationProvider(),{service,gateway}=setup(provider),original=gateway.execute.bind(gateway);
 vi.spyOn(gateway,"execute").mockImplementation((scope,id,input,accept,finalize,preflight)=>original(scope,id,{...input,data:"Changed"},accept,finalize,preflight));
 await expect(service.execute(a,command())).rejects.toThrow("GATEWAY_ANALYSIS_INPUT_MISMATCH");expect(provider.calls).toBe(0);
});
it("public Part 1 completion cannot bypass executable analysis policy while provider is running",async()=>{
 let release!:()=>void;const delay=new Promise<void>(r=>{release=r;}),provider=new FakeGenerationProvider({delay}),{service}=setup(provider),c=command();const running=service.execute(a,c);
 await vi.waitFor(()=>expect(provider.calls).toBe(1),{timeout:3000,interval:5});const [version]=await db.select().from(s.styleAnalysisVersions).where(eq(s.styleAnalysisVersions.commandKey,c.commandKey));
 await expect(completeStyleAnalysisVersion(db,a,version.id,{payload:intelligence(),aiRequestId:version.aiRequestId})).rejects.toThrow("ANALYSIS_EXECUTION_OWNS_RESULT");release();expect((await running).status).toBe("READY");
});
it("attribution and execution manifest cannot be rewritten; audit has metadata only",async()=>{
 const result=await setup().service.execute(a,command()),{request}=await accounting(result.id);
 await expect(db.update(s.aiRequests).set({styleAnalysisVersionId:null}).where(eq(s.aiRequests.id,request.id))).rejects.toThrow();
 const audits=await db.select().from(s.auditLogs).where(tenantWhere(s.auditLogs,a));expect(JSON.stringify(audits)).not.toContain("Synthetic evidence");expect(JSON.stringify(audits)).not.toContain(result.payload!.voiceSummary);
});
it("settled results/accounting survive owner revocation after authorized dispatch",async()=>{
 let release!:()=>void;const delay=new Promise<void>(r=>{release=r;}),provider=new FakeGenerationProvider({delay}),c=command(),running=setup(provider).service.execute(a,c);
 await vi.waitFor(()=>expect(provider.calls).toBe(1),{timeout:3000,interval:5});await db.delete(s.memberships).where(and(eq(s.memberships.organizationId,a.organizationId),eq(s.memberships.userId,a.userId)));release();await expect(running).rejects.toThrow();
 const [version]=await db.select().from(s.styleAnalysisVersions).where(eq(s.styleAnalysisVersions.commandKey,c.commandKey));const {request,usage}=await accounting(version.id);expect(version.status).toBe("READY");expect(request.status).toBe("SUCCEEDED");expect(usage.costState).toBe("known_zero");
});
it("eligibility context stays manual after executable analysis; only new admission enriches it",async()=>{
 const {ingestListing,ingestOrder,workspaceData}=await import("../src/modules/intake/service");
 const {fixtureListings,fixtureOrders}=await import("../src/modules/etsy/fixtures");
 const {beginListingDraft,productData,activateProduct}=await import("../src/modules/products/service");
 const {saveSellerProfile,applyStyle}=await import("../src/modules/seller-style/service");
 const {buildGenerationContext}=await import("../src/modules/generation/context");
 const {assembleInstructions}=await import("../src/modules/generation/instructions");
 const {stableJson}=await import("../src/modules/intake/contracts");
 for(const listing of fixtureListings)await ingestListing(db,a,listing);
 await db.insert(s.listingSelections).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",selectedBy:a.userId});
 const productId=await beginListingDraft(db,a,"101","default"),product=await productData(db,a,productId);
 await activateProduct(db,a,productId,product.draft!.id,0,{name:"Synthetic product",configuration:{inputs:[{id:"name",key:"name",label:"Name",type:"TEXT",required:true,helpText:"",sortOrder:0}],sections:[{id:"intro",title:"Introduction",instruction:"Welcome",sortOrder:0}],output:"TEXT",workflow:"MANUAL"}});
 await saveSellerProfile(db,a,{displayName:"Synthetic Writer",shortBio:""});
 const [draft]=await db.select().from(s.styleVersions).where(eq(s.styleVersions.styleProfileId,profile));
 await applyStyle(db,a,draft.id,0,{tone:"WARM",detail:"DETAILED",approach:"CONVERSATIONAL",preferredExpressions:[],avoidExpressions:[],instructions:"Clear writing"});
 await ingestOrder(db,a,{...fixtureOrders[0],externalId:"9901",lines:[{...fixtureOrders[0].lines[0],externalId:"9991",listingId:"101",quantity:1,answers:[{label:"Name",value:"Synthetic Recipient",kind:"text"}]}]});
 const unitId=(await workspaceData(db,a)).units[0].id;
 const before=await db.transaction(tx=>buildGenerationContext(tx,a,unitId)),hash=sha256(stableJson(before)),prompt=assembleInstructions(before);
 const ready=await setup().service.execute(a,command());await setup(new FakeGenerationProvider({output:"bad"})).service.execute(a,command());
 const after=await db.transaction(tx=>buildGenerationContext(tx,a,unitId));expect(after).toEqual(before);expect(sha256(stableJson(after))).toBe(hash);expect(assembleInstructions(after)).toEqual(prompt);expect(await db.select().from(s.productionQueue)).toHaveLength(0);
 const {GenerationService}=await import("../src/modules/generation/service");let sent!:ProviderRequest;const fake=new FakeGenerationProvider();
 const {gateway}=setup({name:"fake",generate:r=>{sent=r;return fake.generate(r);}});const generated=await new GenerationService(db,gateway).prepare(a,{unitId,commandKey:randomUUID()});
 expect(generated.status).toBe("SUCCEEDED");expect(generated.context.styleIntelligence).toEqual({analysisVersionId:ready.id,versionNumber:ready.versionNumber,contractVersion:ready.contractVersion,payload:ready.payload});
 expect(JSON.parse(sent.data).styleIntelligence).toEqual(ready.payload);expect(sent.data).not.toContain("Synthetic evidence");expect(sent.data).not.toContain("inputManifest");expect(generated.context).not.toHaveProperty("sources");
 expect(fake.calls).toBe(1);expect(await db.select().from(s.aiRequests)).toHaveLength(3);expect(await db.select().from(s.usageEvents)).toHaveLength(3);
});
it("same-organization cross-Store sources fail; operators cannot initiate paid analysis",async()=>{
 const storeId=randomUUID();await db.insert(s.stores).values({id:storeId,organizationId:a.organizationId,name:"Second Store",importSince:new Date()});
 const second={...a,storeId};const source=await addPreviousWork(db,second,{title:"Other Store",text:"Synthetic",commandKey:randomUUID()});
 const provider=new FakeGenerationProvider(),{service}=setup(provider);await expect(service.execute(a,command([source]))).rejects.toThrow();
 await db.insert(s.users).values({id:"execution-operator",name:"Operator"});await db.insert(s.memberships).values({organizationId:a.organizationId,userId:"execution-operator",role:"operator"});
 await expect(service.execute({...a,userId:"execution-operator"},command())).rejects.toThrow();expect(provider.calls).toBe(0);
});
it("unknown successful usage remains UNKNOWN and old ambiguous liability blocks budget admission",async()=>{
 const fake=new FakeGenerationProvider({usage:{}}),{service}=setup({name:"google",generate:r=>fake.generate(r)});
 const result=await service.execute(a,command()),{request,usage}=await accounting(result.id);
 expect(result.status).toBe("READY");expect(request.costState).toBe("unknown");expect(usage.amountNanos).toBeNull();
 const blocked=await setup({name:"google",generate:r=>fake.generate(r)},request.reservedNanos).service.execute(a,command());expect(blocked.failureCode).toBe("BUDGET_REJECTED");expect(fake.calls).toBe(1);
});
it("fake provider cannot dispatch analysis for a real Etsy Store",async()=>{
 await db.update(s.stores).set({source:"etsy"}).where(eq(s.stores.id,a.storeId));const provider=new FakeGenerationProvider();
 const result=await setup(provider).service.execute(a,command());expect(result.failureCode).toBe("POLICY_REJECTED");expect(provider.calls).toBe(0);
});
it("manifest mismatches are rejected before source provenance can commit",async()=>{
 const {createStyleAnalysisVersionInTransaction,lockStyleAnalysisStore}=await import("../src/modules/seller-style/analysis-service");
 const {boundedAnalysisSources,manifestFor}=await import("../src/modules/seller-style/analysis-input");
 const {analysisInstructions}=await import("../src/modules/seller-style/analysis-instructions");
 const [source]=await db.select().from(s.styleSources).where(eq(s.styleSources.id,ids[0]));
 const selected=boundedAnalysisSources([{id:source.id,contentHash:source.contentHash,createdAt:source.createdAt,originalLength:Array.from(source.text).length,prefix:source.text}]);
 const manifest=manifestFor(analysisInstructions("deterministic-v1",selected),selected);manifest.sources[0].includedHash="a".repeat(64);
 await expect(db.transaction(async tx=>{await lockStyleAnalysisStore(tx,a);return createStyleAnalysisVersionInTransaction(tx,a,{styleProfileId:profile,sourceIds:[source.id]},{commandKey:randomUUID(),commandHash:"b".repeat(64),inputManifest:manifest});})).rejects.toThrow();
 expect(await db.select().from(s.styleAnalysisVersions)).toHaveLength(0);
});
