import type { TokenUsage } from "./provider";
export type Pricing = { version:string; provider:string; model:string; currency:"USD"; inputNanosPerToken:string; outputNanosPerToken:string; cachedNanosPerToken:string; source:string };
const source="https://ai.google.dev/gemini-api/docs/pricing";
export function pricingFor(provider:string,model:string,at=new Date()):Pricing {
 if(provider==="fake"&&model==="deterministic-v1") return {version:"fake-v1",provider,model,currency:"USD",inputNanosPerToken:"0",outputNanosPerToken:"0",cachedNanosPerToken:"0",source:"local deterministic fixture"};
 if(provider!=="google"||model!=="gemini-3.8-flash") throw new Error("UNPRICED_MODEL");
 const future=at>=new Date("2027-01-01T00:00:00Z");
 return {version:future?"google-standard-2027-01-01":"google-standard-2026-10-05",provider,model,currency:"USD",
 inputNanosPerToken:future?"1500":"750",outputNanosPerToken:future?"7500":"3750",cachedNanosPerToken:future?"150":"75",source};
}
export function normalizedUsage(usage:TokenUsage):TokenUsage {
 return Object.fromEntries(Object.entries(usage).filter(([,n])=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0));
}
export function calculateCost(raw:TokenUsage,pricing:Pricing):{state:"estimated"|"known_zero"|"unknown";nanos:bigint|null} {
 const u=normalizedUsage(raw);
 if(u.inputTokens===undefined||u.outputTokens===undefined|| (u.cachedTokens??0)>u.inputTokens) return {state:"unknown",nanos:null};
 const nanos=BigInt(u.inputTokens-(u.cachedTokens??0))*BigInt(pricing.inputNanosPerToken)+BigInt(u.cachedTokens??0)*BigInt(pricing.cachedNanosPerToken)+BigInt(u.outputTokens)*BigInt(pricing.outputNanosPerToken);
 return {state:pricing.provider==="fake"?"known_zero":"estimated",nanos};
}
export function reserveCost(inputBytes:number,maxOutputTokens:number,p:Pricing) {
 // UTF-8 bytes plus a schema envelope allowance conservatively bound text tokens.
 return BigInt(inputBytes+8192)*BigInt(p.inputNanosPerToken)+BigInt(maxOutputTokens)*BigInt(p.outputNanosPerToken);
}
