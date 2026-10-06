import { ProviderFailure } from "../../infrastructure/ai/provider";
import { styleIntelligence, type StyleIntelligence } from "./analysis-contracts";
const normalize=(s:string)=>s.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu," ").trim();
function strings(payload:StyleIntelligence):string[] {
 return [payload.voiceSummary,...payload.tone,...Object.values(payload.structure).flat(),...payload.diction,...payload.sentenceAndParagraph,...payload.personalization,...payload.uncertainty,...payload.formatting,...payload.preferredPatterns,...payload.avoidedPatterns,...payload.generationGuidance];
}
export const VERBATIM_WORDS=12;
export const VERBATIM_CHARACTERS=60;
function windows(text:string) {
 const words=normalize(text).split(/\s+/);const result:string[]=[];
 for(let i=0;i+VERBATIM_WORDS<=words.length;i++){const span=words.slice(i,i+VERBATIM_WORDS).join(" ");if(span.length>=VERBATIM_CHARACTERS)result.push(span);}
 return result;
}
// Checks are intentionally finite and deterministic; they are not semantic/NLP certainty.
export function contaminationDetected(payload:StyleIntelligence,sourceTexts:readonly string[]):boolean {
 const values=strings(payload);
 const combined=values.join("\n");
 if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(combined)||/\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|uk|de)\b|(?:^|\s)@[\p{L}\p{N}_]{3,}/iu.test(combined))return true;
 if(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/i.test(combined))return true;
 if(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i.test(combined))return true;
 if((combined.match(/\+?\d[\d ().-]{5,}\d/g)??[]).some(s=>s.replace(/\D/g,"").length>=7))return true;
 if(/\b(?:order|reference|receipt|transaction|ref)\s*(?:id|number|no\.?|#|:)\s*[:#-]?\s*[a-z0-9-]*\d[a-z0-9-]*/i.test(combined)||/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i.test(combined))return true;
 const normalized=values.map(normalize);
 for(const source of sourceTexts) {
  // No customer-name columns exist on StyleSource; recognize explicit labels only, never guess from title.
  for(const match of source.matchAll(/(?:^|\n)\s*(?:customer name|client name|partner name|name)\s*:\s*([\p{L}][\p{L} .'-]{2,59})(?=\n|$)/giu)) {
   const name=normalize(match[1]);if(name.length>=3&&normalized.some(v=>(" "+v+" ").includes(" "+name+" ")))return true;
  }
 }
 const spans=new Set(sourceTexts.flatMap(windows));
 return values.some(value=>windows(value).some(span=>spans.has(span)));
}
export function validateStyleAnalysisOutput(raw:string,sourceTexts:readonly string[]):StyleIntelligence {
 if(Buffer.byteLength(raw)>96000)throw new ProviderFailure("INVALID_OUTPUT");
 let result:StyleIntelligence;
 try {result=styleIntelligence.parse(JSON.parse(raw));}catch{throw new ProviderFailure("INVALID_OUTPUT");}
 if(contaminationDetected(result,sourceTexts))throw new ProviderFailure("POLICY_REJECTED");
 return result;
}
