import {and,desc,eq,inArray} from "drizzle-orm";
import type {DbExecutor} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {products,productVersions,mappings} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import {AccessDenied} from "../identity/service";
/** Configuration workspace needs only the current active/draft and a bounded association context. */
export async function productWorkspaceData(db:DbExecutor,scope:Scope,id:string){
 await verifyScope(db,scope);
 const [product]=await db.select().from(products).where(and(tenantWhere(products,scope),eq(products.id,id)));
 if(!product)throw new AccessDenied();
 const [versions,bindings]=await Promise.all([
 db.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.productId,id),inArray(productVersions.status,["ACTIVE","DRAFT"]))).orderBy(desc(productVersions.versionNumber)).limit(2),
 db.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.productId,id))).orderBy(mappings.listingExternalId,mappings.variantKey).limit(101)]);
 return {product,active:versions.find(v=>v.status==="ACTIVE"&&v.id===product.activeVersionId),draft:versions.find(v=>v.status==="DRAFT"),bindings:bindings.slice(0,100),associationsLimited:bindings.length>100};
}
