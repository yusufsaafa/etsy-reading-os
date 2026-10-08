import {configurationIssues} from "./validation";
import { z } from "zod";
import { readingMediaRequirementSchema } from "../media/reading-contract";
import type { InputPolicy } from "../intake/contracts";
import { etsyProductPolicySchema } from "../etsy/source-contract";
const identity = z.string().min(1).max(100);
export const inputDefinitionSchema = z.object({
  id: identity, key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().max(200),
  type: z.enum(["TEXT", "LONG_TEXT", "DATE"]), required: z.boolean(), helpText: z.string().max(500),
  sortOrder: z.number().int().min(0).max(100),
});
export const sectionSchema = z.object({ id: identity, title: z.string().max(200), instruction: z.string().max(2000), sortOrder: z.number().int().min(0).max(100) });
export const fulfillmentPolicySchema = z.object({
  priorityClass: z.enum(["STANDARD", "EXPRESS"]),
  targetCompletionMinutes: z.number().int().min(1).max(525600).nullable(),
}).strict();
export const configurationSchema = z.object({
  etsyFulfillment: etsyProductPolicySchema.optional(),
  fulfillment: fulfillmentPolicySchema.optional(),
  readingMedia: readingMediaRequirementSchema.optional(),
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
  return parsed.success ? configurationIssues(name,parsed.data) : ["Check the customer fields, sections, output and workflow settings."];
}

export function inputPolicy(configuration: Configuration): InputPolicy {
  return configuration.inputs.map(i=>({ key:i.key, label:i.label, type:i.type, required:i.required, minimumLength:1 }));
}

// workflow remains the single version-owned automation source; no delivery implication.
export function productionPolicy(configuration: Configuration) {
  return { automation: configuration.workflow,
    ...(configuration.fulfillment ?? { priorityClass: "STANDARD" as const, targetCompletionMinutes: null }) };
}
