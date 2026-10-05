import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { mappings, products, productVersions } from "../../db/schema";
import type { Scope, InputPolicy } from "../intake/contracts";
import { inputPolicy } from "./contracts";
type Mapping = typeof mappings.$inferSelect;
export async function resolveConfiguration(db: DbExecutor,scope:Scope,listingId:string,variantKey:string) {
  const [mapping]=await db.select().from(mappings).where(and(eq(mappings.organizationId,scope.organizationId),eq(mappings.storeId,scope.storeId),eq(mappings.listingExternalId,listingId),eq(mappings.variantKey,variantKey)));
  if(!mapping?.productId) return {mapping,version:undefined,state:mapping ? "legacy" : "unconfigured"};
  const [version]=await db.select({id:productVersions.id,configuration:productVersions.configuration}).from(products).innerJoin(productVersions,and(eq(products.activeVersionId,productVersions.id),eq(products.id,productVersions.productId),eq(products.organizationId,productVersions.organizationId),eq(products.storeId,productVersions.storeId))).where(and(eq(products.organizationId,scope.organizationId),eq(products.storeId,scope.storeId),eq(products.id,mapping.productId),eq(productVersions.status,"ACTIVE")));
  return {mapping,version,state:version ? "versioned" : "unconfigured"};
}
export async function unitPolicy(db:DbExecutor,scope:Scope,unit:{productVersionId:string|null;configurationState:string},mapping?:Mapping):Promise<{required:InputPolicy;paused:boolean}|undefined> {
  if(unit.configurationState==="legacy") return mapping ? {required:mapping.required,paused:mapping.paused}:undefined;
  if(!unit.productVersionId) return mapping && !mapping.productId ? {required:mapping.required,paused:mapping.paused} : undefined; // Never retroactively adopt today's configuration on replay.
  const [version]=await db.select({configuration:productVersions.configuration}).from(productVersions).where(and(eq(productVersions.organizationId,scope.organizationId),eq(productVersions.storeId,scope.storeId),eq(productVersions.id,unit.productVersionId)));
  if(!version) throw new Error("CONFIGURATION_UNAVAILABLE");
  return {required:inputPolicy(version.configuration),paused:mapping?.paused??false};
}
