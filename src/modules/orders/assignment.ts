import {and,eq,desc,ne} from "drizzle-orm";
import {z} from "zod";
import type {Database,DbExecutor} from "../../db/client";
import {stores,units,lineItems,orders,productVersions,mappings,customerInputs,readingAssignments,auditLogs} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import {triage,type Scope} from "../intake/contracts";
import {AccessDenied} from "../identity/service";
import {configurationSchema,activationErrors,inputPolicy} from "../products/contracts";
import {etsySourceSchema,selectionKey,assessEtsySource} from "../etsy/source-contract";
import {mappedCustomerAnswers} from "../products/runtime";

export class AssignmentError extends Error {constructor(readonly code:string){super(code);}}
export const assignmentCommand=z.object({unitId:z.uuid(),versionId:z.uuid(),commandId:z.uuid(),expectedRevision:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
async function purchase(db:DbExecutor,scope:Scope,unitId:string){
 const [unit]=await db.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,unitId)));
 if(!unit)throw new AccessDenied();
 const [line]=await db.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.id,unit.lineItemId)));
 const [order]=await db.select().from(orders).where(and(tenantWhere(orders,scope),eq(orders.id,line.orderId)));
 const [store]=await db.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId)));
 const parsed=etsySourceSchema.safeParse(line.snapshot.etsySource);
 if(!parsed.success||parsed.data.receipt.createdTimestamp.presence!=="value"||parsed.data.receipt.shopId!==store?.externalShopId||parsed.data.receipt.receiptId!==order.externalId||parsed.data.transaction.transactionId!==line.externalId)throw new AssignmentError("EVIDENCE_REQUIRED");
 if(unit.sourceChanged||!order.paid||order.canceled||order.refund!=="none")throw new AssignmentError("PURCHASE_HOLD");
 return {unit,line,order,source:parsed.data};
}
function compatible(p:Awaited<ReturnType<typeof purchase>>,version:typeof productVersions.$inferSelect,mapping:typeof mappings.$inferSelect|undefined){
 if(!["ACTIVE","ARCHIVED"].includes(version.status)||!version.activatedAt)throw new AssignmentError("VERSION_REQUIRED");
 const parsed=configurationSchema.safeParse(version.configuration);
 if(!parsed.success||activationErrors("Reading",parsed.data).length||!parsed.data.etsyFulfillment)throw new AssignmentError("VERSION_REQUIRED");
 const policy=parsed.data.etsyFulfillment;
 if(policy.listingId!==p.line.listingExternalId||p.source.transaction.listingId.presence!=="value"||policy.listingId!==p.source.transaction.listingId.value)throw new AssignmentError("LISTING_MISMATCH");
 let key:string;try{key=selectionKey(p.source.purchaseSelections.map(s=>({propertyId:s.propertyId,valueIds:s.valueIds.presence==="value"?s.valueIds.value:[]})));}catch{throw new AssignmentError("OPTIONS_MISMATCH");}
 if(key!==p.line.variantKey||key!==selectionKey(policy.purchaseSelections))throw new AssignmentError("OPTIONS_MISMATCH");
 if(!mapping||mapping.productId!==version.productId||mapping.paused)throw new AssignmentError("MAPPING_REQUIRED");
 // Missing/invalid customer values remain generation holds; unresolved source identities do not become approval.
 const source=assessEtsySource(p.source,policy);
 if(source.issues.length)throw new AssignmentError("INPUT_EVIDENCE_REQUIRED");
 return parsed.data;
}
async function versionMapping(db:DbExecutor,scope:Scope,p:Awaited<ReturnType<typeof purchase>>,versionId:string){
 const [version]=await db.select().from(productVersions).where(and(tenantWhere(productVersions,scope),eq(productVersions.id,versionId)));
 if(!version)throw new AssignmentError("VERSION_REQUIRED");
 const [mapping]=await db.select().from(mappings).where(and(tenantWhere(mappings,scope),eq(mappings.productId,version.productId),eq(mappings.listingExternalId,p.line.listingExternalId),eq(mappings.variantKey,p.line.variantKey)));
 return {version,configuration:compatible(p,version,mapping),mapping};
}
/** Read-only bounded candidates from saved published configurations; never today-as-history inference. */
export async function readingRecoveryData(db:DbExecutor,scope:Scope,unitId:string){
 await verifyScope(db,scope,true);
 try{
  const p=await purchase(db,scope,unitId);
  if(p.unit.configurationState!=="unconfigured"||p.unit.productVersionId)return {candidates:[],reason:"ALREADY_CONFIGURED"};
  const versions=await db.select({version:productVersions,mapping:mappings}).from(productVersions).innerJoin(mappings,and(tenantWhere(mappings,scope),eq(mappings.productId,productVersions.productId),eq(mappings.listingExternalId,p.line.listingExternalId),eq(mappings.variantKey,p.line.variantKey))).where(and(tenantWhere(productVersions,scope),ne(productVersions.status,"DRAFT"))).orderBy(desc(productVersions.activatedAt),desc(productVersions.id)).limit(50);
  let blockedReason:string|undefined;
  const candidates=versions.flatMap(({version,mapping})=>{try{const c=compatible(p,version,mapping);return [{id:version.id,title:c.productMetadata?.title??"Published reading",number:version.versionNumber,status:version.status,sections:c.sections.map(s=>s.title),fields:c.inputs.map(i=>i.label),output:c.output,historical:p.source.receipt.createdTimestamp.presence==="value"&&p.source.receipt.createdTimestamp.value<Math.ceil(version.activatedAt!.getTime()/1000)}];}catch(error){if(!(error instanceof AssignmentError))throw error;blockedReason??=error.code;return [];}});
  return {candidates,reason:candidates.length?null:blockedReason??"NO_COMPATIBLE_CONFIGURATION"};
 }catch(error){if(!(error instanceof AssignmentError))throw error;return {candidates:[],reason:error.code};}
}
/** One explicit owner approval. Insertion is the SQL-controlled first-assignment boundary. No AI/admission. */
export async function assignReadingConfiguration(db:Database,scope:Scope,raw:unknown){
 const command=assignmentCommand.parse(raw);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select().from(stores).where(and(eq(stores.organizationId,scope.organizationId),eq(stores.id,scope.storeId))).for("update");
  await verifyScope(tx,scope,true);
  const [unit]=await tx.select().from(units).where(and(tenantWhere(units,scope),eq(units.id,command.unitId))).for("update");
  if(!unit)throw new AccessDenied();
  const [sameCommand]=await tx.select().from(readingAssignments).where(and(tenantWhere(readingAssignments,scope),eq(readingAssignments.commandId,command.commandId)));
  if(sameCommand&&(sameCommand.unitId!==unit.id||sameCommand.productVersionId!==command.versionId))throw new AssignmentError("COMMAND_CONFLICT");
  const [prior]=await tx.select().from(readingAssignments).where(and(tenantWhere(readingAssignments,scope),eq(readingAssignments.unitId,unit.id)));
  if(unit.productVersionId!==null||unit.configurationState!=="unconfigured"){
   if(prior&&unit.configurationState==="versioned"&&unit.productVersionId===command.versionId&&prior.productVersionId===command.versionId){
    const [line]=await tx.select().from(lineItems).where(and(tenantWhere(lineItems,scope),eq(lineItems.id,unit.lineItemId)));
    return {kind:"ALREADY_ASSIGNED" as const,unitId:unit.id,versionId:command.versionId,orderId:line.orderId};
   }
   throw new AssignmentError("ASSIGNMENT_CONFLICT");
  }
  if(unit.revision!==command.expectedRevision)throw new AssignmentError("STALE_INFORMATION");
  const p=await purchase(tx,scope,unit.id),{configuration,mapping}=await versionMapping(tx,scope,p,command.versionId);
  await tx.insert(readingAssignments).values({organizationId:scope.organizationId,storeId:scope.storeId,unitId:unit.id,productVersionId:command.versionId,commandId:command.commandId,actorId:scope.userId,expectedRevision:unit.revision,sourceEvidence:p.source});
  const [context]=await tx.select().from(customerInputs).where(and(tenantWhere(customerInputs,scope),eq(customerInputs.unitId,unit.id))).orderBy(desc(customerInputs.revision)).limit(1);
  if(!context||context.revision!==unit.revision)throw new AssignmentError("STALE_INFORMATION");
  const policy={required:inputPolicy(configuration),paused:mapping!.paused,etsyFulfillment:configuration.etsyFulfillment};
  await tx.update(units).set({issues:triage(p.order.latestSnapshot,p.line.snapshot,policy,mappedCustomerAnswers(p.line.snapshot,context,policy),unit.contextAllocated,unit.sourceChanged)}).where(and(tenantWhere(units,scope),eq(units.id,unit.id)));
  await tx.insert(auditLogs).values({organizationId:scope.organizationId,storeId:scope.storeId,actorId:scope.userId,action:"reading_configuration_first_assigned",resourceId:unit.id});
  return {kind:"ASSIGNED" as const,unitId:unit.id,versionId:command.versionId,orderId:p.order.id};
 });
}
export function assignmentReason(code:string){return ({EVIDENCE_REQUIRED:"Purchased historical evidence is incomplete. Configuration cannot be assigned safely.",PURCHASE_HOLD:"Resolve the payment, refund, cancellation or purchase-change hold first.",NO_COMPATIBLE_CONFIGURATION:"No compatible published configuration is available. Prepare the exact purchased listing and options in Products, then return here.",VERSION_REQUIRED:"Select a valid published configuration in this Store.",LISTING_MISMATCH:"The configuration belongs to a different purchased listing.",OPTIONS_MISMATCH:"The configuration does not match the purchased options.",MAPPING_REQUIRED:"The exact product connection is missing or paused.",INPUT_EVIDENCE_REQUIRED:"The purchased customer-field identities cannot be matched safely to this configuration.",ASSIGNMENT_CONFLICT:"This reading already has an immutable configuration. Refresh to see the assigned version.",COMMAND_CONFLICT:"This confirmation was already used for a different assignment. Refresh before trying again.",STALE_INFORMATION:"Customer information changed. Refresh and review it before confirming."} as Record<string,string>)[code]??"Assignment did not complete. Refresh and check the saved configuration before retrying.";}
