import type {Configuration} from "./contracts";
// Setup commands only. Historical versions and scheduling semantics remain unchanged.
export function priorityForTarget(minutes:number|null):"STANDARD"|"EXPRESS" {return minutes!==null&&minutes>0&&minutes<=60?"EXPRESS":"STANDARD";}
export function withTargetPriority(configuration:Configuration):Configuration {return configuration.fulfillment?{...configuration,fulfillment:{...configuration.fulfillment,priorityClass:priorityForTarget(configuration.fulfillment.targetCompletionMinutes)}}:configuration;}
