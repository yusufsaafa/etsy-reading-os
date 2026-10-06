import type { Database } from "../../db/client";
import { generationRuntime } from "../../infrastructure/ai/runtime";
import { ProductionRecovery } from "./recovery";
import { ProductionTick } from "./tick";
import { ProductionScheduler } from "./scheduler";
import { ProductionExecutor,runProductionCycle } from "./execution";
// Explicit opt-in server invocation only. No recurring runtime or public route.
export function productionRuntime(db:Database){
 const scheduler=ProductionScheduler.forInternalWorker(db);
 const executor=ProductionExecutor.forInternalWorker(db,generationRuntime(db));
 const recovery=ProductionRecovery.forInternalWorker(db);
 const tick=ProductionTick.forInternalWorker(db,recovery,scheduler,executor);
 return {runCycle:()=>runProductionCycle(scheduler,executor),runProductionTick:()=>tick.runProductionTick(),reconcile:()=>recovery.reconcileProductionWork()};
}
