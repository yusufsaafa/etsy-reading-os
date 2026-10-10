import {and,asc,desc,eq,ilike,inArray,or,sql,count} from "drizzle-orm";
import {z} from "zod";
import type {DbExecutor} from "../../db/client";
import {listings,listingCatalog,catalogSections,catalogSync,mappings,products,productVersions,productDocumentDesigns,documentDesigns} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import type {Scope} from "../intake/contracts";
import {configurationSchema,activationErrors} from "../products/contracts";
import {documentDesignSchema} from "../documents/contracts";
import {selectionKey} from "../etsy/source-contract";
import {validateCatalogEvidence} from "./evidence";
import {listingStates} from "./transport";
import type {SetupCatalog} from "../etsy/setup-catalog";
export const catalogQuery=z.object({listingId:z.string().regex(/^[1-9]\d{0,19}$/).optional(),page:z.number().int().min(1).max(10000).default(1),pageSize:z.number().int().min(1).max(50).default(25),search:z.string().trim().max(200).default(""),state:z.enum(["all",...listingStates]).default("all"),section:z.string().max(20).regex(/^(all|uncategorized|unknown|missing|[1-9]\d{0,19})$/).default("all"),sort:z.enum(["title_asc","title_desc","updated_desc"]).default("title_asc")}).strict();
const batchLimit=1000;
const issueMessages:Record<string,string>={SECTIONS_UNAVAILABLE:"Shop sections could not be refreshed. Last verified relationships are retained.",CHOICES_UNAVAILABLE:"Some purchase options could not be refreshed. Their configuration coverage is not verified.",RATE_LIMIT:"Etsy has limited requests. Wait before resuming synchronization.",AUTHORIZATION:"Check your Etsy connection before resuming synchronization.",TEMPORARY_FAILURE:"Etsy catalog data is temporarily unavailable. Saved data is retained.",INVALID_RESPONSE:"Some Etsy catalog data could not be verified. Saved data is retained.",CONNECTION_CHANGED:"The Etsy connection changed. Start synchronization for the current connection."};
export function currentCoverage(catalog:SetupCatalog|null,sourceUpdatedAt:number,choicesSourceUpdatedAt:number|null,error:string|null){
 if(!catalog||choicesSourceUpdatedAt!==sourceUpdatedAt||error)return {state:"UNKNOWN" as const,total:null,reason:error?"REFRESH_FAILED":"INVENTORY_NOT_VERIFIED"};
 if(catalog.state!=="READY"||!catalog.configurations.length)return {state:"PARTIAL" as const,total:null,reason:catalog.reasons[0]??"INVENTORY_UNSUPPORTED"};
 return {state:"VERIFIED" as const,total:catalog.configurations.length,reason:null};
}
/** Constant-count page-scoped queries. No line-item/history reads or Etsy HTTP. */
export async function readCatalog(db:DbExecutor,scope:Scope,raw:unknown={}){
 await verifyScope(db,scope);const query=catalogQuery.parse(raw);
 const clauses=[tenantWhere(listings,scope)];
 if(query.listingId)clauses.push(eq(listings.externalId,query.listingId));
 if(query.search)clauses.push(ilike(listings.title,"%"+query.search.replace(/[\\%_]/g,"\\$&")+"%"));
 if(query.state!=="all")clauses.push(eq(listings.state,query.state));
 if(query.section!=="all")clauses.push(query.section==="unknown"?or(eq(listingCatalog.sectionState,"UNKNOWN"),sql`${listingCatalog.sectionState} is null`):query.section==="uncategorized"?eq(listingCatalog.sectionState,"UNCATEGORIZED"):query.section==="missing"?eq(listingCatalog.sectionState,"MISSING"):and(eq(listingCatalog.sectionId,query.section),eq(listingCatalog.sectionState,"KNOWN")));
 const join=and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId));
 const where=and(...clauses),order=query.sort==="title_desc"?desc(listings.title):query.sort==="updated_desc"?desc(listings.sourceUpdatedAt):asc(listings.title);
 const [rows,totalRows,syncRows,sections]=await Promise.all([
  db.select({listing:listings,metadata:listingCatalog}).from(listings).leftJoin(listingCatalog,join).where(where).orderBy(order,asc(listings.externalId)).limit(query.pageSize).offset((query.page-1)*query.pageSize),
  db.select({total:count()}).from(listings).leftJoin(listingCatalog,join).where(where),
  db.select().from(catalogSync).where(tenantWhere(catalogSync,scope)),
  db.select({id:catalogSections.externalId,title:catalogSections.title,rank:catalogSections.rank,activeListingCount:catalogSections.activeListingCount,present:catalogSections.present,verifiedAt:catalogSections.verifiedAt}).from(catalogSections).where(tenantWhere(catalogSections,scope)).orderBy(catalogSections.rank,catalogSections.externalId).limit(1000),
 ]);
 const ids=rows.map(r=>r.listing.externalId);
 const bindings=ids.length?await db.select().from(mappings).where(and(tenantWhere(mappings,scope),inArray(mappings.listingExternalId,ids))).orderBy(mappings.listingExternalId,mappings.variantKey).limit(batchLimit+1):[];
 const truncated=bindings.length>batchLimit,productIds=[...new Set(bindings.slice(0,batchLimit).flatMap(m=>m.productId?[m.productId]:[]))];
 const [productRows,versionRows,assignments,designs]=await Promise.all([
  productIds.length?db.select().from(products).where(and(tenantWhere(products,scope),inArray(products.id,productIds))):[],
  productIds.length?db.select().from(productVersions).where(and(tenantWhere(productVersions,scope),inArray(productVersions.productId,productIds),inArray(productVersions.status,["ACTIVE","DRAFT"]))):[],
  productIds.length?db.select().from(productDocumentDesigns).where(and(tenantWhere(productDocumentDesigns,scope),inArray(productDocumentDesigns.productId,productIds))):[],
  db.select().from(documentDesigns).where(and(tenantWhere(documentDesigns,scope),or(eq(documentDesigns.isDefault,true),sql`${documentDesigns.id} in (select design_id from product_document_designs where organization_id=${scope.organizationId} and store_id=${scope.storeId} ${productIds.length?sql`and product_id in (${sql.join(productIds.map(p=>sql`${p}`),sql`,`)})`:sql`and false`})`))).limit(batchLimit+1),
 ]);
 const sync=syncRows[0],storeDefault=designs.find(d=>d.isDefault),productMap=new Map(productRows.map(p=>[p.id,p])),versionMap=new Map(versionRows.map(v=>[v.id,v]));
 const items=rows.map(({listing:l,metadata:m})=>{
  let catalog:SetupCatalog|null=null;try{if(m?.setupCatalog)catalog=validateCatalogEvidence(m.setupCatalog);}catch{}
  const coverage=currentCoverage(catalog,l.sourceUpdatedAt,m?.choicesSourceUpdatedAt??null,m?.choicesError??null);
  const bounded=truncated?{state:"UNKNOWN" as const,total:null,reason:"CONFIGURATION_SUMMARY_LIMIT"}:coverage;
  const listingBindings=bindings.filter(b=>b.listingExternalId===l.externalId),bindingMap=new Map(listingBindings.map(b=>[b.variantKey,b]));
  const choices=(catalog?.configurations??[]).slice(0,100).map(choice=>{
   const binding=bindingMap.get(choice.key),product=binding?.productId?productMap.get(binding.productId):undefined,active=product?.activeVersionId?versionMap.get(product.activeVersionId):undefined;
   const parsed=configurationSchema.safeParse(active?.configuration),policy=parsed.success?parsed.data.etsyFulfillment:undefined;
   const configured=!!(product&&active?.status==="ACTIVE"&&active.productId===product.id&&parsed.success&&!activationErrors(parsed.data.productMetadata?.title??product.name,parsed.data).length&&policy?.listingId===l.externalId&&selectionKey(policy.purchaseSelections)===choice.key);
   const draft=product&&versionRows.some(v=>v.productId===product.id&&v.status==="DRAFT"&&v.configuration.etsyFulfillment?.listingId===l.externalId&&selectionKey(v.configuration.etsyFulfillment.purchaseSelections)===choice.key);
   return {key:choice.key,label:choice.displaySelections.flatMap(p=>p.values.map(v=>v.label)).join(" / ")||"Standard purchase",state:configured?"CONFIGURED" as const:draft?"DRAFT" as const:"UNCONFIGURED" as const,productId:product?.id??null,paused:binding?.paused??false,reason:configured?null:!binding?"MISSING_MAPPING":draft?"DRAFT_ONLY":"NO_EXACT_PUBLISHED_CONFIGURATION",setupHref:product?`/products/${product.id}/setup`:`/onboarding/products/setup?listing=${l.externalId}`};
  });
  const pdfProducts=[...new Set(choices.flatMap(c=>c.productId?[c.productId]:[]))];
  const pdf=pdfProducts.map(productId=>{
   const assignment=assignments.find(a=>a.productId===productId),design=assignment?designs.find(d=>d.id===assignment.designId):storeDefault;
   const valid=design?.status==="ACTIVE"&&documentDesignSchema.safeParse(design.configuration).success;
   return {productId,state:valid?"RESOLVED" as const:design||assignment?"INVALID" as const:"NOT_ASSIGNED" as const,designId:valid?design.id:null,name:valid?design.name:null,source:assignment?"PRODUCT" as const:"STORE_DEFAULT" as const};
  });
  const designIds=new Set(pdf.filter(p=>p.state==="RESOLVED").map(p=>p.designId)),pdfUnknown=bounded.state!=="VERIFIED"||choices.some(c=>!c.productId),pdfState=pdfUnknown?"UNKNOWN":pdf.some(p=>p.state!=="RESOLVED")?"UNAVAILABLE":designIds.size>1?"MULTIPLE":"RESOLVED";
  return {id:l.id,listingId:l.externalId,title:l.title,state:l.state,sourceUpdatedAt:l.sourceUpdatedAt,thumbnail:m?.thumbnailUrl??null,etsyUrl:m?.listingUrl??null,sourceCreatedAt:m?.sourceCreatedAt??null,
   section:{id:m?.sectionId??null,title:sections.find(s=>s.id===m?.sectionId)?.title??null,state:m?.sectionState??"UNKNOWN",verifiedAt:m?.sectionVerifiedAt??null},
   configuration:{...bounded,configured:bounded.state==="VERIFIED"?choices.filter(c=>c.state==="CONFIGURED").length:null,choices,missingChoices:choices.filter(c=>c.state!=="CONFIGURED"),verifiedAt:m?.choicesVerifiedAt??null,lastAttemptAt:m?.choicesAttemptedAt??null},
   pdfAppearance:{state:pdfState,products:pdf,multipleDesigns:designIds.size>1,usesStoreDefault:pdf.some(p=>p.state==="RESOLVED"&&p.source==="STORE_DEFAULT")},
   freshness:{verifiedAt:m?.verifiedAt??null,present:m?.present??null}};
 });
 return {contractVersion:"etsy-catalog/v1" as const,items,sections,pagination:{page:query.page,pageSize:query.pageSize,total:totalRows[0].total,sort:query.sort},filters:{search:query.search,state:query.state,section:query.section},status:{state:sync?.status??"NOT_SYNCED",lastAttemptAt:sync?.lastAttemptAt??null,lastSuccessAt:sync?.lastSuccessAt??null,sectionsVerifiedAt:sync?.sectionsVerifiedAt??null,hasMore:!!sync?.cursor,processed:sync?.processed??0,failures:sync?.failures??0,issues:sync?.issues??[],issueDescriptions:(sync?.issues??[]).map(code=>({code,message:issueMessages[code]??"Catalog synchronization is incomplete. Saved data is retained."}))}};
}
export async function savedSetupCatalog(db:DbExecutor,scope:Scope,listingId:string):Promise<SetupCatalog|undefined>{
 await verifyScope(db,scope);const [row]=await db.select({metadata:listingCatalog,sourceUpdatedAt:listings.sourceUpdatedAt}).from(listingCatalog).innerJoin(listings,and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId))).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,listingId)));
 if(!row||row.metadata.choicesError||row.metadata.choicesSourceUpdatedAt!==row.sourceUpdatedAt)return undefined;try{return row.metadata.setupCatalog?validateCatalogEvidence(row.metadata.setupCatalog):undefined;}catch{return undefined;}
}
