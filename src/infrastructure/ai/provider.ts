export type TokenUsage = { inputTokens?:number; outputTokens?:number; totalTokens?:number; reasoningTokens?:number; cachedTokens?:number };
export type ProviderRequest = { model:string; system:string; data:string; sections:{sectionId:string;title:string}[]; maxOutputTokens:number };
export type ProviderResponse = { output:string; usage:TokenUsage; requestId?:string; resolvedModel?:string };
export type FailureCode = "TIMEOUT"|"NETWORK"|"RATE_LIMIT"|"AUTH"|"PROVIDER_ERROR"|"INVALID_OUTPUT"|"BLOCKED";
export class ProviderFailure extends Error {
 constructor(public readonly code:FailureCode,public readonly usage:TokenUsage={},public readonly requestId?:string,public readonly ambiguous=false,public readonly resolvedModel?:string) { super(code); }
}
export interface GenerationProvider { readonly name:string; generate(request:ProviderRequest):Promise<ProviderResponse> }
