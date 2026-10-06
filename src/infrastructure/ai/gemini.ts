import { safeTransportCause } from "./transport-diagnostic";
import { z } from "zod";
import { geminiResponseSchema } from "./gemini-schema";
import { ProviderFailure, type GenerationProvider, type ProviderRequest, type ProviderResponse, type TokenUsage } from "./provider";
const token=z.number().int().nonnegative().optional();
const responseSchema=z.object({
 responseId:z.string().max(200).optional(),modelVersion:z.string().max(200).optional(),
 usageMetadata:z.object({promptTokenCount:token,candidatesTokenCount:token,totalTokenCount:token,thoughtsTokenCount:token,cachedContentTokenCount:token}).optional(),
 candidates:z.array(z.object({finishReason:z.string().optional(),content:z.object({parts:z.array(z.object({text:z.string().optional(),thought:z.boolean().optional()}))}).optional()})).optional(),
});
export class GeminiGenerationProvider implements GenerationProvider {
 readonly name="google";
 constructor(private readonly apiKey:string,private readonly transport:typeof fetch=fetch) {if(!apiKey)throw new Error("GEMINI_API_KEY required");}
 async generate(request:ProviderRequest):Promise<ProviderResponse> {
  let response:Response;
  try {
   response=await this.transport("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(request.model)+":generateContent",{
    method:"POST",redirect:"error",headers:{"Content-Type":"application/json","x-goog-api-key":this.apiKey},signal:AbortSignal.timeout(120000),
    body:JSON.stringify({systemInstruction:{parts:[{text:request.system}]},contents:[{role:"user",parts:[{text:request.data}]}],generationConfig:{
     candidateCount:1,maxOutputTokens:request.maxOutputTokens,
     ...(request.structuredOutput ? {responseMimeType:"application/json",responseSchema:geminiResponseSchema(request.structuredOutput.jsonSchema)} : {responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{sections:{type:"ARRAY",items:{type:"OBJECT",properties:{sectionId:{type:"STRING",enum:request.sections.map(s=>s.sectionId)},title:{type:"STRING"},content:{type:"STRING"}},required:["sectionId","title","content"]}}},required:["sections"]}}),
    }}),
   });
  } catch(error) {throw new ProviderFailure(error instanceof Error&&["TimeoutError","AbortError"].includes(error.name)?"TIMEOUT":"NETWORK",{},undefined,true,undefined,safeTransportCause(error));}
  // Provider error bodies may contain private data: never propagate their messages.
  const raw=await response.text().catch(error=>{throw new ProviderFailure("NETWORK",{},undefined,true,undefined,safeTransportCause(error));});
  if(Buffer.byteLength(raw)>1048576)throw new ProviderFailure("PROVIDER_ERROR",{},undefined,true);
  let parsed:z.infer<typeof responseSchema>|undefined;
  try{parsed=responseSchema.parse(JSON.parse(raw));}catch{}
  const m=parsed?.usageMetadata,usage:TokenUsage=m?{inputTokens:m.promptTokenCount,outputTokens:m.candidatesTokenCount===undefined?undefined:m.candidatesTokenCount+(m.thoughtsTokenCount??0),totalTokens:m.totalTokenCount,reasoningTokens:m.thoughtsTokenCount,cachedTokens:m.cachedContentTokenCount??0}:{};
  if(!response.ok)throw new ProviderFailure(response.status===429?"RATE_LIMIT":[401,403].includes(response.status)?"AUTH":"PROVIDER_ERROR",usage,parsed?.responseId,response.status>=500,parsed?.modelVersion,undefined,googleRejectionDiagnostics(response.status,raw));
  const candidate=parsed?.candidates?.[0];
  if(!candidate||candidate.finishReason!=="STOP")throw new ProviderFailure(candidate?.finishReason==="MAX_TOKENS"?"INVALID_OUTPUT":"BLOCKED",usage,parsed?.responseId,false,parsed?.modelVersion);
  return {output:candidate.content?.parts.filter(p=>!p.thought).map(p=>p.text??"").join("")??"",usage,requestId:parsed?.responseId,resolvedModel:parsed?.modelVersion??request.model};
 }
}

const googleStatuses=new Set(["INVALID_ARGUMENT","UNAUTHENTICATED","PERMISSION_DENIED","NOT_FOUND","RESOURCE_EXHAUSTED","INTERNAL","UNAVAILABLE","DEADLINE_EXCEEDED","FAILED_PRECONDITION","OUT_OF_RANGE","UNIMPLEMENTED","ABORTED","CANCELLED","ALREADY_EXISTS","DATA_LOSS","UNKNOWN"]);
function googleRejectionDiagnostics(status:number,raw:string) {
 let category:unknown;try{category=JSON.parse(raw)?.error?.status;}catch{}
 return {httpStatus:status,googleErrorStatus:typeof category==="string"&&googleStatuses.has(category)?category:undefined};
}
