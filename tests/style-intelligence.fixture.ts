import { STYLE_INTELLIGENCE_CONTRACT, type StyleIntelligence } from "../src/modules/seller-style/analysis-contracts";
export const intelligence = (): StyleIntelligence => ({
 contractVersion: STYLE_INTELLIGENCE_CONTRACT, voiceSummary: "Warm, reflective and clear.", tone: ["Warm acknowledgment"],
 structure: { opening: ["Acknowledge the recipient"], development: ["Explain interpretations"], transitions: [], closing: ["Offer a gentle reflection"] },
 diction: [], sentenceAndParagraph: [], personalization: ["Address the recipient directly"], uncertainty: ["Use possibility language"], formatting: [],
 preferredPatterns: [], avoidedPatterns: ["Absolute promises"], generationGuidance: ["Keep guidance reflective and concrete"],
});
