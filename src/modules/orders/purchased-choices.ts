import type {ExternalOrder} from "../intake/contracts";
/** Informational labels from immutable purchased evidence; never used for mapping. */
export function purchasedChoices(snapshot:ExternalOrder["lines"][number]):string[]{
 if(snapshot.etsySource)return snapshot.etsySource.purchaseSelections.map(s=>{
  const label=s.formattedName.presence==="value"?s.formattedName.value:`Property ${s.propertyId}`;
  const values=s.formattedValues.presence==="value"&&s.formattedValues.value.length?s.formattedValues.value.join(", "):s.valueIds.presence==="value"?`Value IDs ${s.valueIds.value.join(", ")}`:"Purchased value unavailable";
  return `${label}: ${values} (property ${s.propertyId}${s.valueIds.presence==="value"?`; values ${s.valueIds.value.join(", ")}`:""})`;
 });
 return snapshot.variations.map(v=>`${v.label}: ${v.value}`);
}
