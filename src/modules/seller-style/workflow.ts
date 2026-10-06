import { and, desc, eq, sql } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client";
import { styleProfiles, styleSources, styleAnalysisVersions, styleAnalysisSources, aiRequests } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { tenantWhere, verifyScope } from "../intake/service";
import { styleIntelligence } from "./analysis-contracts";
import { ANALYSIS_LIMITS } from "./analysis-input";

// Called under the execution service's Store lock for writes; UI reads repeatable-read.
export async function sellerAnalysisSafety(tx:DbExecutor,scope:Scope) {
 const attempts=await tx.select({status:styleAnalysisVersions.status,failureCode:styleAnalysisVersions.failureCode,requestStatus:aiRequests.status,ambiguous:aiRequests.ambiguous,costState:aiRequests.costState})
 .from(styleAnalysisVersions).leftJoin(aiRequests,and(eq(styleAnalysisVersions.aiRequestId,aiRequests.id),eq(styleAnalysisVersions.organizationId,aiRequests.organizationId),eq(styleAnalysisVersions.storeId,aiRequests.storeId))).where(tenantWhere(styleAnalysisVersions,scope));
 return !attempts.some(a=>["DRAFT","PENDING","ANALYZING"].includes(a.status)||a.failureCode==="AMBIGUOUS_EXECUTION"||a.ambiguous||a.costState==="unknown"||["CLAIMED","RUNNING"].includes(a.requestStatus??""));
}
export function failureCopy(code:string|null,hasRequest=true) {
 if(code==="INVALID_RESULT"||(code==="POLICY_REJECTED"&&hasRequest))return "We couldn't learn a reliable writing style from these examples.";
 if(code==="AMBIGUOUS_EXECUTION")return "This update needs attention before another update can be requested.";
 return "We couldn't update your writing style right now.";
}
export async function writingStyleWorkflow(db:Database,scope:Scope) {
 return db.transaction(async tx=>{
 await verifyScope(tx,scope,true);
 const [profile]=await tx.select({id:styleProfiles.id}).from(styleProfiles).where(tenantWhere(styleProfiles,scope));
 const base=profile?and(tenantWhere(styleAnalysisVersions,scope),eq(styleAnalysisVersions.styleProfileId,profile.id)):undefined;
 const [latest]=profile?await tx.select().from(styleAnalysisVersions).where(base).orderBy(desc(styleAnalysisVersions.versionNumber)).limit(1):[];
 const [ready]=profile?await tx.select().from(styleAnalysisVersions).where(and(base,eq(styleAnalysisVersions.status,"READY"))).orderBy(desc(styleAnalysisVersions.versionNumber)).limit(1):[];
 const safe=await sellerAnalysisSafety(tx,scope);
 const sources=await tx.select({id:styleSources.id,newer:ready?sql<boolean>`${styleSources.createdAt} > (select created_at from style_analysis_versions where id=${ready.id} and organization_id=${scope.organizationId} and store_id=${scope.storeId})`:sql<boolean>`false`,length:sql<number>`length(${styleSources.text})`}).from(styleSources).where(tenantWhere(styleSources,scope)).orderBy(sql`date_trunc('milliseconds', ${styleSources.createdAt})`,styleSources.id);
 let remaining:number=ANALYSIS_LIMITS.aggregateCharacters;
 const selected=sources.slice(0,ANALYSIS_LIMITS.maxSources).filter(s=>{const included=Math.min(s.length,ANALYSIS_LIMITS.perSourceCharacters,remaining);remaining-=included;return included>0;}).map(s=>s.id).sort();
 const provenance=ready?await tx.select({id:styleAnalysisSources.sourceId}).from(styleAnalysisSources).where(and(tenantWhere(styleAnalysisSources,scope),eq(styleAnalysisSources.analysisVersionId,ready.id))):[];
 const changed=!!ready&&(sources.some(s=>s.newer)||JSON.stringify(selected)!==JSON.stringify(provenance.map(s=>s.id).sort()));
 const learning=!!latest&&["PENDING","ANALYZING"].includes(latest.status);
 const failed=latest?.status==="FAILED";
 const status=ready?"Style ready":learning?"Learning your writing style":latest?"Needs attention":"Not learned yet";
 let message=!sources.length?"Add an example of your previous work to learn your writing style.":learning?"Your writing style update hasn't finished yet. You can leave this page and check back later.":failed?failureCopy(latest.failureCode,latest.aiRequestId!==null):changed?"Your previous work has changed since this style was learned.":"Learning your writing style is optional. Your chosen preferences always take priority.";
 if(ready&&(learning||failed))message="Your current style is still active. "+message;
 if(!safe&&!learning)message+=" An earlier writing style update needs attention before another can be requested.";
 const payload=ready?styleIntelligence.parse(ready.payload):undefined;
 // Only a compact human-readable projection crosses the server/client boundary.
 const preview=payload?[{label:"Voice",text:payload.voiceSummary},{label:"Tone",text:payload.tone.slice(0,3).join(" · ")},{label:"Structure",text:[...payload.structure.opening.slice(0,1),...payload.structure.development.slice(0,1),...payload.structure.closing.slice(0,1)].join(" · ")},{label:"Writing tendencies",text:payload.sentenceAndParagraph.slice(0,2).join(" · ")},{label:"Preferred patterns",text:payload.preferredPatterns.slice(0,2).join(" · ")}].filter(p=>p.text):[];
 return {status,message,preview,changed,learning,canRequest:safe&&sources.length>0,actionLabel:ready?"Update writing style":"Learn my writing style"};
 },{isolationLevel:"repeatable read"});
}
