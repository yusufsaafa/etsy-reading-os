import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../intake/contracts";
import { cardKeySchema, orientationSchema, CANONICAL_CARDS } from "./catalog";
export const readingMediaRequirementSchema=z.discriminatedUnion("mode",[
 z.strictObject({mode:z.literal("NONE")}),
 z.strictObject({mode:z.literal("TAROT_CARDS"),cardCount:z.number().int().min(1).max(10)}),
]);
export type ReadingMediaRequirement=z.infer<typeof readingMediaRequirementSchema>;
/** Absence is retained historical NONE semantics; never backfill published JSON. */
export function readingMediaRequirement(configuration:{readingMedia?:ReadingMediaRequirement}):ReadingMediaRequirement {
 return readingMediaRequirementSchema.parse(configuration.readingMedia ?? {mode:"NONE"});
}
export const semanticCardSchema=z.strictObject({cardKey:cardKeySchema,orientation:orientationSchema,position:z.number().int().min(0).max(9)});
export const semanticCardsSchema=z.array(semanticCardSchema).min(1).max(10).refine(cards=>cards.every((c,i)=>c.position===i) && new Set(cards.map(c=>c.cardKey)).size===cards.length,"Cards require unique identities and consecutive ordered zero-based positions");
export const readingMediaSchema=z.discriminatedUnion("mode",[
 z.strictObject({mode:z.literal("NONE")}),
 z.strictObject({mode:z.literal("TAROT_CARDS"),cards:semanticCardsSchema}),
]);
export type ReadingMedia=z.infer<typeof readingMediaSchema>;
export function validateReadingMedia(raw:unknown,requirement:ReadingMediaRequirement):ReadingMedia {
 const media=readingMediaSchema.parse(raw),expected=readingMediaRequirementSchema.parse(requirement);
 if(media.mode!==expected.mode || (media.mode==="TAROT_CARDS" && expected.mode==="TAROT_CARDS" && media.cards.length!==expected.cardCount))throw new Error("INVALID_READING_MEDIA");
 return media;
}
export function readingMediaHash(requirement:ReadingMediaRequirement,media:ReadingMedia) {
 return createHash("sha256").update(stableJson({requirement,media:validateReadingMedia(media,requirement)})).digest("hex");
}
/** JSON Schema enum projection avoids Zod refinements/transforms unsupported by provider dialects. */
export function semanticCardJsonSchema(count:number) {
 return {type:"object",properties:{mode:{type:"string",enum:["TAROT_CARDS"]},cards:{type:"array",minItems:count,maxItems:count,items:{type:"object",properties:{cardKey:{type:"string",enum:CANONICAL_CARDS.map(c=>c.key)},orientation:{type:"string",enum:["UPRIGHT","REVERSED"]},position:{type:"integer",minimum:0,maximum:count-1}},required:["cardKey","orientation","position"],additionalProperties:false}}},required:["mode","cards"],additionalProperties:false};
}
