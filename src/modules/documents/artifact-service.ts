import { and,eq,sql,desc } from "drizzle-orm";
import { z } from "zod";
import type { Database,DbExecutor } from "../../db/client";
import { documentArtifacts,documentMediaSnapshots,documentSnapshots,stores,auditLogs,units,lineItems,orders,generations } from "../../db/schema";
import type { Scope } from "../intake/contracts";
import { verifyScope,tenantWhere } from "../intake/service";
import type { ImmutableArtifactStorage,PlatformAssetStorage } from "../../infrastructure/object-storage";
import { ArtifactStorageError } from "../../infrastructure/object-storage";
import { PDF_RENDERER } from "./pdf/contract";
import { renderDocumentPdfForReading } from "./pdf/service";
import { getDocumentRenderInput } from "./media-service";
import { availableArtifactSchema,artifactObjectKey,immutableArtifact,DocumentArtifactError,type DocumentArtifact } from "./artifact-contract";
import { readArtifactBytes } from "./artifact-storage";
import { retainedBytes,sha256 } from "./resources/bytes";

export async function lockDocumentStore(tx:DbExecutor,scope:Scope){
 await verifyScope(tx,scope,true);
 await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for("update");
}
function contract(row:typeof documentArtifacts.$inferSelect){return immutableArtifact({...row,contractVersion:"document-artifact/v1",createdAt:row.createdAt.toISOString(),availableAt:row.availableAt?.toISOString()??null});}
/** Latest AVAILABLE immutable output per reading in this owned order. No object keys or storage I/O. */
export async function orderAvailableDocumentArtifacts(db:Database,scope:Scope,orderId:string){
 await verifyScope(db,scope);
 if(!z.uuid().safeParse(orderId).success)return [];
 const rows=await db.selectDistinctOn([documentArtifacts.readingId],{artifact:documentArtifacts,generationId:documentSnapshots.generationId,customerRevision:generations.customerRevision}).from(documentArtifacts)
  .innerJoin(units,and(tenantWhere(units,scope),eq(units.id,documentArtifacts.readingId)))
  .innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId),eq(lineItems.orderId,orderId)))
  .innerJoin(orders,and(tenantWhere(orders,scope),eq(orders.id,lineItems.orderId)))
  .innerJoin(documentSnapshots,and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.id,documentArtifacts.documentSnapshotId),eq(documentSnapshots.readingId,units.id),eq(documentSnapshots.orderId,orderId)))
  .innerJoin(generations,and(tenantWhere(generations,scope),eq(generations.id,documentSnapshots.generationId),eq(generations.unitId,units.id)))
  .innerJoin(documentMediaSnapshots,and(tenantWhere(documentMediaSnapshots,scope),eq(documentMediaSnapshots.id,documentArtifacts.mediaSnapshotId),eq(documentMediaSnapshots.documentSnapshotId,documentSnapshots.id),eq(documentMediaSnapshots.readingId,units.id)))
  .where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.orderId,orderId),eq(documentArtifacts.state,"AVAILABLE")))
  .orderBy(documentArtifacts.readingId,desc(documentArtifacts.createdAt),desc(documentArtifacts.id));
 return rows.flatMap(row=>{try{const artifact=contract(row.artifact);return [{id:artifact.id,readingId:artifact.readingId,generationId:row.generationId,customerRevision:row.customerRevision}];}catch{return [];}});
}
/** Historical lookup validates owned immutable relationships, never current design/deck/font state. */
export async function getDocumentArtifact(db:DbExecutor,scope:Scope,readingId:string,artifactId:string):Promise<DocumentArtifact>{
 await verifyScope(db,scope);
 if(!z.uuid().safeParse(readingId).success||!z.uuid().safeParse(artifactId).success)throw new DocumentArtifactError("ARTIFACT_UNAVAILABLE");
 const [row]=await db.select().from(documentArtifacts).where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.id,artifactId),eq(documentArtifacts.readingId,readingId)));
 if(!row)throw new DocumentArtifactError("ARTIFACT_UNAVAILABLE");
 const [d]=await db.select({id:documentSnapshots.id}).from(documentSnapshots).where(and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.id,row.documentSnapshotId),eq(documentSnapshots.readingId,readingId),eq(documentSnapshots.orderId,row.orderId)));
 const [m]=await db.select({id:documentMediaSnapshots.id}).from(documentMediaSnapshots).where(and(tenantWhere(documentMediaSnapshots,scope),eq(documentMediaSnapshots.id,row.mediaSnapshotId),eq(documentMediaSnapshots.documentSnapshotId,row.documentSnapshotId),eq(documentMediaSnapshots.readingId,readingId)));
 if(!d||!m)throw new DocumentArtifactError("ARTIFACT_UNAVAILABLE");
 return contract(row);
}
/** Recoverable protocol: durable PENDING evidence BEFORE conditional object creation.
 * Repeated/ambiguous writes verify the same exact object. No transaction spans storage I/O.
 */
export async function produceDocumentArtifact(db:Database,scope:Scope,mediaSnapshotId:string,assets:PlatformAssetStorage,storage:ImmutableArtifactStorage){
 await verifyScope(db,scope,true);
 if(!z.uuid().safeParse(mediaSnapshotId).success)throw new DocumentArtifactError("ARTIFACT_UNAVAILABLE");
 const [existing]=await db.select().from(documentArtifacts).where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.mediaSnapshotId,mediaSnapshotId),eq(documentArtifacts.rendererVersion,PDF_RENDERER)));
 if(existing?.state==="AVAILABLE")return getDocumentArtifact(db,scope,existing.readingId,existing.id);
 // Pending rows may already have a complete object after a lost response/crash: no render needed.
 if(existing){
  const pending=await getDocumentArtifact(db,scope,existing.readingId,existing.id);
  try{await readArtifactBytes(storage,pending);return finalize(db,scope,pending);}catch(error){if(!(error instanceof ArtifactStorageError)||error.code!=="MISSING")throw error;}
 }
 const input=await getDocumentRenderInput(db,scope,mediaSnapshotId);
 const pdf=await renderDocumentPdfForReading(db,scope,mediaSnapshotId,assets),bytes=pdf.copyBytes();
 if(sha256(bytes)!==pdf.metadata.sha256||bytes.length!==pdf.metadata.byteLength)throw new DocumentArtifactError("DOCUMENT_INVALID");
 const evidence={organizationId:scope.organizationId,storeId:scope.storeId,orderId:input.snapshot.reading.order.id,readingId:input.snapshot.reading.readingId,
 documentSnapshotId:input.snapshot.id,mediaSnapshotId,rendererVersion:pdf.metadata.rendererVersion,layoutHash:pdf.metadata.layoutHash,resourceHash:pdf.metadata.resourceHash,
 sha256:pdf.metadata.sha256,byteLength:pdf.metadata.byteLength,pageCount:pdf.metadata.pageCount,contentType:"application/pdf" as const};
 const pending=await db.transaction(async tx=>{
  await lockDocumentStore(tx,scope);
  const [inserted]=await tx.insert(documentArtifacts).values({...evidence,objectKey:artifactObjectKey(evidence)}).onConflictDoNothing().returning();
  const [winner]=inserted?[inserted]:await tx.select().from(documentArtifacts).where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.mediaSnapshotId,mediaSnapshotId),eq(documentArtifacts.rendererVersion,PDF_RENDERER)));
  if(!winner||Object.entries(evidence).some(([k,v])=>winner[k as keyof typeof winner]!==v))throw new DocumentArtifactError("ARTIFACT_RENDER_CONFLICT");
  if(inserted)await tx.insert(auditLogs).values({...scope,action:"document_artifact_pending",resourceId:winner.id,actorId:null});
  return contract(winner);
 });
 await storage.putImmutable({organizationId:pending.organizationId,objectKey:pending.objectKey,bytes,contentType:"application/pdf",sha256:pending.sha256,byteLength:pending.byteLength});
 await readArtifactBytes(storage,pending);
 return finalize(db,scope,pending);
}
async function finalize(db:Database,scope:Scope,artifact:DocumentArtifact){
 return db.transaction(async tx=>{
  await lockDocumentStore(tx,scope);
  const [row]=await tx.select().from(documentArtifacts).where(and(tenantWhere(documentArtifacts,scope),eq(documentArtifacts.id,artifact.id))).for("update");
  if(!row)throw new DocumentArtifactError("ARTIFACT_UNAVAILABLE");
  if(row.state==="AVAILABLE")return contract(row);
  const [clock]=await tx.select({now:sql<string>`clock_timestamp()::text`}).from(stores).limit(1);
  const [saved]=await tx.update(documentArtifacts).set({state:"AVAILABLE",availableAt:new Date(clock.now)}).where(eq(documentArtifacts.id,row.id)).returning();
  await tx.insert(auditLogs).values({...scope,action:"document_artifact_available",resourceId:row.id,actorId:null});
  return contract(saved);
 });
}
/** Seller/Delivery boundary: authorize Reading + artifact, then bounded full integrity read.
 * Public metadata deliberately excludes objectKey. Download never means delivered.
 */
export async function retrieveDocumentArtifact(db:Database,scope:Scope,raw:unknown,storage:ImmutableArtifactStorage){
 const command=z.strictObject({readingId:z.uuid(),artifactId:z.uuid()}).parse(raw);
 const artifact=await getDocumentArtifact(db,scope,command.readingId,command.artifactId);
 if(artifact.state!=="AVAILABLE")throw new DocumentArtifactError("ARTIFACT_NOT_AVAILABLE");
 const bytes=await readArtifactBytes(storage,artifact),{objectKey:privateKey,...metadata}=artifact;
 void privateKey;
 return Object.freeze({metadata:Object.freeze(availableArtifactSchema.parse({...metadata,contractVersion:"available-document-artifact/v1"})),...retainedBytes(bytes)});
}

/** Explicit new presentation intent; does not replace or rebind an existing successful output.
 * Same current immutable inputs converge; a new design/deck snapshot creates a new artifact.
 * Delivery must select an explicit artifact, never infer a floating latest artifact.
 */
export async function regenerateDocumentArtifact(db:Database,scope:Scope,raw:unknown,assets:PlatformAssetStorage,storage:ImmutableArtifactStorage){
 const {createDocumentRenderInput}=await import("./media-service");
 const input=await createDocumentRenderInput(db,scope,raw);
 return produceDocumentArtifact(db,scope,input.media.id,assets,storage);
}
