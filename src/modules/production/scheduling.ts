import { z } from "zod";
export const schedulingConfiguration = z.object({
  claimBatchSize:z.number().int().min(1).max(100),
  claimDurationMs:z.number().int().min(1000).max(3600000),
  agingThresholdMs:z.number().int().min(1).max(604800000),
  deadlineWindowMs:z.number().int().min(0).max(86400000),
  inspectionLimit:z.number().int().min(1).max(10000),
}).strict();
export type SchedulingConfiguration=z.infer<typeof schedulingConfiguration>;
export const defaultSchedulingConfiguration:SchedulingConfiguration={
  claimBatchSize:4,claimDurationMs:120000,agingThresholdMs:7200000,deadlineWindowMs:900000,inspectionLimit:100,
};
export function schedulingConfigurationFromEnvironment(env:Record<string,string|undefined>=process.env) {
  return schedulingConfiguration.parse({...defaultSchedulingConfiguration,
    claimBatchSize:env.PRODUCTION_CLAIM_BATCH_SIZE ? Number(env.PRODUCTION_CLAIM_BATCH_SIZE):defaultSchedulingConfiguration.claimBatchSize,
  });
}
export type Schedulable={id:string;createdAt:Date;targetDeadline:Date|null;priorityClass:string};
const compareText=(a:string,b:string)=>a<b?-1:a>b?1:0;
// Within a Store: starvation override, due work, Express, Standard; then stable ties.
export function compareProductionWork(a:Schedulable,b:Schedulable,now:Date,config:SchedulingConfiguration) {
  function rank(item:Schedulable) {
    if(now.getTime()-item.createdAt.getTime()>=config.agingThresholdMs)return 0;
    if(item.targetDeadline&&item.targetDeadline.getTime()<=now.getTime()+config.deadlineWindowMs)return 1;
    return item.priorityClass==="EXPRESS"?2:3;
  }
  const ar=rank(a),br=rank(b);
  return ar-br || (ar===1 ? a.targetDeadline!.getTime()-b.targetDeadline!.getTime():0)
    || a.createdAt.getTime()-b.createdAt.getTime() || compareText(a.id,b.id);
}
// Namespace-specific transaction lock serializes only short scheduler cycles.
export const PRODUCTION_SCHEDULER_LOCK=1380926287;
