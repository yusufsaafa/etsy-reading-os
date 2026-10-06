import { parseArgs } from 'node:util';
import { openSync,writeFileSync,fsyncSync,closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function validateAttemptId(id:string) {
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))throw new Error('Attempt ID must be 1..64 lowercase letters, digits or hyphens');
 return id;
}
export function acceptanceArguments(args:string[]) {
 if(args.filter(a=>a==='--attempt-id'||a.startsWith('--attempt-id=')).length>1)throw new Error('Supply exactly one attempt ID');
 const {values}=parseArgs({args,options:{live:{type:'boolean'},'attempt-id':{type:'string'}},strict:true});
 const live=values.live??false,attemptId=values['attempt-id'];
 if(live&&!attemptId)throw new Error('Live mode requires an explicitly authorized --attempt-id');
 return {live,attemptId:attemptId===undefined?undefined:validateAttemptId(attemptId)};
}
// One local durable claim per explicit authorization identity. Never remove or replace it.
export function claimAcceptanceAttempt(attemptId:string,directory=tmpdir()) {
 const id=validateAttemptId(attemptId);
 const markerPath=join(directory,'reading-os-gemini-acceptance.'+id+'.dispatched');
 const fd=openSync(markerPath,'wx',0o600);
 try{
  const commandKey=randomUUID();
  writeFileSync(fd,JSON.stringify({attemptId:id,commandKey,createdAt:new Date().toISOString(),intent:'one controlled synthetic acceptance'},null,2)+'\n');
  fsyncSync(fd);
  return {attemptId:id,commandKey,markerPath};
 }finally{closeSync(fd);}
}
