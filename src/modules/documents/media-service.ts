import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { documentMediaSnapshots, readingReviews } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { stableJson, type Scope } from "../intake/contracts";
import { getApprovedReadingMediaInTransaction } from "../review/service";
import { immutableApprovedReadingMedia } from "../review/approved-media";
import { getStorePreferredTarotDeckInTransaction, resolveTarotCardAssetInTransaction } from "../media/service";
import { createDocumentSnapshotCommand, createDocumentSnapshotInTransaction, getDocumentSnapshotForRenderInTransaction } from "./snapshot-service";
import { documentMediaHash, immutableDocumentMedia, immutableRenderInput, DocumentMediaUnavailable, type DocumentRenderInput } from "./media-contract";
/** Caller submits Reading/order intent only. Text/design/media freeze in one Store-locked transaction. */
export async function createDocumentRenderInput(db:Database,scope:Scope,raw:unknown):Promise<DocumentRenderInput> {
 const command=createDocumentSnapshotCommand.parse(raw);
 return db.transaction(async tx=>{
  const snapshot=await createDocumentSnapshotInTransaction(tx,scope,command);
  const approved=await getApprovedReadingMediaInTransaction(tx,scope,command.orderId,command.readingId);
  let media:import("zod").infer<typeof import("./media-contract").documentMediaSchema>={mode:"NONE"};
  if(approved.media.mode==="TAROT_CARDS") {
   const preference=await getStorePreferredTarotDeckInTransaction(tx,scope);
   if(preference.status!=="CONFIGURED")throw new Error("DOCUMENT_MEDIA_SETUP_REQUIRED");
   const deck={deckKey:preference.deckKey,deckVersion:preference.deckVersion};
   const cards=[];
   for(const card of approved.media.cards) {const resolved=await resolveTarotCardAssetInTransaction(tx,{...deck,cardKey:card.cardKey});cards.push({...card,asset:resolved.asset});}
   media={mode:"TAROT_CARDS",deck,cards};
  }
  const value=immutableDocumentMedia({contractVersion:"document-media-snapshot/v1",id:randomUUID(),organizationId:scope.organizationId,storeId:scope.storeId,documentSnapshotId:snapshot.id,readingId:command.readingId,provenance:{...approved.provenance,approvedMediaHash:approved.mediaHash},media,mediaHash:documentMediaHash(media),createdAt:new Date().toISOString()});
  const [existing]=await tx.select().from(documentMediaSnapshots).where(and(tenantWhere(documentMediaSnapshots,scope),eq(documentMediaSnapshots.documentSnapshotId,snapshot.id),eq(documentMediaSnapshots.mediaHash,value.mediaHash)));
  if(existing)return readStored(tx,scope,existing);
  const [saved]=await tx.insert(documentMediaSnapshots).values({id:value.id,organizationId:scope.organizationId,storeId:scope.storeId,documentSnapshotId:snapshot.id,readingId:command.readingId,reviewId:approved.provenance.reviewId,generationId:approved.provenance.generationId,mediaHash:value.mediaHash,payload:value,createdAt:new Date(value.createdAt)}).returning();
  return readStored(tx,scope,saved);
 });
}
async function readStored(tx:DbExecutor,scope:Scope,row:typeof documentMediaSnapshots.$inferSelect):Promise<DocumentRenderInput> {
 try {
  const media=immutableDocumentMedia(row.payload);
  if(row.organizationId!==scope.organizationId || row.storeId!==scope.storeId || media.organizationId!==row.organizationId || media.storeId!==row.storeId || media.id!==row.id || media.documentSnapshotId!==row.documentSnapshotId || media.readingId!==row.readingId || media.provenance.reviewId!==row.reviewId || media.provenance.generationId!==row.generationId || media.mediaHash!==row.mediaHash || row.createdAt.toISOString()!==media.createdAt)throw new Error();
  const snapshot=await getDocumentSnapshotForRenderInTransaction(tx,scope,row.documentSnapshotId);
  const [review]=await tx.select({approvedMedia:readingReviews.approvedMedia}).from(readingReviews).where(and(tenantWhere(readingReviews,scope),eq(readingReviews.id,row.reviewId),eq(readingReviews.unitId,row.readingId),eq(readingReviews.generationId,row.generationId),eq(readingReviews.state,"APPROVED")));
  if(!review)throw new Error();
  // Historical NONE approval needs no fabricated media row. Never re-read Generation body/cards.
  const approved=immutableApprovedReadingMedia(review.approvedMedia ?? {contractVersion:"approved-reading-media/v1",organizationId:scope.organizationId,storeId:scope.storeId,readingId:row.readingId,provenance:snapshot.provenance,requirement:{mode:"NONE"},media:{mode:"NONE"},mediaHash:media.provenance.approvedMediaHash,approvedAt:snapshot.reading.approvedAt});
  if(approved.organizationId!==scope.organizationId || approved.storeId!==scope.storeId || approved.readingId!==row.readingId || approved.provenance.reviewId!==row.reviewId || approved.provenance.generationId!==row.generationId || approved.approvedAt!==snapshot.reading.approvedAt || approved.mediaHash!==media.provenance.approvedMediaHash || approved.media.mode!==media.media.mode)throw new Error();
  if(media.media.mode==="TAROT_CARDS" && approved.media.mode==="TAROT_CARDS") {
   const {cards,deck}=media.media;
   if(stableJson(cards.map(({cardKey,orientation,position})=>({cardKey,orientation,position})))!==stableJson(approved.media.cards))throw new Error();
   for(const card of cards) {const exact=await resolveTarotCardAssetInTransaction(tx,{...deck,cardKey:card.cardKey});if(stableJson(exact.asset)!==stableJson(card.asset))throw new Error();}
  }
  return immutableRenderInput(snapshot,media);
 }catch{throw new DocumentMediaUnavailable();}
}
/** One exact immutable combined input. No current preference/design/draft/latest Generation lookup. */
export async function getDocumentRenderInput(db:Database,scope:Scope,mediaSnapshotId:string):Promise<DocumentRenderInput> {
 await verifyScope(db,scope);if(!z.uuid().safeParse(mediaSnapshotId).success)throw new DocumentMediaUnavailable();
 return db.transaction(async tx=>{const [row]=await tx.select().from(documentMediaSnapshots).where(and(tenantWhere(documentMediaSnapshots,scope),eq(documentMediaSnapshots.id,mediaSnapshotId)));if(!row)throw new DocumentMediaUnavailable();return readStored(tx,scope,row);},{isolationLevel:"repeatable read"});
}
