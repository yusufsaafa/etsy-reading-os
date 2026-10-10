import {createHash} from 'node:crypto';
import {and,asc,eq,inArray,ne,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {Database,DbExecutor} from '../../db/client';
import {products,productVersions,stores} from '../../db/schema';
import {stableJson,type Scope} from '../intake/contracts';
import {verifyScope,tenantWhere} from '../intake/service';
import {productWorkspaceData} from './workspace';
import {editProduct,saveProductDraft} from './service';
import {readProductConfigurationAssessment} from './readiness-service';
import {assessProductReadiness} from './readiness';
import {configurationSchema,emptyConfiguration} from './contracts';
import {reusableConfiguration,type ReusePreview,type ReuseSearch} from './reuse-contract';
const selection=z.object({destinationId:z.uuid(),sourceId:z.uuid(),sourceVersionId:z.uuid()}).strict();
export async function searchReuseSources(db:DbExecutor,scope:Scope,destinationId:string,raw:unknown={}):Promise<ReuseSearch>{
 await verifyScope(db,scope);z.uuid().parse(destinationId);await productWorkspaceData(db,scope,destinationId);
 const q=z.object({search:z.string().trim().max(100).default(''),page:z.number().int().min(1).max(10000).default(1)}).strict().parse(raw);
 const pattern='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%';
 const rows=await db.select({id:products.id,name:products.name}).from(products).where(and(tenantWhere(products,scope),ne(products.id,destinationId),sql`${products.name} ilike ${pattern}`,sql`exists(select 1 from ${productVersions} where ${productVersions.productId}=${products.id} and ${productVersions.organizationId}=${scope.organizationId} and ${productVersions.storeId}=${scope.storeId} and (${productVersions.status}='DRAFT' or (${productVersions.status}='ACTIVE' and ${productVersions.id}=${products.activeVersionId})))`)).orderBy(asc(products.name),asc(products.id)).limit(21).offset((q.page-1)*20);
 const page=rows.slice(0,20),ids=page.map(p=>p.id);
 const versions=ids.length?await db.select({id:productVersions.id,productId:productVersions.productId,number:productVersions.versionNumber,revision:productVersions.revision,status:productVersions.status,configuration:productVersions.configuration,activeId:products.activeVersionId}).from(productVersions).innerJoin(products,and(tenantWhere(products,scope),eq(products.id,productVersions.productId))).where(and(tenantWhere(productVersions,scope),inArray(productVersions.productId,ids),inArray(productVersions.status,['ACTIVE','DRAFT']))).orderBy(asc(productVersions.versionNumber)).limit(40):[];
 return {items:page.map(p=>({...p,versions:versions.filter(v=>v.productId===p.id&&(v.status==='DRAFT'||v.id===v.activeId)&&configurationSchema.safeParse(v.configuration).success).map(v=>({id:v.id,number:v.number,revision:v.revision,status:v.status as 'ACTIVE'|'DRAFT'}))})).filter(p=>p.versions.length>0),page:q.page,hasMore:rows.length>20};
}
/** Authorized, consistent persisted preview. Nothing received from the editor is treated as saved data. */
async function previewInTransaction(db:Database,scope:Scope,raw:unknown):Promise<ReusePreview>{
 const q=selection.parse(raw);if(q.destinationId===q.sourceId)throw new Error('REUSE_SAME_PRODUCT');
 const {workspace:destination,snapshot}=await readProductConfigurationAssessment(db,scope,q.destinationId,true);
 const source=await productWorkspaceData(db,scope,q.sourceId);
 const version=[source.active,source.draft].find(v=>v?.id===q.sourceVersionId);
 if(!version)throw new Error('REUSE_SOURCE_UNAVAILABLE');
 const parsed=configurationSchema.safeParse(version.configuration);
 if(!parsed.success)throw new Error('REUSE_SOURCE_INVALID');
 const current=configurationSchema.parse((destination.draft??destination.active)?.configuration??emptyConfiguration);
 const proposed=reusableConfiguration(parsed.data,current);
 const assessed=assessProductReadiness({...snapshot,draft:{id:destination.draft?.id??q.destinationId,versionNumber:destination.draft?.versionNumber??1,revision:destination.draft?.revision??0,configuration:proposed}}).draft;
 const issues=assessed.checks.filter(c=>c.status==='ACTION_REQUIRED').map(c=>c.explanation),unknown=assessed.checks.filter(c=>c.status==='UNKNOWN').map(c=>c.explanation);
 const changes=[['Customer fields',current.inputs,proposed.inputs],['Reading sections and instructions',current.sections,proposed.sections],['Preparation mode',current.workflow,proposed.workflow],['Output format',current.output,proposed.output],['Preparation target and priority',current.fulfillment,proposed.fulfillment]].map(([label,before,after])=>({label:String(label),before:typeof before==='object'?Array.isArray(before)?`${before.length} ${label==='Customer fields'?'fields':'sections'}`:before?`${current.fulfillment?.targetCompletionMinutes??'No'} minutes · ${current.fulfillment?.priorityClass}`:'Not set':String(before??'Not selected'),after:typeof after==='object'?Array.isArray(after)?`${after.length} ${label==='Customer fields'?'fields':'sections'}`:after?`${proposed.fulfillment?.targetCompletionMinutes??'No'} minutes · ${proposed.fulfillment?.priorityClass}`:'Not set':String(after??'Not selected'),changed:stableJson(before??null)!==stableJson(after??null)}));
 const incompatible=proposed.workflow==='AUTOMATIC'||destination.associationsLimited;
 if(proposed.workflow==='AUTOMATIC')issues.unshift('Automatic workflow is not supported. Choose a supported source or correct its draft first.');
 if(destination.associationsLimited)issues.unshift('Destination association evidence exceeds the supported bound. Copy cannot safely review all associations.');
 // Exact source/destination state, policy, mappings, PDF resolution and catalog revision evidence fence apply.
 const token=createHash('sha256').update(stableJson(JSON.parse(JSON.stringify({source:source.product,version,destination:destination.product,draft:destination.draft??null,active:destination.active??null,snapshot,proposed})))).digest('hex');
 return {contractVersion:'product-configuration-reuse/v1',token,source:{id:source.product.id,name:source.product.name,versionId:version.id,number:version.versionNumber,revision:version.revision,status:version.status as 'ACTIVE'|'DRAFT'},destination:{id:destination.product.id,name:destination.product.name,draft:destination.draft?{id:destination.draft.id,revision:destination.draft.revision,number:destination.draft.versionNumber}:null},proposed,compatibility:incompatible?'INCOMPATIBLE':issues.length||unknown.length?'REQUIRES_DESTINATION_CORRECTION':'STRUCTURALLY_VALID',issues,unknown,changes};
}
export async function previewConfigurationReuse(db:Database,scope:Scope,raw:unknown){return db.transaction(tx=>previewInTransaction(tx as unknown as Database,scope,raw),{isolationLevel:'repeatable read'});}
export async function applyConfigurationReuse(db:Database,scope:Scope,raw:unknown){
 const q=selection.extend({token:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).parse(raw);
 return db.transaction(async tx=>{
  await verifyScope(tx,scope,true);
  await tx.select({id:stores.id}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId))).for('update');
  const preview=await previewInTransaction(tx as unknown as Database,scope,{destinationId:q.destinationId,sourceId:q.sourceId,sourceVersionId:q.sourceVersionId});
  if(preview.token!==q.token)throw new Error('REUSE_STALE_PREVIEW');
  if(preview.compatibility==='INCOMPATIBLE')throw new Error('REUSE_INCOMPATIBLE');
  const draftId=preview.destination.draft?.id??await editProduct(tx as unknown as Database,scope,q.destinationId);
  const saved=await saveProductDraft(tx as unknown as Database,scope,q.destinationId,draftId,preview.destination.draft?.revision??0,{name:preview.destination.name,configuration:preview.proposed});
  return {draftId:saved.id,revision:saved.revision};
 });
}
