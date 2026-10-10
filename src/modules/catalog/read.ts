import {assessProductReadiness,type ProductReadiness,type ReadinessSnapshot} from "../products/readiness";
import {savedChoiceObserver} from "../products/readiness-evidence";
import {setupProgress,type SetupProgress} from "./setup-progress";
import {choiceSetupHref,configurationHref} from "../products/workspace-navigation";
import {and,asc,desc,eq,ilike,inArray,or,sql,count} from "drizzle-orm";
import type {DbExecutor} from "../../db/client";
import {listings,listingCatalog,catalogSections,catalogSync,mappings,products,productVersions,productDocumentDesigns,documentDesigns,stores} from "../../db/schema";
import {verifyScope,tenantWhere} from "../intake/service";
import type {Scope} from "../intake/contracts";
import {configurationSchema,activationErrors} from "../products/contracts";
import {documentDesignSchema,immutableResolvedDesign,configurationHash} from "../documents/contracts";
import {selectionKey} from "../etsy/source-contract";
import {validateCatalogEvidence} from "./evidence";
import {safeListingUrl} from "./transport";
import {safeListingThumbnail} from "../etsy/listing-thumbnail";
import {coverageFilter} from "./coverage-filter";
import type {SetupCatalog} from "../etsy/setup-catalog";
import {catalogQuery} from "./query";
export {catalogQuery} from "./query";
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
 if(query.setup!=="all")clauses.push(coverageFilter(query.setup));
 const join=and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId));
 const where=and(...clauses),order=query.sort==="title_desc"?desc(listings.title):query.sort==="updated_desc"?desc(listings.sourceUpdatedAt):asc(listings.title);
 const [rows,totalRows,syncRows,sections,sectionCounts]=await Promise.all([
  db.select({listing:listings,metadata:listingCatalog}).from(listings).leftJoin(listingCatalog,join).where(where).orderBy(order,asc(listings.externalId)).limit(query.pageSize).offset((query.page-1)*query.pageSize),
  db.select({total:count()}).from(listings).leftJoin(listingCatalog,join).where(where),
  db.select().from(catalogSync).where(tenantWhere(catalogSync,scope)),
  db.select({id:catalogSections.externalId,title:catalogSections.title,rank:catalogSections.rank,activeListingCount:catalogSections.activeListingCount,present:catalogSections.present,verifiedAt:catalogSections.verifiedAt}).from(catalogSections).where(tenantWhere(catalogSections,scope)).orderBy(catalogSections.rank,catalogSections.externalId).limit(1000),
  db.select({state:listingCatalog.sectionState,sectionId:listingCatalog.sectionId,total:count()}).from(listings).leftJoin(listingCatalog,join).where(tenantWhere(listings,scope)).groupBy(listingCatalog.sectionState,listingCatalog.sectionId),
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
 const pdfByProduct=new Map(productIds.map(productId=>{
   const assignment=assignments.find(a=>a.productId===productId),design=assignment?designs.find(d=>d.id===assignment.designId):storeDefault;
   const valid=design?.status==="ACTIVE"&&documentDesignSchema.safeParse(design.configuration).success;
   const summary={productId,state:valid?"RESOLVED" as const:design||assignment?"INVALID" as const:"NOT_ASSIGNED" as const,designId:valid?design.id:null,name:valid?design.name:null,source:assignment?"PRODUCT" as const:"STORE_DEFAULT" as const};return [productId,summary] as const;
  }));
 // Assess only bounded Products on the current page, using all their saved mappings.
 const assessedIds=productIds.slice(0,100);
 const globalBindings=assessedIds.length?await db.select().from(mappings).where(and(tenantWhere(mappings,scope),inArray(mappings.productId,assessedIds))).orderBy(mappings.productId,mappings.listingExternalId,mappings.variantKey).limit(1001):[];
 const assessmentLimited=globalBindings.length>1000;
 const boundedBindings=globalBindings.slice(0,1000);
 const policies=versionRows.filter(v=>assessedIds.includes(v.productId)).flatMap(v=>{const p=configurationSchema.safeParse(v.configuration);return p.success&&p.data.etsyFulfillment?[p.data.etsyFulfillment]:[];});
 const evidenceIds=[...new Set([...boundedBindings.map(b=>b.listingExternalId),...policies.map(p=>p.listingId)])];
 const [evidenceRows,storeRows]=await Promise.all([
 evidenceIds.length?db.select({listing:listings,metadata:listingCatalog}).from(listings).leftJoin(listingCatalog,join).where(and(tenantWhere(listings,scope),inArray(listings.externalId,evidenceIds))).limit(1200):[],
 db.select({shopId:stores.externalShopId,source:stores.source}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)))
 ]);
 const observe=savedChoiceObserver(evidenceRows,storeRows[0]?.shopId??null,storeRows[0]?.source==="etsy");
 const assessments=new Map<string,ProductReadiness>();
 for(const id of assessedIds){const product=productMap.get(id);if(!product)continue;
 const active=versionRows.find(v=>v.id===product.activeVersionId&&v.productId===id&&v.status==="ACTIVE")??null;
 const draft=versionRows.find(v=>v.productId===id&&v.status==="DRAFT")??null;
 const ownedBindings=boundedBindings.filter(b=>b.productId===id),productPolicies=[active,draft].flatMap(v=>{const p=configurationSchema.safeParse(v?.configuration);return p.success&&p.data.etsyFulfillment?[p.data.etsyFulfillment]:[];});
 const expected=[...ownedBindings.map(b=>({listingId:b.listingExternalId,key:b.variantKey,label:b.label,paused:b.paused,mapped:true})),...productPolicies.filter(p=>!ownedBindings.some(b=>b.listingExternalId===p.listingId&&b.variantKey===selectionKey(p.purchaseSelections))).map(p=>({listingId:p.listingId,key:selectionKey(p.purchaseSelections),label:"Policy choice · no association",paused:false,mapped:false}))];
 const resolved=pdfByProduct.get(id);
 let pdf:ReadinessSnapshot["pdf"]=resolved?.state==="INVALID"?{status:"INVALID"}:{status:"MISSING"};
 if(resolved?.state==="RESOLVED"){const design=designs.find(d=>d.id===resolved.designId)!;try{const configuration=documentDesignSchema.parse(design.configuration);const evidence=immutableResolvedDesign({contractVersion:"resolved-document-design/v1",organizationId:scope.organizationId,storeId:scope.storeId,productId:id,designId:design.id,revision:design.revision,name:design.name,source:resolved.source,templateVersion:1,configuration,configurationHash:configurationHash(configuration)});pdf={status:"RESOLVED",name:evidence.name,source:evidence.source};}catch{pdf={status:"INVALID"};}}

 assessments.set(id,assessProductReadiness({productId:id,storeId:scope.storeId,name:product.name,active,draft,bindings:ownedBindings,choices:observe(expected),limited:assessmentLimited||ownedBindings.length>100||evidenceIds.length>1200,pdf}));
 }
 const items=rows.map(({listing:l,metadata:m})=>{
  let catalog:SetupCatalog|null=null;try{if(m?.setupCatalog)catalog=validateCatalogEvidence(m.setupCatalog);if(catalog&&catalog.listing.id!==l.externalId)catalog=null;}catch{}
  const coverage=currentCoverage(catalog,l.sourceUpdatedAt,m?.choicesSourceUpdatedAt??null,m?.choicesError??null);
  const bounded=truncated?{state:"UNKNOWN" as const,total:null,reason:"CONFIGURATION_SUMMARY_LIMIT"}:coverage;
  const listingBindings=bindings.filter(b=>b.listingExternalId===l.externalId),bindingMap=new Map(listingBindings.map(b=>[b.variantKey,b]));
  const choices=(catalog?.configurations??[]).slice(0,100).map(choice=>{
   const binding=bindingMap.get(choice.key),product=binding?.productId?productMap.get(binding.productId):undefined,active=product?.activeVersionId?versionMap.get(product.activeVersionId):undefined;
   const parsed=configurationSchema.safeParse(active?.configuration),policy=parsed.success?parsed.data.etsyFulfillment:undefined;
   const configured=!!(product&&active?.status==="ACTIVE"&&active.productId===product.id&&parsed.success&&!activationErrors(parsed.data.productMetadata?.title??product.name,parsed.data).length&&policy?.listingId===l.externalId&&selectionKey(policy.purchaseSelections)===choice.key);
   const draft=product&&versionRows.some(v=>v.productId===product.id&&v.status==="DRAFT"&&v.configuration.etsyFulfillment?.listingId===l.externalId&&selectionKey(v.configuration.etsyFulfillment.purchaseSelections)===choice.key);
   return {purchaseSelections:choice.purchaseSelections,displaySelections:choice.displaySelections,productName:product?.name??null,association:!binding?"MISSING_MAPPING" as const:!binding.productId?"NOT_CONNECTED" as const:!product?"INVALID" as const:"OWNED" as const,hasPublished:!!active,hasDraft:!!draft,key:choice.key,label:choice.displaySelections.flatMap(p=>p.values.map(v=>v.label)).join(" / ")||"Standard purchase",state:configured?"CONFIGURED" as const:draft?"DRAFT" as const:"UNCONFIGURED" as const,productId:product?.id??null,paused:binding?.paused??false,reason:configured?null:!binding?"MISSING_MAPPING":draft?"DRAFT_ONLY":"NO_EXACT_PUBLISHED_CONFIGURATION",setupHref:product?configurationHref(product.id,{listingId:l.externalId,choice:choice.key,tab:"setup"}):choiceSetupHref(l.externalId,choice.key)};
  });
  const completion:{setupProgress?:SetupProgress}={setupProgress:setupProgress(l.externalId,bounded.state==="VERIFIED"&&(storeRows[0]?.source!=="etsy"||!!storeRows[0]?.shopId&&m?.shopId===storeRows[0].shopId),bounded.total,choices,assessments,truncated||catalog!==null&&catalog.configurations.length>100)};
  const pdfProducts=[...new Set(choices.flatMap(c=>c.productId?[c.productId]:[]))];
  const pdf=pdfProducts.flatMap(id=>pdfByProduct.has(id)?[pdfByProduct.get(id)!]:[]);
  const designIds=new Set(pdf.filter(p=>p.state==="RESOLVED").map(p=>p.designId)),pdfUnknown=bounded.state!=="VERIFIED"||choices.some(c=>!c.productId),pdfState=pdfUnknown?"UNKNOWN":pdf.some(p=>p.state!=="RESOLVED")?"UNAVAILABLE":designIds.size>1?"MULTIPLE":"RESOLVED";
  return {...completion,id:l.id,listingId:l.externalId,title:l.title,state:l.state,sourceUpdatedAt:l.sourceUpdatedAt,thumbnail:safeListingThumbnail(m?.thumbnailUrl),etsyUrl:safeListingUrl(m?.listingUrl,l.externalId),sourceCreatedAt:m?.sourceCreatedAt??null,
   section:{id:m?.sectionId??null,title:sections.find(s=>s.id===m?.sectionId)?.title??null,state:m?.sectionState??"UNKNOWN",verifiedAt:m?.sectionVerifiedAt??null},
   configuration:{...bounded,configured:bounded.state==="VERIFIED"?choices.filter(c=>c.state==="CONFIGURED").length:null,choices,missingChoices:choices.filter(c=>c.state!=="CONFIGURED"),verifiedAt:m?.choicesVerifiedAt??null,lastAttemptAt:m?.choicesAttemptedAt??null},
   pdfAppearance:{state:pdfState,products:pdf,multipleDesigns:designIds.size>1,usesStoreDefault:pdf.some(p=>p.state==="RESOLVED"&&p.source==="STORE_DEFAULT")},
   operations:listingBindings.slice(0,batchLimit).map(binding=>{const product=binding.productId?productMap.get(binding.productId):undefined;return {key:binding.variantKey,label:choices.find(c=>c.key===binding.variantKey)?.label??binding.label,productId:product?.id??null,name:product?.name??null,paused:binding.paused,hasPublished:!!product?.activeVersionId,hasDraft:versionRows.some(v=>v.productId===product?.id&&v.status==="DRAFT")};}),
   operationsLimited:truncated,
   freshness:{verifiedAt:m?.verifiedAt??null,present:m?.present??null}};
 });
 return {contractVersion:"etsy-catalog/v1" as const,items,sections:sections.map(section=>({...section,catalogCount:sectionCounts.filter(c=>c.state==="KNOWN"&&c.sectionId===section.id).reduce((n,c)=>n+c.total,0)})),sectionCounts:{all:sectionCounts.reduce((n,c)=>n+c.total,0),uncategorized:sectionCounts.filter(c=>c.state==="UNCATEGORIZED").reduce((n,c)=>n+c.total,0),unknown:sectionCounts.filter(c=>!c.state||c.state==="UNKNOWN").reduce((n,c)=>n+c.total,0),missing:sectionCounts.filter(c=>c.state==="MISSING").reduce((n,c)=>n+c.total,0)},pagination:{page:query.page,pageSize:query.pageSize,total:totalRows[0].total,sort:query.sort},filters:{search:query.search,state:query.state,section:query.section,setup:query.setup},status:{state:sync?.status??"NOT_SYNCED",isRunning:sync?.status==="IN_PROGRESS"&&!!sync.claimUntil&&sync.claimUntil.getTime()>Date.now(),lastAttemptAt:sync?.lastAttemptAt??null,lastSuccessAt:sync?.lastSuccessAt??null,sectionsVerifiedAt:sync?.sectionsVerifiedAt??null,hasMore:!!sync?.cursor,processed:sync?.processed??0,failures:sync?.failures??0,issues:sync?.issues??[],issueDescriptions:(sync?.issues??[]).map(code=>({code,message:issueMessages[code]??"Catalog synchronization is incomplete. Saved data is retained."}))}};
}
export async function savedSetupCatalog(db:DbExecutor,scope:Scope,listingId:string):Promise<SetupCatalog|undefined>{
 await verifyScope(db,scope);const [row]=await db.select({metadata:listingCatalog,sourceUpdatedAt:listings.sourceUpdatedAt}).from(listingCatalog).innerJoin(listings,and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId))).where(and(tenantWhere(listingCatalog,scope),eq(listingCatalog.listingExternalId,listingId)));
 if(!row||row.metadata.choicesError||row.metadata.choicesSourceUpdatedAt!==row.sourceUpdatedAt)return undefined;try{return row.metadata.setupCatalog?validateCatalogEvidence(row.metadata.setupCatalog):undefined;}catch{return undefined;}
}

export type CatalogData=Awaited<ReturnType<typeof readCatalog>>;
