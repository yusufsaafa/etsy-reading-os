import {it,expect,vi} from "vitest";
import {GeminiGenerationProvider} from "../src/infrastructure/ai/gemini";
import {geminiResponseSchema} from "../src/infrastructure/ai/gemini-schema";
import {STYLE_ANALYSIS_JSON_SCHEMA} from "../src/modules/seller-style/analysis-instructions";
const request={model:"gemini-3.5-flash-lite",system:"platform",data:"synthetic",sections:[{sectionId:"one",title:"One"}],maxOutputTokens:8192};
it("projects nested schema deterministically without changing canonical schema",()=>{
 const before=JSON.stringify(STYLE_ANALYSIS_JSON_SCHEMA), projected=geminiResponseSchema(STYLE_ANALYSIS_JSON_SCHEMA);
 expect(geminiResponseSchema(STYLE_ANALYSIS_JSON_SCHEMA)).toEqual(projected);expect(JSON.stringify(STYLE_ANALYSIS_JSON_SCHEMA)).toBe(before);
 expect(projected).not.toHaveProperty("additionalProperties");
 expect(geminiResponseSchema({type:"string",const:"fixed",minLength:1,maxLength:10,$schema:"ignored",description:"hint"})).toEqual({type:"STRING",enum:["fixed"],description:"hint"});
 expect(()=>geminiResponseSchema({type:["string","null"]})).toThrow();
});
it.each([[400,"INVALID_ARGUMENT","PROVIDER_ERROR",false],[401,"UNAUTHENTICATED","AUTH",false],[403,"PERMISSION_DENIED","AUTH",false],[429,"RESOURCE_EXHAUSTED","RATE_LIMIT",false],[500,"INTERNAL","PROVIDER_ERROR",true],[503,"UNAVAILABLE","PROVIDER_ERROR",true]])("captures bounded rejection %s",async(status,category,code,ambiguous)=>{
 const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{status:category,message:"secret body must disappear",details:["private"]}}),{status}));
 const failure=await new GeminiGenerationProvider("secret-key",transport).generate(request).catch(e=>e);
 expect(failure).toMatchObject({code,ambiguous,rejection:{httpStatus:status,googleErrorStatus:category},usage:{}});
 expect(JSON.stringify(failure)).not.toMatch(/secret|private/);expect(transport).toHaveBeenCalledTimes(1);
});
it("unrecognized categories and malformed bodies are discarded",async()=>{
 for(const body of [JSON.stringify({error:{status:"secret-category",message:"secret"}}),"secret invalid body"]){
 const failure=await new GeminiGenerationProvider("secret",vi.fn().mockResolvedValue(new Response(body,{status:400}))).generate(request).catch(e=>e);
 expect(failure.rejection).toEqual({httpStatus:400,googleErrorStatus:undefined});expect(JSON.stringify(failure)).not.toContain("secret");
 }
});
it.each(["TimeoutError","TypeError"])("transport %s has no fabricated HTTP metadata",async name=>{
 const transport=vi.fn().mockRejectedValue(Object.assign(new Error("secret"),{name}));
 const failure=await new GeminiGenerationProvider("secret",transport).generate(request).catch(e=>e);
 expect(failure.ambiguous).toBe(true);expect(failure.rejection).toBeUndefined();expect(transport).toHaveBeenCalledTimes(1);
});
it("generation request retains exact proven schema dialect",async()=>{
 const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"{}"}]}}]})));
 await new GeminiGenerationProvider("test",transport).generate(request);
 const config=JSON.parse(transport.mock.calls[0][1].body).generationConfig;
 expect(config).toEqual({candidateCount:1,maxOutputTokens:8192,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{sections:{type:"ARRAY",items:{type:"OBJECT",properties:{sectionId:{type:"STRING",enum:["one"]},title:{type:"STRING"},content:{type:"STRING"}},required:["sectionId","title","content"]}}},required:["sections"]}});
});
