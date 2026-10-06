import { it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GeminiGenerationProvider } from '../src/infrastructure/ai/gemini';
import { safeTransportCause,logTransportFailure } from '../src/infrastructure/ai/transport-diagnostic';
const request={model:'gemini-3.8-flash',system:'Synthetic rules',data:'{}',sections:[{sectionId:'intro',title:'Introduction'}],maxOutputTokens:8192};
const response=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"sections":[]}'}]}}]}));
it('preserves allowlisted Node DNS cause without exception data or retry',async()=>{
 const error=new TypeError('private URL key prompt',{cause:Object.assign(new Error('private details'),{code:'ENOTFOUND'})});
 const transport=vi.fn().mockRejectedValue(error);
 try{await new GeminiGenerationProvider('fake-key-only',transport).generate(request);throw Error('expected');}catch(e){expect(e).toMatchObject({code:'NETWORK',ambiguous:true,transportCause:'ENOTFOUND'});expect(JSON.stringify(e)).not.toMatch(/private|fake-key-only/);expect(e).not.toHaveProperty('cause');}
 expect(transport).toHaveBeenCalledTimes(1);
});
it('logs only allowlisted classification without raw causes',()=>{
 const spy=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{for(const code of ['CERT_HAS_EXPIRED','ECONNREFUSED','EPERM'])expect(safeTransportCause({cause:{code,message:'secret'}})).toBe(code);
 expect(safeTransportCause({cause:{code:'key-private-url',message:'secret'}})).toBe('UNKNOWN');
 logTransportFailure({code:'NETWORK',transportCause:safeTransportCause({code:'key-private-url'})});
 expect(spy).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'ai_transport_failure',category:'NETWORK',transportCause:'UNKNOWN'}));
 spy.mockImplementation(()=>{throw new Error("logger unavailable");});expect(()=>logTransportFailure({code:"NETWORK",transportCause:"ENOTFOUND"})).not.toThrow();
 }finally{spy.mockRestore();}
});
it('timeout and response-stream errors retain safe codes without changing ambiguity',async()=>{
 const timeout=vi.fn().mockRejectedValue(new DOMException('secret','TimeoutError'));
 await expect(new GeminiGenerationProvider('fake',timeout).generate(request)).rejects.toMatchObject({code:'TIMEOUT',ambiguous:true,transportCause:'UNKNOWN'});
 const broken=vi.fn().mockResolvedValue({text:()=>Promise.reject(Object.assign(new Error('secret'),{code:'ECONNRESET'}))});
 await expect(new GeminiGenerationProvider('fake',broken).generate(request)).rejects.toMatchObject({code:'NETWORK',ambiguous:true,transportCause:'ECONNRESET'});
});
it('observer installed before construction sees exactly one mocked call and harness retains this ordering',async()=>{
 const original=vi.fn().mockResolvedValue(response()),observer=vi.fn(async(...args:Parameters<typeof fetch>)=>original(...args));
 vi.stubGlobal('fetch',observer);
 try{const provider=new GeminiGenerationProvider('fake');await provider.generate(request);expect(observer).toHaveBeenCalledTimes(1);expect(original).toHaveBeenCalledTimes(1);
 const source=readFileSync('scripts/synthetic-gemini-acceptance.ts','utf8');expect(source.indexOf('globalThis.fetch=async')).toBeLessThan(source.indexOf('generationRuntime(db).prepare'));
 }finally{vi.unstubAllGlobals();}
});
it('provider captures earlier fetch and therefore a late observer misses it (historical regression)',async()=>{
 const earlier=vi.fn().mockResolvedValue(response()),late=vi.fn();vi.stubGlobal('fetch',earlier);
 try{const provider=new GeminiGenerationProvider('fake');vi.stubGlobal('fetch',late);await provider.generate(request);expect(earlier).toHaveBeenCalledTimes(1);expect(late).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
});
