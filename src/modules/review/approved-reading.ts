import {z} from "zod";
import {reviewDraftContent} from "./draft-contract";
/** Stable server-only document input. Body content comes exclusively from immutable approval. */
export const approvedReadingForDocumentSchema=z.object({
 contractVersion:z.literal("approved-reading/v1"),
 organizationId:z.string().uuid(),storeId:z.string().uuid(),readingId:z.string().uuid(),
 order:z.object({id:z.string().uuid(),reference:z.string().min(1).max(200),customerName:z.string().max(1000)}).strict(),
 product:z.object({name:z.string().max(1000),titleSource:z.enum(["PRODUCT_VERSION","LEGACY_FALLBACK"]).optional()}).strict(),
 reader:z.object({displayName:z.string().min(1).max(100),source:z.enum(["SELLER_PROFILE","STORE"])}).strict().optional(),
 readingNumber:z.number().int().positive(),quantity:z.number().int().positive(),
 sections:reviewDraftContent.shape.sections,
 contentHash:z.string().regex(/^[a-f0-9]{64}$/),approvedAt:z.iso.datetime(),
 provenance:z.object({reviewId:z.string().uuid(),generationId:z.string().uuid()}).strict(),
}).strict();
type DeepReadonly<T>=T extends readonly (infer U)[]?readonly DeepReadonly<U>[]:T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
export type ApprovedReadingForDocument=DeepReadonly<z.infer<typeof approvedReadingForDocumentSchema>>;
export function immutableApprovedReading(raw:unknown):ApprovedReadingForDocument {
 const value=approvedReadingForDocumentSchema.parse(raw);
 function freeze<T>(object:T):T {if(object&&typeof object==="object"){for(const child of Object.values(object))freeze(child);Object.freeze(object);}return object;}
 return freeze(value);
}
