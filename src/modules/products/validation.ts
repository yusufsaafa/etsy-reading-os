import type {Configuration} from "./contracts";
/** Shared seller readiness checks, browser-safe; server still validates the full runtime schema. */
export function configurationIssues(name:string,c:Configuration):string[] {
  const errors: string[] = [];
  if (!name.trim() || name.length > 100) errors.push("Enter a product name.");
  if (new Set(c.inputs.map(i=>i.key)).size !== c.inputs.length) errors.push("Customer field keys must be unique.");
  if (new Set(c.inputs.map(i=>i.label.trim().normalize("NFC"))).size !== c.inputs.length || c.inputs.some(i=>!i.label.trim())) errors.push("Customer field labels must be present and unique.");
  if(c.inputs.some((field,index)=>c.inputs.some((other,otherIndex)=>otherIndex!==index&&field.label.normalize("NFC")===other.key))) errors.push("Customer field labels cannot match another field key.");
  for (const [label, rows] of [["Customer fields", c.inputs], ["Content sections", c.sections]] as const) {
    if (new Set(rows.map(i=>i.id)).size !== rows.length || rows.some((row,index)=>row.sortOrder !== index)) errors.push(label + " must have distinct identities and consecutive ordering.");
  }
  if (!c.sections.length || c.sections.some(s=>!s.title.trim())) errors.push("Add at least one named content section.");
  if (!c.output) errors.push("Choose an output format.");
  if (!c.workflow) errors.push("Choose a workflow.");
  if (c.workflow === "AUTOMATIC") errors.push("Automatic workflow is not available yet. Choose Manual or Assisted.");
  if(c.etsyFulfillment && c.etsyFulfillment.inputMappings.some(m=>!c.inputs.some(i=>i.key===m.inputKey)))
    errors.push("Etsy question mappings must reference configured customer field keys.");
  return errors;
}