import { it,expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { classifyKnownFailure,retryCommandIdentity,productionRecoveryPolicy,MAX_GENERATION_ATTEMPTS } from "../src/modules/production/recovery-policy";
it("retry policy is conservative and independent of provider error strings",()=>{
 const startedAt=new Date();expect(classifyKnownFailure({failureCode:"RATE_LIMIT",ambiguous:false,startedAt})).toBe("KNOWN_RETRYABLE");
 for(const failureCode of ["AUTH","BLOCKED","INVALID_OUTPUT","PROVIDER_ERROR"])expect(classifyKnownFailure({failureCode,ambiguous:false,startedAt})).toBe("KNOWN_NON_RETRYABLE");
 for(const failureCode of ["TIMEOUT","NETWORK"])expect(classifyKnownFailure({failureCode,ambiguous:false,startedAt})).toBe("AMBIGUOUS");
 expect(classifyKnownFailure({failureCode:"RATE_LIMIT",ambiguous:true,startedAt})).toBe("AMBIGUOUS");
 expect(classifyKnownFailure({failureCode:"ADMISSION_CHANGED",ambiguous:false,startedAt:null})).toBe("PRE_DISPATCH_SAFE");
});
it("retry command identity is deterministic, namespaced and different for every attempt/queue",()=>{
 const q=randomUUID(),a=retryCommandIdentity(q,2);expect(retryCommandIdentity(q,2)).toBe(a);expect(a).not.toBe(q);expect(retryCommandIdentity(q,3)).not.toBe(a);expect(retryCommandIdentity(randomUUID(),2)).not.toBe(a);expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
it("one engine maximum bounds retry identities and durable delays increase",()=>{
 expect(MAX_GENERATION_ATTEMPTS).toBe(3);for(const n of [0,1,4,2.5])expect(()=>retryCommandIdentity(randomUUID(),n)).toThrow();expect(productionRecoveryPolicy.backoffMs).toEqual([30000,120000]);
});
it("recovery and tick orchestration import no provider, gateway, transport or prompt assembly",()=>{
 for(const file of ["recovery.ts","recovery-state.ts","tick.ts"]){const source=readFileSync("src/modules/production/"+file,"utf8");expect(source).not.toMatch(/infrastructure\/ai|CentralAIGateway|GenerationProvider|\.generate\(|assembleInstructions|generateContent/);}
});
it("trusted recovery has no browser/server action export",()=>{
 const source=readFileSync("src/modules/production/recovery.ts","utf8");expect(source).not.toContain('"use server"');expect(source).toContain("await verifyScope(tx,scope,true)");expect(source).toContain(".limit(this.limit)");
});
