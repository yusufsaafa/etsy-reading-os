import { it,expect } from "vitest";
import { readFileSync,readdirSync } from "node:fs";
it("production execution cannot import/call gateway or provider directly and has no browser route",()=>{
 const execution=readFileSync("src/modules/production/execution.ts","utf8");
 expect(execution).toContain("this.generation.prepareProduction(");
 expect(execution).not.toMatch(/CentralAIGateway|GenerationProvider|\.generate\(|infrastructure\/ai/);
 for(const name of readdirSync("src/components/generation"))expect(readFileSync("src/components/generation/"+name,"utf8")).not.toMatch(/ProductionExecutor|ProductionAuthority|productionRuntime|issueProductionAuthority/);
});
