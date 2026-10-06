import { CentralAIGateway } from "./gateway";
import { FakeGenerationProvider } from "./fake";
import { GeminiGenerationProvider } from "./gemini";
import { pricingFor } from "./pricing";
import type { Database } from "../../db/client";
import { GenerationService } from "../../modules/generation/service";
function money(name:string,fallback?:string) {const value=process.env[name]||fallback;if(!value||!/^\d+$/.test(value))throw new Error(name+" required as integer USD nanos");return BigInt(value);}
export function generationRuntime(db:Database,options:{model?:string}={}) {
 const fake=process.env.AI_PROVIDER==="fake";
 if(fake&&(process.env.NODE_ENV==="production"||process.env.ETSY_ADAPTER!=="fixtures"))throw new Error("FAKE_PROVIDER_DISABLED");
 if(!fake&&process.env.AI_PROVIDER!=="google")throw new Error("AI_PROVIDER must be explicitly configured");
 const provider=fake?new FakeGenerationProvider():new GeminiGenerationProvider(process.env.GEMINI_API_KEY??"");
 const model=options.model??(process.env.AI_GENERATION_MODEL||(fake?"deterministic-v1":"gemini-3.8-flash"));
 const gateway=new CentralAIGateway(db,{provider,model,pricing:pricingFor(provider.name,model),maxOutputTokens:8192,
  dailyBudgetNanos:money("AI_DAILY_BUDGET_NANOS",fake?"0":undefined),attemptBudgetNanos:money("AI_ATTEMPT_BUDGET_NANOS",fake?"0":undefined)});
 return new GenerationService(db,gateway);
}
