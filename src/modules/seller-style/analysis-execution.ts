import { sellerAnalysisSafety } from "./workflow";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { aiRequests, styleProfiles, styleSources, styleAnalysisVersions as versions, auditLogs } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere, verifyScope } from "../intake/service";
import { AccessDenied } from "../identity/service";
import { AdmissionError } from "../generation/contracts";
import { CentralAIGateway } from "../../infrastructure/ai/gateway";
import { ProviderFailure } from "../../infrastructure/ai/provider";
import { STYLE_ANALYSIS_OPERATION } from "./analysis-contracts";
import { ANALYSIS_LIMITS, analysisCommand, analysisCommandHash, boundedAnalysisSources, manifestFor, type SourceCandidate } from "./analysis-input";
import { analysisInstructions } from "./analysis-instructions";
import { validateStyleAnalysisOutput } from "./analysis-policy";
import { lockStyleAnalysisStore, createStyleAnalysisVersionInTransaction, settleStyleAnalysisInTransaction, styleAnalysisVersion } from "./analysis-service";

async function selectedSources(tx:DbExecutor,scope:Scope,sourceIds?:string[]) {
 // Metadata-only validation of explicit candidate pool, then retrieve at most six bounded prefixes.
 if(sourceIds) {
  const owned=await tx.select({id:styleSources.id}).from(styleSources).where(and(tenantWhere(styleSources,scope),inArray(styleSources.id,sourceIds)));
  if(owned.length!==sourceIds.length)throw new AccessDenied();
 }
 const candidates=await tx.select({id:styleSources.id,contentHash:styleSources.contentHash,createdAt:styleSources.createdAt,
  originalLength:sql<number>`length(${styleSources.text})`,prefix:sql<string>`substring(${styleSources.text} from 1 for ${ANALYSIS_LIMITS.perSourceCharacters})`,
 }).from(styleSources).where(and(tenantWhere(styleSources,scope),sourceIds?inArray(styleSources.id,sourceIds):undefined)).orderBy(sql`date_trunc('milliseconds', ${styleSources.createdAt})`,styleSources.id).limit(ANALYSIS_LIMITS.maxSources);
 return boundedAnalysisSources(candidates as SourceCandidate[]);
}
function failureReason(failure:ProviderFailure) {
 if(failure.ambiguous)return "AMBIGUOUS_EXECUTION";
 if(failure.code==="INVALID_OUTPUT")return "INVALID_RESULT";
 if(["POLICY_REJECTED","BLOCKED"].includes(failure.code))return "POLICY_REJECTED";
 return "PROVIDER_FAILURE";
}
export class StyleAnalysisExecutionService {
 constructor(private readonly db:Database,private readonly gateway:CentralAIGateway) {}
 async execute(scope:Scope,raw:unknown) {return this.run(scope,raw,false);}
 async executeForSeller(scope:Scope,raw:unknown) {return this.run(scope,raw,true);}
 private async run(scope:Scope,raw:unknown,sellerRequest:boolean) {
  const command=analysisCommand.parse(raw),commandHash=analysisCommandHash(command);
  const claim=await this.db.transaction(async tx=>{
   await lockStyleAnalysisStore(tx,scope);
   const [replay]=await tx.select().from(versions).where(and(tenantWhere(versions,scope),eq(versions.commandKey,command.commandKey)));
   if(replay){if(replay.commandHash!==commandHash)throw new AdmissionError("COMMAND_CONFLICT");return {id:replay.id};}
   if(sellerRequest&&!await sellerAnalysisSafety(tx,scope))throw new Error("STYLE_UPDATE_UNSAFE");
   const [other]=await tx.select({id:aiRequests.id}).from(aiRequests).where(and(tenantWhere(aiRequests,scope),eq(aiRequests.commandKey,command.commandKey)));
   if(other)throw new AdmissionError("COMMAND_CONFLICT");
   const [profile]=await tx.select({id:styleProfiles.id}).from(styleProfiles).where(and(tenantWhere(styleProfiles,scope),eq(styleProfiles.id,command.styleProfileId)));
   if(!profile)throw new AccessDenied();
   const selected=await selectedSources(tx,scope,command.sourceIds);
   if(!selected.length)throw new Error("ANALYSIS_SOURCES_REQUIRED");
   if(this.gateway.maxOutputTokens!==ANALYSIS_LIMITS.outputTokens)throw new Error("ANALYSIS_POLICY_MISMATCH");
   const input=analysisInstructions(this.gateway.model,selected),inputManifest=manifestFor(input,selected);
   const version=await createStyleAnalysisVersionInTransaction(tx,scope,{styleProfileId:profile.id,sourceIds:selected.map(s=>s.metadata.sourceId)},{commandKey:command.commandKey,commandHash,inputManifest});
   let request:typeof aiRequests.$inferSelect;
   try {
    request=await this.gateway.admit(tx,scope,{styleAnalysisVersionId:version.id,attemptNumber:1,commandKey:command.commandKey,commandHash,operation:STYLE_ANALYSIS_OPERATION,inputBytes:inputManifest.inputBytes});
   }catch(error) {
    if(!(error instanceof AdmissionError)||!["BUDGET_LIMIT","READING_HOLD"].includes(error.code))throw error;
    await tx.update(versions).set({status:"FAILED",failureCode:error.code==="BUDGET_LIMIT"?"BUDGET_REJECTED":"POLICY_REJECTED",completedAt:new Date()}).where(and(tenantWhere(versions,scope),eq(versions.id,version.id)));
    await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"style_analysis_rejected",resourceId:version.id});
    return {id:version.id};
   }
   await tx.update(versions).set({status:"ANALYZING",startedAt:new Date(),aiRequestId:request.id}).where(and(tenantWhere(versions,scope),eq(versions.id,version.id)));
   await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"style_analysis_requested",resourceId:version.id});
   return {id:version.id,request,input,selected};
  });
  if(claim.request&&claim.input&&claim.selected) {
   const {request,input,selected}=claim;
   await this.gateway.execute(scope,request.id,input,response=>validateStyleAnalysisOutput(response.output,selected.map(s=>s.text)),
    (tx,outcome)=>settleStyleAnalysisInTransaction(tx,scope,claim.id,request.id,{payload:outcome.result,...(outcome.failure?{failureCode:failureReason(outcome.failure)}:{})}),
    async tx=>{
     await verifyScope(tx,scope,true);
     const [version]=await tx.select().from(versions).where(and(tenantWhere(versions,scope),eq(versions.id,claim.id)));
     if(!version||version.status!=="ANALYZING"||version.aiRequestId!==request.id)throw new Error("ANALYSIS_STATE_CHANGED");
    });
  }
  return styleAnalysisVersion(this.db,scope,claim.id);
 }
}
