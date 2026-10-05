import { z } from "zod";
import type { InputPolicy } from "../intake/contracts";
const identity = z.string().min(1).max(100);
export const inputDefinitionSchema = z.object({
  id: identity, key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().max(200),
  type: z.enum(["TEXT", "LONG_TEXT", "DATE"]), required: z.boolean(), helpText: z.string().max(500),
  sortOrder: z.number().int().min(0).max(100),
});
export const sectionSchema = z.object({ id: identity, title: z.string().max(200), instruction: z.string().max(2000), sortOrder: z.number().int().min(0).max(100) });
export const configurationSchema = z.object({
  inputs: z.array(inputDefinitionSchema).max(20), sections: z.array(sectionSchema).max(20),
  output: z.enum(["TEXT", "PDF"]).nullable(), workflow: z.enum(["MANUAL", "ASSISTED", "AUTOMATIC"]).nullable(),
}).strict();
export type Configuration = z.infer<typeof configurationSchema>;
export type InputDefinition = Configuration["inputs"][number];
export const emptyConfiguration: Configuration = { inputs: [], sections: [], output: null, workflow: "ASSISTED" };
export function orderedConfiguration(raw: unknown): Configuration {
  const data = configurationSchema.parse(raw);
  return { ...data, inputs: [...data.inputs].sort((a,b) => a.sortOrder-b.sortOrder || a.id.localeCompare(b.id)), sections: [...data.sections].sort((a,b) => a.sortOrder-b.sortOrder || a.id.localeCompare(b.id)) };
}
export function activationErrors(name: string, raw: unknown): string[] {
  const parsed = configurationSchema.safeParse(raw);
  if (!parsed.success) return ["Check the customer fields, sections, output and workflow settings."];
  const c = parsed.data, errors: string[] = [];
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
  return errors;
}
export function inputPolicy(configuration: Configuration): InputPolicy {
  return configuration.inputs.map(i=>({ key:i.key, label:i.label, type:i.type, required:i.required, minimumLength:1 }));
}
