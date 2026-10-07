import { createHash } from "node:crypto";
import { z } from "zod";
import { stableJson } from "../intake/contracts";
import { detached, hashSchema, deckReferenceSchema, resolvedCardSchema } from "../media/contracts";
import { semanticCardSchema, semanticCardsSchema } from "../media/reading-contract";
import { immutableDocumentSnapshot, documentSnapshotSchema, type DocumentSnapshot } from "./snapshot-contract";
const card=semanticCardSchema.extend({asset:resolvedCardSchema.shape.asset}).strict();
export const documentMediaSchema=z.discriminatedUnion("mode",[
 z.strictObject({mode:z.literal("NONE")}),
 z.strictObject({mode:z.literal("TAROT_CARDS"),deck:deckReferenceSchema,cards:z.array(card).min(1).max(10)}),
]);
export const documentMediaSnapshotSchema=z.strictObject({contractVersion:z.literal("document-media-snapshot/v1"),id:z.uuid(),organizationId:z.uuid(),storeId:z.uuid(),documentSnapshotId:z.uuid(),readingId:z.uuid(),provenance:z.strictObject({reviewId:z.uuid(),generationId:z.uuid(),approvedMediaHash:hashSchema}),media:documentMediaSchema,mediaHash:hashSchema,createdAt:z.iso.datetime()});
export type DocumentMediaSnapshot=ReturnType<typeof immutableDocumentMedia>;
export class DocumentMediaUnavailable extends Error {constructor(){super("DOCUMENT_MEDIA_UNAVAILABLE");}}
export function documentMediaHash(media:z.infer<typeof documentMediaSchema>) {return createHash("sha256").update(stableJson(media)).digest("hex");}
export function immutableDocumentMedia(raw:unknown) {
 try {
  const value=documentMediaSnapshotSchema.parse(raw);
  if(value.media.mode==="TAROT_CARDS")semanticCardsSchema.parse(value.media.cards.map(({cardKey,orientation,position})=>({cardKey,orientation,position})));
  if(documentMediaHash(value.media)!==value.mediaHash)throw new Error();
  return detached(value);
 }catch{throw new DocumentMediaUnavailable();}
}
export function renderInputHash(snapshotHash:string,mediaHash:string) {return createHash("sha256").update(stableJson({snapshotHash:hashSchema.parse(snapshotHash),mediaHash:hashSchema.parse(mediaHash)})).digest("hex");}
export const renderInputSchema=z.strictObject({contractVersion:z.literal("document-render-input/v1"),snapshot:documentSnapshotSchema,media:documentMediaSnapshotSchema,renderInputHash:hashSchema});
export function immutableRenderInput(snapshot:DocumentSnapshot,rawMedia:unknown) {
 const text=immutableDocumentSnapshot(snapshot),media=immutableDocumentMedia(rawMedia);
 if(text.id!==media.documentSnapshotId || text.organizationId!==media.organizationId || text.storeId!==media.storeId || text.reading.readingId!==media.readingId || text.provenance.reviewId!==media.provenance.reviewId || text.provenance.generationId!==media.provenance.generationId)throw new DocumentMediaUnavailable();
 return detached({contractVersion:"document-render-input/v1" as const,snapshot:text,media,renderInputHash:renderInputHash(text.snapshotHash,media.mediaHash)});
}
export type DocumentRenderInput=ReturnType<typeof immutableRenderInput>;
