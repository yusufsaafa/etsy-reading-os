import {setupReadiness} from "@/modules/products/setup-validation";
import type {Configuration} from "@/modules/products/contracts";
import type {SetupCatalog,SetupQuestion} from "@/modules/etsy/setup-catalog";
export const preparationPresets=[{value:60,label:"1 hour"},{value:360,label:"6 hours"},{value:1440,label:"24 hours"},{value:2880,label:"48 hours"}];
export function customPreparationMinutes(value:string,unit:"hours"|"days"){const n=Number(value),minutes=n*(unit==="days"?1440:60);return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())&&Number.isFinite(minutes)&&Number.isInteger(minutes)&&minutes>=1&&minutes<=525600?minutes:null;}
export function etsyListingUrl(id:string){return /^[1-9]\d{0,18}$/.test(id)&&BigInt(id)<=9223372036854775807n?`https://www.etsy.com/listing/${id}`:null;}
export function mapTextQuestion(c:Configuration,q:SetupQuestion,inputKey:string):Configuration{
 if(!c.etsyFulfillment||q.support!=="TEXT"||!q.questionId)throw new Error("Unsupported buyer question");
 if(inputKey&&!c.inputs.some(f=>f.key===inputKey))throw new Error("Choose a customer field");
 if(inputKey&&c.etsyFulfillment.inputMappings.some(m=>m.inputKey===inputKey&&m.questionId!==q.questionId))throw new Error("Choose a separate field for each question");
 return {...c,etsyFulfillment:{...c.etsyFulfillment,inputMappings:[...c.etsyFulfillment.inputMappings.filter(m=>m.questionId!==q.questionId),...(inputKey?[{questionId:q.questionId,propertyId:"54" as const,sourceType:"text_input" as const,inputKey}]:[])]}};
}
export {setupReadiness} from "@/modules/products/setup-validation";
export const answerFormats={TEXT:{label:"Short answer",description:"Names and brief details."},LONG_TEXT:{label:"Long answer",description:"Questions and detailed explanations."},DATE:{label:"Date",description:"Birth dates and other calendar dates. Requires a YYYY-MM-DD answer; free text is not parsed automatically."}};
export function setupChecklist(name:string,c:Configuration,catalog?:SetupCatalog){
 const errors=setupReadiness(name,c,catalog);
 const groups=[
  {id:"product-details",label:"Product details",action:"Give this product a name.",match:/product name/i},
  {id:"purchase-options",label:"Etsy purchase options",action:"Confirm the complete purchase choice and resolve unsupported Etsy questions.",match:/unsupported|unavailable|purchase configuration/i},
  {id:"customer-information",label:"Customer information",action:"Connect the questions buyers answer on Etsy to the information used for this reading.",match:/customer|field|question|mapping/i},
  {id:"reading-content",label:"Reading content",action:"Add at least one topic the reading should cover.",match:/section/i},
  {id:"output-format",label:"Output format",action:"Choose whether the customer receives written text or a PDF.",match:/output/i},
  {id:"preparation-mode",label:"Preparation mode",action:"Choose manual or automatic draft preparation. Delivery stays separate.",match:/workflow|automatic/i},
 ];
 const assigned=new Set<string>();const items=groups.map(g=>{const issues=errors.filter(e=>!assigned.has(e)&&g.match.test(e));issues.forEach(e=>assigned.add(e));return {id:g.id,label:g.label,action:g.action,complete:issues.length===0,issues};});
 const rest=errors.filter(e=>!assigned.has(e));if(rest.length)items.push({id:"product-details",label:"Review setup",action:"Review the validation details before activation.",complete:false,issues:rest});
 return items;
}
