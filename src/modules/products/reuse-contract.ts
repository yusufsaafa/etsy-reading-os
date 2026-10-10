import {configurationSchema, orderedConfiguration, type Configuration} from './contracts';
/** Deliberate allowlist: never copy identity, Etsy policy, media or future fields. */
export function reusableConfiguration(source:unknown,destination:unknown):Configuration {
 const s=configurationSchema.parse(source),d=configurationSchema.parse(destination);
 return orderedConfiguration({
  inputs:s.inputs.map(i=>({id:i.id,key:i.key,label:i.label,type:i.type,required:i.required,helpText:i.helpText,sortOrder:i.sortOrder})),
  sections:s.sections.map(i=>({id:i.id,title:i.title,instruction:i.instruction,sortOrder:i.sortOrder})),
  output:s.output,workflow:s.workflow,
  ...(s.fulfillment?{fulfillment:{priorityClass:s.fulfillment.priorityClass,targetCompletionMinutes:s.fulfillment.targetCompletionMinutes}}:{}),
  ...(d.etsyFulfillment?{etsyFulfillment:d.etsyFulfillment}:{}),
  ...(d.productMetadata?{productMetadata:d.productMetadata}:{}),
  ...(d.readingMedia?{readingMedia:d.readingMedia}:{}),
 });
}
export type ReuseSource={id:string;name:string;versions:{id:string;number:number;revision:number;status:'ACTIVE'|'DRAFT'}[]};
export type ReuseSearch={items:ReuseSource[];page:number;hasMore:boolean};
export type ReusePreview={contractVersion:'product-configuration-reuse/v1';token:string;source:{id:string;name:string;versionId:string;number:number;revision:number;status:'ACTIVE'|'DRAFT'};destination:{id:string;name:string;draft:{id:string;revision:number;number:number}|null};proposed:Configuration;compatibility:'STRUCTURALLY_VALID'|'REQUIRES_DESTINATION_CORRECTION'|'INCOMPATIBLE';issues:string[];unknown:string[];changes:{label:string;before:string;after:string;changed:boolean}[]};
