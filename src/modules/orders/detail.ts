import {and,eq,inArray,desc} from "drizzle-orm";
import type {Database} from "../../db/client";
import {orders,lineItems,units,customerInputs,mappings,productVersions,generations,productionQueue,aiRequests,memberships} from "../../db/schema";
import {tenantWhere,verifyScope} from "../intake/service";
import type {Scope} from "../intake/contracts";
/** Only this owned order, its purchase evidence and current reading projections. */
export async function orderDetailData(db:Database,scope:Scope,id:string){
 await verifyScope(db,scope);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return null;
 const [order]=await db.select().from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,id))).limit(1);
 if(!order)return null;
 const [membership]=await db.select({role:memberships.role}).from(memberships).where(and(eq(memberships.organizationId,scope.organizationId),eq(memberships.userId,scope.userId)));
 const lines=await db.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.orderId,id))).orderBy(lineItems.id);
 const unitRows=lines.length?await db.select().from(units).where(and(tenantWhere(units,scope),inArray(units.lineItemId,lines.map(l=>l.id)))).orderBy(units.lineItemId,units.unitIndex):[];
 const ids=unitRows.map(u=>u.id),versions=unitRows.flatMap(u=>u.productVersionId?[u.productVersionId]:[]);
 const [inputs,history,queue,configuration,map]=await Promise.all([
 ids.length?db.selectDistinctOn([customerInputs.unitId]).from(customerInputs).where(and(tenantWhere(customerInputs,scope),inArray(customerInputs.unitId,ids))).orderBy(customerInputs.unitId,desc(customerInputs.revision)):[],
 ids.length?db.selectDistinctOn([generations.unitId],{unitId:generations.unitId,id:generations.id,status:generations.status,productVersionId:generations.productVersionId,customerRevision:generations.customerRevision,createdAt:generations.createdAt,completedAt:generations.completedAt}).from(generations).where(and(tenantWhere(generations,scope),inArray(generations.unitId,ids))).orderBy(generations.unitId,desc(generations.createdAt),desc(generations.id)):[],
 ids.length?db.select({unitId:productionQueue.unitId,state:productionQueue.state}).from(productionQueue).where(and(tenantWhere(productionQueue,scope),inArray(productionQueue.unitId,ids))):[],
 versions.length?db.select().from(productVersions).where(and(tenantWhere(productVersions,scope),inArray(productVersions.id,versions))):[],
 lines.length?db.select().from(mappings).where(and(tenantWhere(mappings,scope),inArray(mappings.listingExternalId,lines.map(l=>l.listingExternalId)))):[],
 ]);
 const attempts=history.length?await db.selectDistinctOn([aiRequests.generationId],{generationId:aiRequests.generationId,attemptNumber:aiRequests.attemptNumber,ambiguous:aiRequests.ambiguous,failureCode:aiRequests.failureCode}).from(aiRequests).where(and(tenantWhere(aiRequests,scope),inArray(aiRequests.generationId,history.map(g=>g.id)))).orderBy(aiRequests.generationId,desc(aiRequests.attemptNumber)):[];
 return {order,lines,units:unitRows,inputs,history,queue,versions:configuration,mappings:map,attempts,canOperate:membership?.role==="owner"};
}
