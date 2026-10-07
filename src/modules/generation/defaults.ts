import {z} from "zod";
import {styleConfiguration} from "../seller-style/contracts";
export const DEFAULT_STYLE_VERSION="reading-os-default-style/v1" as const;
export const READING_OUTPUT_LANGUAGE="en" as const;
export const resolvedStyleSchema=z.discriminatedUnion("source",[
  z.object({source:z.literal("PLATFORM_DEFAULT"),version:z.literal(DEFAULT_STYLE_VERSION),configuration:styleConfiguration}).strict(),
  z.object({source:z.literal("SELLER_STYLE_INTELLIGENCE"),analysisVersionId:z.uuid(),versionNumber:z.number().int().positive(),contractVersion:z.literal("style-intelligence/v1")}).strict(),
]);
// Fresh deterministic snapshot; never persist a fabricated seller style record.
export function defaultStyle(){return {id:DEFAULT_STYLE_VERSION,versionNumber:1,configuration:styleConfiguration.parse({tone:"WARM",detail:"BALANCED",approach:"STRUCTURED",preferredExpressions:[],avoidExpressions:[],instructions:"Write clearly and respectfully, with readable paragraphs and cautious, non-guaranteed guidance."})};}
