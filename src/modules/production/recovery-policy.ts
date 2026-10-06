import { createHash } from "node:crypto";
import { MAX_GENERATION_ATTEMPTS } from "../generation/contracts";
export { MAX_GENERATION_ATTEMPTS };
export type RecoveryClass="PRE_DISPATCH_SAFE"|"KNOWN_RETRYABLE"|"KNOWN_NON_RETRYABLE"|"AMBIGUOUS"|"ALREADY_COMPLETED"|"IN_PROGRESS"|"INCONSISTENT";
export const PRODUCTION_TICK_LOCK=1380926288;
export const productionRecoveryPolicy={inspectionLimit:50,backoffMs:[30000,120000] as readonly number[],tickLeaseMs:900000};
// Stable namespaced command; never derived from worker memory/time. Persisted before claim.
export function retryCommandIdentity(queueId:string,attempt:number){
 if(!Number.isInteger(attempt)||attempt<2||attempt>MAX_GENERATION_ATTEMPTS)throw new Error("INVALID_RETRY_ATTEMPT");
 const hex=createHash("sha256").update(`reading-os:production-retry:v1:${queueId}:${attempt}`).digest("hex");
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export const productionCommand=(item:{generationCommandKey:string|null;retryCommandKey:string|null;id:string})=>item.retryCommandKey??item.generationCommandKey??item.id;
export function classifyKnownFailure(request:{ambiguous:boolean;failureCode:string|null;startedAt:Date|null}):RecoveryClass{
 if(request.ambiguous||["TIMEOUT","NETWORK"].includes(request.failureCode??""))return "AMBIGUOUS";
 if(request.startedAt===null&&["ADMISSION_CHANGED","BLOCKED"].includes(request.failureCode??""))return "PRE_DISPATCH_SAFE";
 return request.failureCode==="RATE_LIMIT"?"KNOWN_RETRYABLE":"KNOWN_NON_RETRYABLE";
}
