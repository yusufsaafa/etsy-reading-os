import { z } from "zod";

export const STYLE_INTELLIGENCE_CONTRACT = "style-intelligence/v1" as const;
export const STYLE_ANALYSIS_OPERATION = "style-analysis/v1" as const;
const tendency = z.string().trim().min(1).max(240);
const tendencies = z.array(tendency).max(6);
// STYLE-LEVEL ONLY: describe how the seller writes. No customer facts or conclusions.
// Strict shape is not a semantic detector for names leaked inside an allowed string.
export const styleIntelligence = z.object({
  contractVersion: z.literal(STYLE_INTELLIGENCE_CONTRACT),
  voiceSummary: z.string().trim().min(1).max(600),
  tone: tendencies,
  structure: z.object({ opening: tendencies, development: tendencies, transitions: tendencies, closing: tendencies }).strict(),
  diction: tendencies,
  sentenceAndParagraph: tendencies,
  personalization: tendencies,
  uncertainty: tendencies,
  formatting: tendencies,
  preferredPatterns: tendencies,
  avoidedPatterns: tendencies,
  generationGuidance: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
}).strict();
export type StyleIntelligence = z.infer<typeof styleIntelligence>;
export const analysisSelection = z.object({
  styleProfileId: z.string().uuid(),
  sourceIds: z.array(z.string().uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "Duplicate sources"),
}).strict();
// No duplicate usage ledger: provider/model provenance is obtained from this owned AIRequest.
export const analysisCompletion = z.object({ payload: styleIntelligence, aiRequestId: z.string().uuid().nullable() }).strict();
export const analysisFailure = z.enum(["INVALID_RESULT", "PROVIDER_FAILURE", "CANCELED", "INTERNAL_FAILURE", "POLICY_REJECTED", "BUDGET_REJECTED", "AMBIGUOUS_EXECUTION"]);

// Additive frozen GenerationContext extension; legacy contexts omit this property.
export const pinnedStyleIntelligence = z.object({
  analysisVersionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  contractVersion: z.literal(STYLE_INTELLIGENCE_CONTRACT),
  payload: styleIntelligence,
}).strict();
export type PinnedStyleIntelligence = z.infer<typeof pinnedStyleIntelligence>;
