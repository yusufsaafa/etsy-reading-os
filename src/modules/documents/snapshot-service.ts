import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { documentSnapshots, readingReviews, units, lineItems, generations, productVersions, stores, documentDesigns } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import type { Scope } from "../intake/contracts";
import { getApprovedReadingForDocumentInTransaction } from "../review/service";
import { productIdentityForReading } from "../products/service";
import { resolveDocumentDesignForProductInTransaction } from "./service";
import { DOCUMENT_TEMPLATES } from "./contracts";
import { documentSnapshotHash, immutableDocumentSnapshot, DocumentSnapshotUnavailable, type DocumentSnapshot } from "./snapshot-contract";

export const createDocumentSnapshotCommand = z.strictObject({orderId:z.uuid(),readingId:z.uuid()});
/** Local creation only. Caller supplies intent, never content, design or provenance. */
export async function createDocumentSnapshot(db:Database,scope:Scope,raw:unknown):Promise<DocumentSnapshot> {
  return db.transaction(tx=>createDocumentSnapshotInTransaction(tx,scope,raw));
}
/** Transaction composition only; preserves the exact v1 creation contract/hash. */
export async function createDocumentSnapshotInTransaction(tx:DbExecutor,scope:Scope,raw:unknown):Promise<DocumentSnapshot> {
  const command=createDocumentSnapshotCommand.parse(raw);
    await verifyScope(tx,scope,true);
    await tx.select({id:stores.id}).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
    const approved=await getApprovedReadingForDocumentInTransaction(tx,scope,command.orderId,command.readingId);
    const productId=await productIdentityForReading(tx,scope,approved.readingId,approved.provenance.generationId);
    const resolution=await resolveDocumentDesignForProductInTransaction(tx,scope,productId);
    if(resolution.status!=="RESOLVED")throw new Error("DOCUMENT_DESIGN_SETUP_REQUIRED");
    const design=resolution.design;
    if(approved.storeId!==scope.storeId||approved.organizationId!==scope.organizationId||design.storeId!==scope.storeId||design.organizationId!==scope.organizationId||design.productId!==productId)throw new DocumentSnapshotUnavailable();
    const template=DOCUMENT_TEMPLATES[design.configuration.template];
    const input={contractVersion:"document-snapshot/v1",id:randomUUID(),organizationId:scope.organizationId,storeId:scope.storeId,
      reading:{readingId:approved.readingId,order:approved.order,product:{id:productId,name:approved.product.name},readingNumber:approved.readingNumber,quantity:approved.quantity,
        sections:approved.sections,contentHash:approved.contentHash,approvedAt:approved.approvedAt},
      design:{id:design.designId,revision:design.revision,name:design.name,source:design.source,template:{key:design.configuration.template,contractVersion:template.contractVersion,version:design.templateVersion},configuration:design.configuration,configurationHash:design.configurationHash},
      provenance:approved.provenance,createdAt:new Date().toISOString()};
    const value=immutableDocumentSnapshot({...input,snapshotHash:documentSnapshotHash(input)});
    const [existing]=await tx.select().from(documentSnapshots).where(and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.readingId,value.reading.readingId),eq(documentSnapshots.reviewId,value.provenance.reviewId),eq(documentSnapshots.designId,value.design.id),eq(documentSnapshots.designRevision,value.design.revision),eq(documentSnapshots.snapshotHash,value.snapshotHash)));
    if(existing)return validateStoredSnapshot(tx,scope,existing);
    const [saved]=await tx.insert(documentSnapshots).values({id:value.id,organizationId:scope.organizationId,storeId:scope.storeId,readingId:value.reading.readingId,orderId:value.reading.order.id,productId,
      reviewId:value.provenance.reviewId,generationId:value.provenance.generationId,designId:value.design.id,designRevision:value.design.revision,snapshotHash:value.snapshotHash,payload:value,createdAt:new Date(value.createdAt)}).returning();
    return validateStoredSnapshot(tx,scope,saved);
}
async function validateStoredSnapshot(db:DbExecutor,scope:Scope,row:typeof documentSnapshots.$inferSelect):Promise<DocumentSnapshot> {
  const value=immutableDocumentSnapshot(row.payload);
  if(row.organizationId!==scope.organizationId||row.storeId!==scope.storeId||value.organizationId!==row.organizationId||value.storeId!==row.storeId||value.id!==row.id||value.reading.readingId!==row.readingId||value.reading.order.id!==row.orderId||value.reading.product.id!==row.productId||value.provenance.reviewId!==row.reviewId||value.provenance.generationId!==row.generationId||value.design.id!==row.designId||value.design.revision!==row.designRevision||value.snapshotHash!==row.snapshotHash||!(row.createdAt instanceof Date)||!Number.isFinite(row.createdAt.getTime())||row.createdAt.toISOString()!==value.createdAt)throw new DocumentSnapshotUnavailable();
  // Identity/approval evidence only. Never re-read approved/draft/generated body or current design configuration.
  const [evidence]=await db.select({contentHash:readingReviews.approvedContentHash,approvedAt:readingReviews.approvedAt,productId:productVersions.productId})
    .from(readingReviews)
    .innerJoin(units,and(tenantWhere(units,scope),eq(units.id,readingReviews.unitId)))
    .innerJoin(lineItems,and(tenantWhere(lineItems,scope),eq(lineItems.id,units.lineItemId),eq(lineItems.orderId,row.orderId)))
    .innerJoin(generations,and(tenantWhere(generations,scope),eq(generations.id,readingReviews.generationId),eq(generations.unitId,units.id),eq(generations.productVersionId,units.productVersionId),eq(generations.status,"SUCCEEDED")))
    .innerJoin(productVersions,and(tenantWhere(productVersions,scope),eq(productVersions.id,generations.productVersionId)))
    .where(and(tenantWhere(readingReviews,scope),eq(readingReviews.id,row.reviewId),eq(readingReviews.unitId,row.readingId),eq(readingReviews.generationId,row.generationId),eq(readingReviews.state,"APPROVED")));
  if(!evidence||evidence.productId!==row.productId||evidence.contentHash!==value.reading.contentHash||evidence.approvedAt?.toISOString()!==value.reading.approvedAt)throw new DocumentSnapshotUnavailable();
  const [sourceDesign]=await db.select({id:documentDesigns.id,revision:documentDesigns.revision}).from(documentDesigns)
    .where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.id,row.designId)));
  if(!sourceDesign||sourceDesign.revision<row.designRevision)throw new DocumentSnapshotUnavailable();
  return value;
}
/** Renderer input is this exact immutable snapshot, never a floating latest-state lookup. */
export async function getDocumentSnapshotForRender(db:Database,scope:Scope,snapshotId:string):Promise<DocumentSnapshot> {
  await verifyScope(db,scope);
  if(!z.uuid().safeParse(snapshotId).success)throw new DocumentSnapshotUnavailable();
  return db.transaction(tx=>getDocumentSnapshotForRenderInTransaction(tx,scope,snapshotId),{isolationLevel:"repeatable read"});
}
export async function getDocumentSnapshotForRenderInTransaction(tx:DbExecutor,scope:Scope,snapshotId:string):Promise<DocumentSnapshot> {
    await verifyScope(tx,scope);
    if(!z.uuid().safeParse(snapshotId).success)throw new DocumentSnapshotUnavailable();
    const [row]=await tx.select().from(documentSnapshots).where(and(tenantWhere(documentSnapshots,scope),eq(documentSnapshots.id,snapshotId)));
    if(!row)throw new DocumentSnapshotUnavailable();
    return validateStoredSnapshot(tx,scope,row);
}
