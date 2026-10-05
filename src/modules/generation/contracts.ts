import { z } from "zod";
import type { Configuration } from "../products/contracts";
import type { StyleConfiguration } from "../seller-style/contracts";
import type { Answer } from "../intake/contracts";
export const OPERATION = "PERSONALIZED_CONTENT_GENERATION" as const;
export const ENGINE_VERSION = "personalized-content-v1";
export type GenerationContext = {
  version: typeof ENGINE_VERSION;
  unitId: string; orderId: string; lineItemId: string;
  seller: { id: string; displayName: string; shortBio: string };
  style: { id: string; versionNumber: number; configuration: StyleConfiguration };
  product: { id: string; versionNumber: number; configuration: Configuration };
  customer: { revision: number; answers: Answer[] };
};
export const canonicalSchema = z.object({
  sections: z.array(z.object({ sectionId: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(40000) }).strict()).min(1).max(20),
}).strict();
export type CanonicalResult = z.infer<typeof canonicalSchema>;
export function validateCanonical(raw: string, context: GenerationContext): CanonicalResult {
  if (Buffer.byteLength(raw, "utf8") > 512000) throw new Error("INVALID_OUTPUT");
  try {
    const result = canonicalSchema.parse(JSON.parse(raw));
    const expected = context.product.configuration.sections;
    if (result.sections.length !== expected.length || new Set(result.sections.map(s=>s.sectionId)).size !== expected.length) throw new Error();
    return { sections: expected.map(section=>{
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
