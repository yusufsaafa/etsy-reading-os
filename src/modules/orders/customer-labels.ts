import type {Answer,ExternalOrder} from "../intake/contracts";
import type {Configuration} from "../products/contracts";
/** Display-only labels from the immutable binding and original purchase evidence.
 * Never rewrite stored answers, use current catalog definitions, or guess ambiguous mappings.
 */
export function historicalCustomerLabels(answers:Answer[],configuration:Pick<Configuration,"inputs"|"etsyFulfillment">|undefined,snapshot:ExternalOrder["lines"][number]):Answer[]{
 const normalize=(label:string)=>label.trim().toLowerCase();
 return answers.map(answer=>{
  const definitions=configuration?.inputs.filter(d=>[d.key,d.label].some(label=>normalize(label)===normalize(answer.label)))??[];
  if(definitions.length!==1)return {...answer};
  const definition=definitions[0],mappings=configuration?.etsyFulfillment?.inputMappings.filter(m=>m.inputKey===definition.key)??[];
  const purchased=mappings.length===1&&configuration?.etsyFulfillment?.listingId===snapshot.listingId?snapshot.etsySource?.buyerInputs.filter(p=>p.questionId.presence==="value"&&p.questionId.value===mappings[0].questionId&&p.propertyId.presence==="value"&&p.propertyId.value===mappings[0].propertyId):undefined;
  let label=definition.label.trim()||answer.label;
  if(purchased?.length===1){const question=purchased[0];
   if(question.definition?.provenance==="PURCHASE_PINNED"&&question.definition.questionText.presence==="value"&&question.definition.questionText.value.trim())label=question.definition.questionText.value;
   else if(question.formattedName.presence==="value"&&question.formattedName.value.trim())label=question.formattedName.value;
  }
  return {...answer,label};
 });
}
