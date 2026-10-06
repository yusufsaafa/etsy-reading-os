import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { styleIntelligence, analysisSelection, type StyleIntelligence } from "../src/modules/seller-style/analysis-contracts";
import { intelligence } from "./style-intelligence.fixture";
it("strict versioned writing DNA has no customer factual fields at any object level", () => {
 expect(styleIntelligence.parse(intelligence())).toEqual(intelligence());
 for (const field of ["customerName", "dob", "partnerName", "question", "events", "predictions", "outcomes", "address", "contact", "orderId", "analysis"]) {
  expect(styleIntelligence.safeParse({ ...intelligence(), [field]: "private" }).success).toBe(false);
  expect(styleIntelligence.safeParse({ ...intelligence(), structure: { ...intelligence().structure, [field]: "private" } }).success).toBe(false);
 }
 // @ts-expect-error Customer facts are not part of the derived contract.
 const typed: StyleIntelligence = { ...intelligence(), customerName: "private" };
 expect(styleIntelligence.safeParse(typed).success).toBe(false);
 expect(styleIntelligence.safeParse({ ...intelligence(), contractVersion: "v2" }).success).toBe(false);
});
it("all strings and arrays are bounded, including structure and guidance", () => {
 const valid = intelligence();
 expect(styleIntelligence.safeParse({ ...valid, voiceSummary: "x".repeat(601) }).success).toBe(false);
 for (const key of ["tone", "diction", "sentenceAndParagraph", "personalization", "uncertainty", "formatting", "preferredPatterns", "avoidedPatterns"] as const) {
  for (const value of [Array(7).fill("x"), ["x".repeat(241)], [" "], [{ fact: "private" }]]) expect(styleIntelligence.safeParse({ ...valid, [key]: value }).success).toBe(false);
  expect(styleIntelligence.safeParse({ ...valid, [key]: Array(6).fill("x".repeat(240)) }).success).toBe(true);
 }
 for (const key of ["opening", "development", "transitions", "closing"] as const) {
  expect(styleIntelligence.safeParse({ ...valid, structure: { ...valid.structure, [key]: Array(7).fill("x") } }).success).toBe(false);
  expect(styleIntelligence.safeParse({ ...valid, structure: { ...valid.structure, [key]: ["x".repeat(241)] } }).success).toBe(false);
 }
 for (const generationGuidance of [[], Array(9).fill("x"), ["x".repeat(301)]]) expect(styleIntelligence.safeParse({ ...valid, generationGuidance }).success).toBe(false);
 expect(styleIntelligence.safeParse({ ...valid, voiceSummary: "x".repeat(600), generationGuidance: Array(8).fill("x".repeat(300)) }).success).toBe(true);
});
it("source selections reject empty, duplicate and oversized sets", () => {
 const id = "3bbf1d53-08fa-45a4-9578-548325a734c4";
 for (const sourceIds of [[], [id, id], Array(101).fill(id)]) expect(analysisSelection.safeParse({ styleProfileId: id, sourceIds }).success).toBe(false);
});
it("style intelligence foundation has no AI execution or generation/UI entry points", () => {
 const service = readFileSync("src/modules/seller-style/analysis-service.ts", "utf8");
 expect(service).not.toMatch(/infrastructure\/ai|fetch\(|gateway|\.generate\(/);
 for (const file of ["src/modules/generation/context.ts", "src/modules/generation/instructions.ts", "src/modules/seller-style/context.ts"]) expect(readFileSync(file, "utf8")).not.toMatch(/styleAnalysis|styleIntelligence|analysis-service/);
});
