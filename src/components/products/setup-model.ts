import type {Configuration} from "@/modules/products/contracts";
import {configurationIssues} from "@/modules/products/validation";
import type {SetupCatalog,SetupQuestion} from "@/modules/etsy/setup-catalog";
import {selectionKey} from "@/modules/etsy/source-contract";
export const preparationPresets=[{value:60,label:"1 hour"},{value:360,label:"6 hours"},{value:1440,label:"24 hours"},{value:2880,label:"48 hours"}];
export function customPreparationMinutes(value:string,unit:"hours"|"days"){const n=Number(value),minutes=n*(unit==="days"?1440:60);return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())&&Number.isFinite(minutes)&&Number.isInteger(minutes)&&minutes>=1&&minutes<=525600?minutes:null;}
export function etsyListingUrl(id:string){return /^[1-9]\d{0,18}$/.test(id)&&BigInt(id)<=9223372036854775807n?`https://www.etsy.com/listing/${id}`:null;}
export function mapTextQuestion(c:Configuration,q:SetupQuestion,inputKey:string):Configuration{
 if(!c.etsyFulfillment||q.support!=="TEXT"||!q.questionId)throw new Error("Unsupported buyer question");
 if(inputKey&&!c.inputs.some(f=>f.key===inputKey))throw new Error("Choose a customer field");
 if(inputKey&&c.etsyFulfillment.inputMappings.some(m=>m.inputKey===inputKey&&m.questionId!==q.questionId))throw new Error("Choose a separate field for each question");
 return {...c,etsyFulfillment:{...c.etsyFulfillment,inputMappings:[...c.etsyFulfillment.inputMappings.filter(m=>m.questionId!==q.questionId),...(inputKey?[{questionId:q.questionId,propertyId:"54" as const,sourceType:"text_input" as const,inputKey}]:[])]}};
}
export function setupReadiness(name:string,c:Configuration,catalog?:SetupCatalog){
 const errors=configurationIssues(name,c);
 if(catalog){
  if(catalog.state!=="READY")errors.push("This listing has unsupported or unavailable Etsy setup information.");
  const p=c.etsyFulfillment;
  if(!p||p.listingId!==catalog.listing.id||!catalog.configurations.some(v=>v.key===selectionKey(p.purchaseSelections)))errors.push("Choose a verified Etsy purchase configuration.");
  if(catalog.questions.some(q=>q.support!=="TEXT"||!p?.inputMappings.some(m=>m.questionId===q.questionId)))errors.push("Map each Etsy buyer question to a customer field.");
  if(p?.inputMappings.some(m=>!catalog.questions.some(q=>q.questionId===m.questionId&&q.support==="TEXT")))errors.push("Review changed Etsy buyer questions before activation.");
  if(c.inputs.some(f=>f.required&&!p?.inputMappings.some(m=>m.inputKey===f.key)))errors.push("Map required customer fields to an Etsy buyer question.");
 }
 return [...new Set(errors)];
}
