import {savedChoiceEvidence} from "./readiness-evidence";
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
import {resolveDocumentDesignForProductInTransaction} from "../documents/service";
import {assessProductReadiness,type ReadinessSnapshot} from "./readiness";
/** Constant query count, bounded cached evidence, consistent authorized snapshot; zero mutation. */
export async function readProductConfigurationAssessment(db:Database,scope:Scope,productId:string){return db.transaction(async tx=>{
 const data=await productWorkspaceData(tx,scope,productId);
 const [store]=await tx.select({shopId:stores.externalShopId,source:stores.source}).from(stores).where(and(eq(stores.id,scope.storeId),eq(stores.organizationId,scope.organizationId)));
 const policies=[data.active,data.draft].flatMap(v=>{const p=configurationSchema.safeParse(v?.configuration);return p.success&&p.data.etsyFulfillment?[p.data.etsyFulfillment]:[];});
 const ids=[...new Set([...data.bindings.map(b=>b.listingExternalId),...policies.map(p=>p.listingId)])];
 const rows=ids.length?await tx.select({listing:listings,metadata:listingCatalog}).from(listings).leftJoin(listingCatalog,and(eq(listings.organizationId,listingCatalog.organizationId),eq(listings.storeId,listingCatalog.storeId),eq(listings.externalId,listingCatalog.listingExternalId))).where(and(tenantWhere(listings,scope),inArray(listings.externalId,ids))).limit(102):[];
 const expected=[...data.bindings.map(b=>({listingId:b.listingExternalId,key:b.variantKey,label:b.label,paused:b.paused,mapped:true})),...policies.filter(p=>!data.bindings.some(b=>b.listingExternalId===p.listingId&&b.variantKey===selectionKey(p.purchaseSelections))).map(p=>({listingId:p.listingId,key:selectionKey(p.purchaseSelections),label:"Policy choice · no association",paused:false,mapped:false}))];
 const choices=savedChoiceEvidence(rows,expected,store.shopId,store.source==="etsy");
 let pdf:ReadinessSnapshot["pdf"]={status:"UNKNOWN"};
 if([data.active,data.draft].some(v=>configurationSchema.safeParse(v?.configuration).data?.output==="PDF"))try{const result=await resolveDocumentDesignForProductInTransaction(tx,scope,productId);pdf=result.status==="RESOLVED"?{status:"RESOLVED",name:result.design.name,source:result.design.source}:{status:"MISSING"};}catch(error){if(error instanceof ZodError||error instanceof AccessDenied||error instanceof Error&&error.message==="DOCUMENT_DESIGN_UNAVAILABLE")pdf={status:"INVALID"};else throw error;}
 return {workspace:data,assessment:assessProductReadiness({productId,storeId:scope.storeId,name:data.product.name,active:data.active??null,draft:data.draft??null,bindings:data.bindings,choices,limited:data.associationsLimited,pdf})};
 },{isolationLevel:"repeatable read"});}

export async function readProductReadiness(db:Database,scope:Scope,productId:string){return (await readProductConfigurationAssessment(db,scope,productId)).assessment;}
