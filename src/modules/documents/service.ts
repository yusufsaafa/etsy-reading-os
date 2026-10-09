import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client";
import { documentDesigns, productDocumentDesigns, products, stores } from "../../db/schema";
import { tenantWhere, verifyScope } from "../intake/service";
import { stableJson, type Scope } from "../intake/contracts";
import { AccessDenied } from "../identity/service";
import { designWriteSchema, documentDesignSchema, configurationHash, immutableResolvedDesign, type ResolvedDocumentDesign } from "./contracts";
const uuid = z.uuid();
async function lock(tx: DbExecutor, scope: Scope) {
  await verifyScope(tx, scope, true);
  await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
}
function validatedDesign(row: typeof documentDesigns.$inferSelect) {
  const parsed = designWriteSchema.safeParse({name:row.name,configuration:row.configuration});
  if (!parsed.success || !["ACTIVE","ARCHIVED"].includes(row.status) || row.revision < 0 || (row.isDefault && row.status !== "ACTIVE")) throw new Error("DOCUMENT_DESIGN_UNAVAILABLE");
  return {...row, configuration:parsed.data.configuration};
}
async function ownedDesign(db: DbExecutor, scope: Scope, id: string) {
  uuid.parse(id);
  const [row] = await db.select().from(documentDesigns).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.id,id)));
  if (!row) throw new AccessDenied();
  return validatedDesign(row);
}
async function ownedProduct(db: DbExecutor, scope: Scope, id: string) {
  uuid.parse(id);
  const [row] = await db.select({id:products.id}).from(products).where(and(tenantWhere(products,scope),eq(products.id,id)));
  if (!row) throw new AccessDenied();
}
export async function listDocumentDesigns(db: Database, scope: Scope) {
  await verifyScope(db,scope);
  const rows = await db.select().from(documentDesigns).where(tenantWhere(documentDesigns,scope)).orderBy(asc(documentDesigns.createdAt),asc(documentDesigns.id));
  return rows.map(validatedDesign);
}
export async function getDocumentDesign(db: Database, scope: Scope, id: string) { await verifyScope(db,scope); return ownedDesign(db,scope,id); }
export async function createDocumentDesign(db: Database, scope: Scope, input: unknown) {
  const value = designWriteSchema.parse(input);
  return db.transaction(async tx => { await lock(tx,scope); return (await tx.insert(documentDesigns).values({organizationId:scope.organizationId,storeId:scope.storeId,...value}).returning())[0]; });
}
export async function updateDocumentDesign(db: Database, scope: Scope, id: string, expectedRevision: number, input: unknown) {
  const value = designWriteSchema.parse(input); z.number().int().nonnegative().parse(expectedRevision);
  return db.transaction(async tx => {
    await lock(tx,scope); const row = await ownedDesign(tx,scope,id);
    if (row.status !== "ACTIVE") throw new Error("DOCUMENT_DESIGN_ARCHIVED");
    if (row.revision !== expectedRevision) throw new Error("DOCUMENT_DESIGN_CONFLICT");
    if (row.name === value.name && stableJson(row.configuration) === stableJson(value.configuration)) return row;
    return (await tx.update(documentDesigns).set({...value,revision:row.revision+1,updatedAt:new Date()}).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.id,id))).returning())[0];
  });
}
export async function setDefaultDocumentDesign(db: Database, scope: Scope, id: string | null) {
  return db.transaction(async tx => {
    await lock(tx,scope); const target = id ? await ownedDesign(tx,scope,id) : null;
    if (target && target.status !== "ACTIVE") throw new Error("DOCUMENT_DESIGN_ARCHIVED");
    const [current] = await tx.select().from(documentDesigns).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.isDefault,true)));
    if (current?.id === id || (!current && !id)) return;
    if (current) await tx.update(documentDesigns).set({isDefault:false,revision:current.revision+1,updatedAt:new Date()}).where(eq(documentDesigns.id,current.id));
    if (target) await tx.update(documentDesigns).set({isDefault:true,revision:target.revision+1,updatedAt:new Date()}).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.id,target.id)));
  });
}
export async function assignDocumentDesignToProduct(db: Database, scope: Scope, productId: string, designId: string | null) {
  return db.transaction(async tx => {
    await lock(tx,scope); await ownedProduct(tx,scope,productId);
    if (!designId) { await tx.delete(productDocumentDesigns).where(and(tenantWhere(productDocumentDesigns,scope),eq(productDocumentDesigns.productId,productId))); return; }
    const design = await ownedDesign(tx,scope,designId);
    if (design.status !== "ACTIVE") throw new Error("DOCUMENT_DESIGN_ARCHIVED");
    await tx.insert(productDocumentDesigns).values({organizationId:scope.organizationId,storeId:scope.storeId,productId,designId}).onConflictDoUpdate({target:[productDocumentDesigns.organizationId,productDocumentDesigns.storeId,productDocumentDesigns.productId],set:{designId}});
  });
}
export async function archiveDocumentDesign(db: Database, scope: Scope, id: string) {
  return db.transaction(async tx => {
    await lock(tx,scope); const row = await ownedDesign(tx,scope,id);
    if (row.status === "ARCHIVED") return;
    const [assignment] = await tx.select({id:productDocumentDesigns.productId}).from(productDocumentDesigns).where(and(tenantWhere(productDocumentDesigns,scope),eq(productDocumentDesigns.designId,id))).limit(1);
    if (row.isDefault || assignment) throw new Error("DOCUMENT_DESIGN_IN_USE");
    await tx.update(documentDesigns).set({status:"ARCHIVED",revision:row.revision+1,updatedAt:new Date()}).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.id,id)));
  });
}
export type DocumentDesignResolution = { readonly status: "SETUP_REQUIRED" } | { readonly status: "RESOLVED"; readonly design: ResolvedDocumentDesign };
export async function resolveDocumentDesignForProduct(db: Database, scope: Scope, productId: string): Promise<DocumentDesignResolution> {
  return db.transaction(tx => resolveDocumentDesignForProductInTransaction(tx,scope,productId), {isolationLevel:"repeatable read"});
}
export async function resolveDocumentDesignForProductInTransaction(tx: DbExecutor, scope: Scope, productId: string): Promise<DocumentDesignResolution> {
    await verifyScope(tx,scope); await ownedProduct(tx,scope,productId);
    const [assignment] = await tx.select().from(productDocumentDesigns).where(and(tenantWhere(productDocumentDesigns,scope),eq(productDocumentDesigns.productId,productId)));
    const [fallback] = assignment ? [] : await tx.select({id:documentDesigns.id}).from(documentDesigns).where(and(tenantWhere(documentDesigns,scope),eq(documentDesigns.isDefault,true)));
    const id = assignment?.designId ?? fallback?.id;
    if (!id) return Object.freeze({status:"SETUP_REQUIRED" as const});
    const row = await ownedDesign(tx,scope,id);
    if (row.status !== "ACTIVE") throw new Error("DOCUMENT_DESIGN_UNAVAILABLE");
    // Detached, recursively frozen presentation value; no reading or infrastructure data.
    const design = immutableResolvedDesign({contractVersion:"resolved-document-design/v1",organizationId:scope.organizationId,storeId:scope.storeId,productId,designId:row.id,revision:row.revision,name:row.name,source:assignment ? "PRODUCT" : "STORE_DEFAULT",templateVersion:1,configuration:documentDesignSchema.parse(row.configuration),configurationHash:configurationHash(row.configuration)});
    return Object.freeze({status:"RESOLVED" as const,design});

}

/** Owner setup projection; retains the existing resolver and immutable render snapshot model. */
export async function documentDesignSetup(db:Database,scope:Scope,productId:string) {
 await verifyScope(db,scope,true);
 try{
  const result=await resolveDocumentDesignForProduct(db,scope,productId);
  return result.status==="RESOLVED"?{status:"DESIGN_READY" as const,design:result.design}:{status:"SETUP_REQUIRED" as const};
 }catch(error){
  if(error instanceof Error&&error.message==="DOCUMENT_DESIGN_UNAVAILABLE")return {status:"INVALID_CONFIGURATION" as const};
  throw error;
 }
}

/** Owner-only presentation data for assignment navigation; no Reading/customer data. */
export async function listStudioProducts(db:Database,scope:Scope) {
 await verifyScope(db,scope,true);
 return db.select({id:products.id,name:products.name,assignedName:documentDesigns.name}).from(products)
  .leftJoin(productDocumentDesigns,and(eq(productDocumentDesigns.organizationId,products.organizationId),eq(productDocumentDesigns.storeId,products.storeId),eq(productDocumentDesigns.productId,products.id)))
  .leftJoin(documentDesigns,and(eq(documentDesigns.organizationId,products.organizationId),eq(documentDesigns.storeId,products.storeId),eq(documentDesigns.id,productDocumentDesigns.designId)))
  .where(tenantWhere(products,scope)).orderBy(asc(products.name),asc(products.id));
}
