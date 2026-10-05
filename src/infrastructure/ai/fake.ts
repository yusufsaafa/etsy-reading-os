import { ProviderFailure, type GenerationProvider, type ProviderRequest, type ProviderResponse, type TokenUsage } from "./provider";
export class FakeGenerationProvider implements GenerationProvider {
 readonly name="fake"; calls=0;
 constructor(private readonly options:{output?:string;failure?:ProviderFailure;usage?:TokenUsage;delay?:Promise<void>}={}) {}
 async generate(request:ProviderRequest):Promise<ProviderResponse> {
  this.calls++;if(this.options.delay)await this.options.delay;if(this.options.failure)throw this.options.failure;
  return {output:this.options.output??JSON.stringify({sections:request.sections.map(s=>({...s,content:"Prepared example content for "+s.title+"."}))}),usage:this.options.usage??{inputTokens:100,outputTokens:200,totalTokens:300},requestId:"fixture-"+this.calls,resolvedModel:request.model};
 }
}
