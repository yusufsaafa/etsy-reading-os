import { z } from "zod";
import { detached, hashSchema } from "../media/contracts";
import { readingMediaRequirementSchema, readingMediaSchema, readingMediaHash, validateReadingMedia } from "../media/reading-contract";
export const approvedReadingMediaSchema=z.strictObject({contractVersion:z.literal("approved-reading-media/v1"),organizationId:z.uuid(),storeId:z.uuid(),readingId:z.uuid(),provenance:z.strictObject({reviewId:z.uuid(),generationId:z.uuid()}),requirement:readingMediaRequirementSchema,media:readingMediaSchema,mediaHash:hashSchema,approvedAt:z.iso.datetime()});
export type ApprovedReadingMedia=ReturnType<typeof immutableApprovedReadingMedia>;
export function immutableApprovedReadingMedia(raw:unknown) {
 const value=approvedReadingMediaSchema.parse(raw);validateReadingMedia(value.media,value.requirement);
 if(readingMediaHash(value.requirement,value.media)!==value.mediaHash)throw new Error("APPROVED_MEDIA_UNAVAILABLE");
 return detached(value);
}
