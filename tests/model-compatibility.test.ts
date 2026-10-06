import { it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { pricingFor,reserveCost,calculateCost } from '../src/infrastructure/ai/pricing';
import { acceptanceArguments,acceptanceModel } from '../scripts/lib/acceptance-attempt';
import { GeminiGenerationProvider } from '../src/infrastructure/ai/gemini';
it('both supported Google models have explicit frozen exact pricing and unknown models fail closed',()=>{
 const p=pricingFor('google','gemini-3.5-flash-lite');expect(p).toMatchObject({version:'google-standard-flash-lite-2026-10-06',inputNanosPerToken:'300',outputNanosPerToken:'2500',cachedNanosPerToken:'30'});
 expect(pricingFor('google','gemini-3.8-flash',new Date('2026-10-06')).inputNanosPerToken).toBe('750');
 expect(()=>pricingFor('google','unknown')).toThrow('UNPRICED_MODEL');expect(()=>pricingFor('other','gemini-3.5-flash-lite')).toThrow('UNPRICED_MODEL');
 expect(calculateCost({inputTokens:1000,outputTokens:200,cachedTokens:100},p)).toEqual({state:'estimated',nanos:773000n});expect(calculateCost({},p)).toEqual({state:'unknown',nanos:null});
});
it('reservation reflects selected model rates without changing output limit',()=>{
 expect(reserveCost(2115,8192,pricingFor('google','gemini-3.8-flash',new Date('2026-10-06')))).toBe(38450250n);
 expect(reserveCost(2115,8192,pricingFor('google','gemini-3.5-flash-lite'))).toBe(23572100n);
});
it('acceptance selection is explicit and never falls back for missing or unknown models',()=>{
 const args=acceptanceArguments(['--live','--attempt-id','host-lite-01','--model','gemini-3.5-flash-lite']);expect(args.model).toBe('gemini-3.5-flash-lite');
 expect(acceptanceModel(args.model,'gemini-3.8-flash')).toBe('gemini-3.5-flash-lite');expect(acceptanceModel(undefined,'gemini-3.8-flash')).toBe('gemini-3.8-flash');
 expect(()=>acceptanceModel(undefined,undefined)).toThrow('explicitly');expect(()=>acceptanceModel('unknown','gemini-3.8-flash')).toThrow('UNPRICED_MODEL');
 expect(()=>acceptanceArguments(['--model','a','--model','b'])).toThrow();
});
it.each(['gemini-3.8-flash','gemini-3.5-flash-lite'])('same structured schema goes to exactly one mocked %s dispatch without fallback',async model=>{
 const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE'}}),{status:503}));
 await expect(new GeminiGenerationProvider('fake-only',transport).generate({model,system:'Synthetic',data:'{}',sections:[{sectionId:'intro',title:'Introduction'}],maxOutputTokens:8192})).rejects.toMatchObject({code:'PROVIDER_ERROR',ambiguous:true});
 expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0][0]).toContain('/models/'+model+':generateContent');
 const c=JSON.parse(transport.mock.calls[0][1].body).generationConfig;expect(c).toMatchObject({responseMimeType:'application/json',maxOutputTokens:8192,responseSchema:{required:['sections']}});expect(c.responseSchema.properties.sections.items.properties.sectionId.enum).toEqual(['intro']);
});
it('normal runtime retains existing 3.8 default and harness passes selected model explicitly',()=>{
 expect(readFileSync('src/infrastructure/ai/runtime.ts','utf8')).toContain('"gemini-3.8-flash"');
 const source=readFileSync('scripts/synthetic-gemini-acceptance.ts','utf8');expect(source).toContain('generationRuntime(db,{model})');expect(source).toContain('claimAcceptanceAttempt(attemptId!,tmpdir(),model)');
});
