import type { Database } from "../../db/client";
import { generationRuntime } from "../../infrastructure/ai/runtime";
import { ProductionScheduler } from "./scheduler";
import { ProductionExecutor,runProductionCycle } from "./execution";
// Explicit opt-in server invocation only. No recurring runtime or public route.
export function productionRuntime(db:Database){
 const scheduler=ProductionScheduler.forInternalWorker(db);
 const executor=ProductionExecutor.forInternalWorker(db,generationRuntime(db));
 return {runCycle:()=>runProductionCycle(scheduler,executor)};
}
