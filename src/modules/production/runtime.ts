import {configuredDocumentPorts} from "../../infrastructure/document-runtime";
import { DocumentProductionWorker,type DocumentProductionPorts } from "./documents";
import type { Database } from "../../db/client";
import { generationRuntime } from "../../infrastructure/ai/runtime";
import { ProductionRecovery } from "./recovery";
import { ProductionTick } from "./tick";
import { ProductionScheduler } from "./scheduler";
import { ProductionExecutor,runProductionCycle } from "./execution";
// Explicit opt-in server invocation only. No recurring runtime or public route.
export function productionRuntime(db:Database,documentPorts?:DocumentProductionPorts){
 const scheduler=ProductionScheduler.forInternalWorker(db);
 const executor=ProductionExecutor.forInternalWorker(db,generationRuntime(db));
 const recovery=ProductionRecovery.forInternalWorker(db);
 const ports=documentPorts??configuredDocumentPorts();
 const documents=ports?DocumentProductionWorker.forInternalWorker(db,ports):undefined;
 const tick=ProductionTick.forInternalWorker(db,recovery,scheduler,executor,documents?()=>documents.runCycle():undefined);
 return {runCycle:()=>runProductionCycle(scheduler,executor),runProductionTick:()=>tick.runProductionTick(),reconcile:()=>recovery.reconcileProductionWork()};
}
