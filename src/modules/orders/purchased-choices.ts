import type {ExternalOrder} from "../intake/contracts";
/** Display original text evidence without pretending it is a validated input mapping. */
export function purchasedAnswers(snapshot:ExternalOrder["lines"][number]){
 if(!snapshot.etsySource)return snapshot.answers;
 return snapshot.etsySource.buyerInputs.flatMap(input=>input.encoding==="TEXT"&&input.value.presence==="value"?[{
  label:input.formattedName.presence==="value"?input.formattedName.value:"Purchased customer information",
  value:input.value.value,kind:"text" as const,
 }]:[]);
}
/** Informational labels from immutable purchased evidence; never used for mapping. */
export function purchasedChoices(snapshot:ExternalOrder["lines"][number]):string[]{
 if(snapshot.etsySource)return snapshot.etsySource.purchaseSelections.map(s=>{
  const label=s.formattedName.presence==="value"?s.formattedName.value:`Property ${s.propertyId}`;
  const values=s.formattedValues.presence==="value"&&s.formattedValues.value.length?s.formattedValues.value.join(", "):s.valueIds.presence==="value"?`Value IDs ${s.valueIds.value.join(", ")}`:"Purchased value unavailable";
  return `${label}: ${values} (property ${s.propertyId}${s.valueIds.presence==="value"?`; values ${s.valueIds.value.join(", ")}`:""})`;
 });
 return snapshot.variations.map(v=>`${v.label}: ${v.value}`);
}
