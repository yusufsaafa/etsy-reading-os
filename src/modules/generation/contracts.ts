import { z } from "zod";
import { readingMediaSchema, readingMediaRequirement, validateReadingMedia, semanticCardJsonSchema } from "../media/reading-contract";
import type { Configuration } from "../products/contracts";
import type { StyleConfiguration } from "../seller-style/contracts";
import type { Answer } from "../intake/contracts";
export const OPERATION = "PERSONALIZED_CONTENT_GENERATION" as const;
export { MAX_GENERATION_ATTEMPTS } from "./limits";
export const ENGINE_VERSION = "personalized-content-v1";
export type GenerationContext = {
  version: typeof ENGINE_VERSION;
  unitId: string; orderId: string; lineItemId: string;
  seller: { id: string; displayName: string; shortBio: string; source?: "SELLER_PROFILE"|"STORE" };
  style: { id: string; versionNumber: number; configuration: StyleConfiguration };
  product: { id: string; versionNumber: number; configuration: Configuration };
  styleIntelligence?: import("../seller-style/analysis-contracts").PinnedStyleIntelligence;
  // Optional only for immutable legacy contexts. New admission always pins both.
  styleResolution?: import("zod").infer<typeof import("./defaults").resolvedStyleSchema>;
  outputLanguage?: "en";
  customer: { revision: number; answers: Answer[] };
};
export const canonicalTextSchema = z.object({
  sections: z.array(z.object({ sectionId: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(40000) }).strict()).min(1).max(20),
}).strict();
export const canonicalSchema=canonicalTextSchema.extend({readingMedia:readingMediaSchema.optional()}).strict();
export type CanonicalResult = z.infer<typeof canonicalSchema>;
export function validateCanonical(raw: string, context: GenerationContext): CanonicalResult {
  if (Buffer.byteLength(raw, "utf8") > 512000) throw new Error("INVALID_OUTPUT");
  try {
    const result = canonicalSchema.parse(JSON.parse(raw));
    const expected = context.product.configuration.sections;
    if (result.sections.length !== expected.length || new Set(result.sections.map(s=>s.sectionId)).size !== expected.length) throw new Error();
    const requirement=readingMediaRequirement(context.product.configuration);
    if(requirement.mode==="NONE" && result.readingMedia!==undefined)throw new Error();
    const media=requirement.mode==="TAROT_CARDS" ? validateReadingMedia(result.readingMedia,requirement) : undefined;
    return { ...(media?{readingMedia:media}:{}), sections: expected.map(section=>{
      const output = result.sections.find(s=>s.sectionId===section.id);
      if (!output || output.title !== section.title.trim()) throw new Error();
      return output;
    }) };
  } catch { throw new Error("INVALID_OUTPUT"); }
}
export class AdmissionError extends Error {
  constructor(public readonly code: "CUSTOMER_INFORMATION"|"PRODUCT_SETUP"|"SELLER_SETUP"|"STYLE_SETUP"|"READING_HOLD"|"ACTIVE_OPERATION"|"COMMAND_CONFLICT"|"CONTEXT_CHANGED"|"RETRY_UNCERTAIN"|"BUDGET_LIMIT") { super(code); }
}
export const commandSchema = z.object({ unitId:z.string().uuid(), commandKey:z.string().uuid(), retryGenerationId:z.string().uuid().optional() }).strict();

export function generationStructuredOutput(context:GenerationContext) {
 const requirement=readingMediaRequirement(context.product.configuration);
 if(requirement.mode==="NONE")return undefined; // preserve existing text-only provider projection
 const text=z.toJSONSchema(canonicalTextSchema) as Record<string,unknown>;
 return {contract:"canonical-reading-media/v1",jsonSchema:{...text,properties:{...(text.properties as Record<string,unknown>),readingMedia:semanticCardJsonSchema(requirement.cardCount)},required:["sections","readingMedia"]}};
}
