import { it,expect,vi } from 'vitest';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceArguments,claimAcceptanceAttempt } from '../scripts/lib/acceptance-attempt';
function isolated(run:(directory:string)=>void){const directory=mkdtempSync(join(tmpdir(),'reading-os-attempt-test-'));try{run(directory);}finally{rmSync(directory,{recursive:true,force:true});}}
it('first explicit identity gets a durable marker and command identity before mocked dispatch',()=>isolated(directory=>{
 const dispatch=vi.fn(),claim=claimAcceptanceAttempt('host-20261006-02',directory);dispatch(claim);
 expect(JSON.parse(readFileSync(claim.markerPath,'utf8'))).toMatchObject({attemptId:'host-20261006-02',commandKey:claim.commandKey});expect(dispatch).toHaveBeenCalledTimes(1);
}));
it('same identity cannot dispatch twice or overwrite its command',()=>isolated(directory=>{
 const first=claimAcceptanceAttempt('host-02',directory,'gemini-3.8-flash'),before=readFileSync(first.markerPath,'utf8'),dispatch=vi.fn();
 expect(()=>{dispatch(claimAcceptanceAttempt('host-02',directory,'gemini-3.5-flash-lite'));}).toThrow();expect(dispatch).not.toHaveBeenCalled();expect(readFileSync(first.markerPath,'utf8')).toBe(before);
}));
it('legacy marker remains untouched and never authorizes implicit live work',()=>isolated(directory=>{
 const legacy=join(directory,'reading-os-gemini-acceptance-2026-10-06.dispatched');writeFileSync(legacy,'previous ambiguous intent\n');
 expect(()=>acceptanceArguments(['--live'])).toThrow('explicitly authorized');
 claimAcceptanceAttempt('host-02',directory);expect(readFileSync(legacy,'utf8')).toBe('previous ambiguous intent\n');expect(existsSync(legacy)).toBe(true);
}));
it('different explicit identities can reach separate mocked dispatch boundaries without replacing either',()=>isolated(directory=>{
 const dispatch=vi.fn(),a=claimAcceptanceAttempt('host-02',directory);dispatch(a);
 const before=readFileSync(a.markerPath,'utf8'),b=claimAcceptanceAttempt('host-03',directory);dispatch(b);
 expect(dispatch).toHaveBeenCalledTimes(2);expect(a.commandKey).not.toBe(b.commandKey);expect(a.markerPath).not.toBe(b.markerPath);expect(readFileSync(a.markerPath,'utf8')).toBe(before);
}));
it('live mode has no implicit identity and rejects unsafe or ambiguous CLI identifiers',()=>{
 expect(acceptanceArguments([])).toEqual({live:false,attemptId:undefined});
 expect(acceptanceArguments(['--live','--attempt-id','host-20261006-02'])).toEqual({live:true,attemptId:'host-20261006-02'});
 for(const args of [['--live'],['--live','--attempt-id','../escape'],['--live','--attempt-id','a','--attempt-id','b'],['--live','--unknown']])expect(()=>acceptanceArguments(args)).toThrow();
});
