import {and,eq,inArray} from "drizzle-orm";
import {ZodError} from "zod";
import type {Database} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {stores,listings,listingCatalog} from "../../db/schema";
import {tenantWhere} from "../intake/service";
import {AccessDenied} from "../identity/service";
import {productWorkspaceData} from "./workspace";
import {configurationSchema} from "./contracts";
import {selectionKey} from "../etsy/source-contract";
import {validateCatalogEvidence} from "../catalog/evidence";
import {currentCoverage} from "../catalog/read";
import {resolveDocumentDesignForProductInTransaction} from "../documents/service";
import {assessProductReadiness,type ChoiceEvidence,type ReadinessSnapshot} from "./readiness";
/** Constant query count, bounded cached evidence, consistent authorized snapshot; zero mutation. */
export async function readProductConfigurationAssessment(db:Database,scope:Scope,productId:string){return db.transaction(async tx=>{
 const data=await productWorkspaceData(tx,scope,productId);
 const [store]=await tx.select({shopId:stores.externalShopId,source:stores.source}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const policies=[data.active,data.draft].flatMap(v=>{const p=configurationSchema.safeParse(v?.configuration);return p.success&&p.data.etsyFulfillment?[p.data.etsyFulfillment]:[];});
 const ids=[...new Set([...data.bindings.map(b=>b.listingExternalId),...policies.map(p=>p.listingId)])];
 const rows=ids.length?await tx.select({listing:listings,metadata:listingCatalog}).from(listings).leftJoin(listingCatalog,and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId))).where(and(tenantWhere(listings,scope),inArray(listings.externalId,ids))).limit(102):[];
 const expected=[...data.bindings.map(b=>({listingId:b.listingExternalId,key:b.variantKey,label:b.label,paused:b.paused,mapped:true})),...policies.filter(p=>!data.bindings.some(b=>b.listingExternalId===p.listingId&&b.variantKey===selectionKey(p.purchaseSelections))).map(p=>({listingId:p.listingId,key:selectionKey(p.purchaseSelections),label:"Policy choice · no association",paused:false,mapped:false}))];
 const observations=new Map(rows.map(row=>{let catalog;try{catalog=row.metadata?.setupCatalog?validateCatalogEvidence(row.metadata.setupCatalog):undefined;}catch{/* malformed evidence remains UNKNOWN */}
  const coverage=currentCoverage(catalog??null,row.listing.sourceUpdatedAt,row.metadata?.choicesSourceUpdatedAt??null,row.metadata?.choicesError??null);
  const owned=store.source!=="etsy"||!!store.shopId&&row.metadata?.shopId===store.shopId;
  return [row.listing.externalId,{row,catalog,current:owned&&coverage.state==="VERIFIED"&&catalog?.listing.id===row.listing.externalId}] as const;
 }));
 const choices:ChoiceEvidence[]=[...new Map(expected.map(e=>[e.listingId+":"+e.key,e])).values()].map(e=>{
  const evidence=observations.get(e.listingId),row=evidence?.row,catalog=evidence?.catalog,current=evidence?.current;
  const observed=current?catalog?.configurations.find(c=>c.key===e.key):undefined;
  const state=!e.mapped||row&&row.listing.state!=="active"||current&&!observed?"ACTION_REQUIRED":!row||!current||!e.key.startsWith("etsy-selection/1:")?"UNKNOWN":"PASS";
  return {listingId:e.listingId,key:e.key,label:observed?.displaySelections.flatMap(d=>d.values.map(v=>v.label)).join(" · ")||e.label,paused:e.paused,mapped:e.mapped,state,explanation:!e.mapped?"No owned exact association exists for this version’s policy.":row&&row.listing.state!=="active"?"The saved listing is not active under existing publication rules.":current&&!observed?"The saved association is not present in verified current inventory.":state==="UNKNOWN"?"Inventory is unknown, stale, unsupported or belongs to a previous shop. Historical mappings are retained.":e.paused?"Exact choice verified against the saved revision. Mapping is paused; configuration validity does not remove this hold.":"Exact choice verified against the saved listing revision.",verifiedAt:row?.metadata?.choicesVerifiedAt?.toISOString()??null,catalog:current?catalog:undefined};
 });
 let pdf:ReadinessSnapshot["pdf"]={status:"UNKNOWN"};
 if([data.active,data.draft].some(v=>configurationSchema.safeParse(v?.configuration).data?.output==="PDF"))try{const result=await resolveDocumentDesignForProductInTransaction(tx,scope,productId);pdf=result.status==="RESOLVED"?{status:"RESOLVED",name:result.design.name,source:result.design.source}:{status:"MISSING"};}catch(error){if(error instanceof ZodError||error instanceof AccessDenied||error instanceof Error&&error.message==="DOCUMENT_DESIGN_UNAVAILABLE")pdf={status:"INVALID"};else throw error;}
 return {workspace:data,assessment:assessProductReadiness({productId,storeId:scope.storeId,name:data.product.name,active:data.active??null,draft:data.draft??null,bindings:data.bindings,choices,limited:data.associationsLimited,pdf})};
 },{isolationLevel:"repeatable read"});}

export async function readProductReadiness(db:Database,scope:Scope,productId:string){return (await readProductConfigurationAssessment(db,scope,productId)).assessment;}
