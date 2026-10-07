import { CANONICAL_CARDS } from "../../modules/media/catalog";
import { ProviderFailure, type GenerationProvider, type ProviderRequest, type ProviderResponse, type TokenUsage } from "./provider";
export class FakeGenerationProvider implements GenerationProvider {
 readonly name="fake"; calls=0;
 constructor(private readonly options:{output?:string;failure?:ProviderFailure;usage?:TokenUsage;delay?:Promise<void>}={}) {}
 async generate(request:ProviderRequest):Promise<ProviderResponse> {
  this.calls++;if(this.options.delay)await this.options.delay;if(this.options.failure)throw this.options.failure;
  return {output:this.options.output??JSON.stringify(request.structuredOutput?.contract==="style-intelligence/v1"?fakeStyleIntelligence():fakeReading(request)),usage:this.options.usage??{inputTokens:100,outputTokens:200,totalTokens:300},requestId:"fixture-"+this.calls,resolvedModel:request.model};
 }
}

function fakeStyleIntelligence() {
 return {contractVersion:"style-intelligence/v1",voiceSummary:"A warm reflective voice with clear explanations.",tone:["Warm and calm"],structure:{opening:["Acknowledge the recipient"],development:["Explain interpretations in small steps"],transitions:[],closing:["Offer a gentle reflection"]},diction:[],sentenceAndParagraph:["Use readable paragraphs"],personalization:["Address the recipient directly"],uncertainty:["Use cautious possibility language"],formatting:[],preferredPatterns:[],avoidedPatterns:["Absolute guarantees"],generationGuidance:["Keep the writing clear and reflective"]};
}

function fakeReading(request:ProviderRequest) {
 const properties=request.structuredOutput?.jsonSchema.properties as Record<string,any>|undefined;
 const count=properties?.readingMedia?.properties?.cards?.minItems;
 return {sections:request.sections.map(s=>({...s,content:"Prepared example content for "+s.title+"."})),
 ...(typeof count==="number"?{readingMedia:{mode:"TAROT_CARDS",cards:CANONICAL_CARDS.slice(0,count).map((c,position)=>({cardKey:c.key,orientation:position%2?"REVERSED":"UPRIGHT",position}))}}:{})};
}
