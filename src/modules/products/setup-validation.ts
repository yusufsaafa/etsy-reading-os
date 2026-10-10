import type {Configuration} from "./contracts";
import type {SetupCatalog} from "../etsy/setup-catalog";
import {selectionKey} from "../etsy/source-contract";
import {configurationIssues} from "./validation";
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
