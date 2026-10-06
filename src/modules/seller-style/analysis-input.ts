import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../intake/contracts";
import type { ProviderRequest } from "../../infrastructure/ai/provider";
export const ANALYSIS_INPUT_POLICY = "style-analysis-input/v1" as const;
export const ANALYSIS_PROMPT_VERSION = "style-analysis-prompt/v1" as const;
export const ANALYSIS_LIMITS = Object.freeze({ maxCandidates:100, maxSources:6, perSourceCharacters:6000, aggregateCharacters:24000, requestBytes:192000, outputTokens:8192 });
export const sha256 = (value:string) => createHash("sha256").update(value).digest("hex");
export const analysisCommand = z.object({ styleProfileId:z.string().uuid(), commandKey:z.string().uuid(),
 sourceIds:z.array(z.string().uuid()).min(1).max(ANALYSIS_LIMITS.maxCandidates).refine(ids=>new Set(ids).size===ids.length,"Duplicate sources").optional(),
}).strict();
export function analysisCommandHash(command:z.infer<typeof analysisCommand>) {
 return sha256(stableJson({...command,sourceIds:command.sourceIds?[...command.sourceIds].sort():null,policyVersion:ANALYSIS_INPUT_POLICY}));
}
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const sourceManifest=z.object({sourceId:z.string().uuid(),contentHash:digest,ordinal:z.number().int().min(1).max(6),
 originalLength:z.number().int().min(1).max(50000),includedLength:z.number().int().min(1).max(6000),truncated:z.boolean(),includedHash:digest,
}).strict().refine(s=>s.includedLength<=s.originalLength&&s.truncated===(s.includedLength<s.originalLength));
export const analysisInputManifest=z.object({policyVersion:z.literal(ANALYSIS_INPUT_POLICY),promptVersion:z.literal(ANALYSIS_PROMPT_VERSION),
 requestHash:digest,inputBytes:z.number().int().min(1).max(ANALYSIS_LIMITS.requestBytes),maxOutputTokens:z.literal(ANALYSIS_LIMITS.outputTokens),
 sources:z.array(sourceManifest).min(1).max(ANALYSIS_LIMITS.maxSources),
}).strict().refine(m=>new Set(m.sources.map(s=>s.sourceId)).size===m.sources.length&&m.sources.every((s,i)=>s.ordinal===i+1)&&m.sources.reduce((n,s)=>n+s.includedLength,0)<=ANALYSIS_LIMITS.aggregateCharacters);
export const analysisExecutionMetadata=z.object({commandKey:z.string().uuid(),commandHash:digest,inputManifest:analysisInputManifest}).strict();
export type AnalysisInputManifest=z.infer<typeof analysisInputManifest>;
export type SourceCandidate={id:string;contentHash:string;createdAt:Date;originalLength:number;prefix:string};
export function boundedAnalysisSources(candidates:SourceCandidate[]) {
 const sorted=[...candidates].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||(a.id<b.id?-1:a.id>b.id?1:0));
 let remaining=ANALYSIS_LIMITS.aggregateCharacters;
 const selected:{text:string;metadata:AnalysisInputManifest["sources"][number]}[]=[];
 for(const source of sorted.slice(0,ANALYSIS_LIMITS.maxSources)) {
  if(!remaining)break;
  const points=Array.from(source.prefix).slice(0,Math.min(ANALYSIS_LIMITS.perSourceCharacters,remaining));
  if(!points.length)continue;
  const text=points.join("");remaining-=points.length;
  selected.push({text,metadata:{sourceId:source.id,contentHash:source.contentHash,ordinal:selected.length+1,originalLength:source.originalLength,includedLength:points.length,truncated:points.length<source.originalLength,includedHash:sha256(text)}});
 }
 return selected;
}
export function manifestFor(request:ProviderRequest,selected:ReturnType<typeof boundedAnalysisSources>):AnalysisInputManifest {
 const exact=stableJson(request);
 return analysisInputManifest.parse({policyVersion:ANALYSIS_INPUT_POLICY,promptVersion:ANALYSIS_PROMPT_VERSION,requestHash:sha256(exact),inputBytes:Buffer.byteLength(exact),maxOutputTokens:request.maxOutputTokens,sources:selected.map(s=>s.metadata)});
}
