import {readProductConfigurationAssessment} from "@/modules/products/readiness-service";
import {selectionKey} from "@/modules/etsy/source-contract";
import {database} from "@/db/client";
import type {Scope} from "@/modules/intake/contracts";
import {authorizeStore,AccessDenied} from "@/modules/identity/service";
import {readListingDetail} from "@/modules/catalog/detail";
import {savedSetupCatalog} from "@/modules/catalog/read";
import {productsReturnHref,type ProductsParams} from "@/modules/catalog/query";
import {configurationHref,productTab} from "@/modules/products/workspace-navigation";
import {resolveDocumentDesignForProduct,listDocumentDesigns} from "@/modules/documents/service";
import {configurationSchema,emptyConfiguration} from "@/modules/products/contracts";
import {ProductWorkspace} from "./configuration-workspace";
import {ProductPdfAppearance} from "./configuration-pdf";
export async function ProductConfiguration({scope,productId,query={}}:{scope:Scope;productId:string;query?:ProductsParams}){
 const db=database(),{workspace:data,assessment:readiness}=await readProductConfigurationAssessment(db,scope,productId);
 let canEdit=true;try{await authorizeStore(db,scope.userId,scope.storeId,true);}catch(error){if(error instanceof AccessDenied)canEdit=false;else throw error;}
 const policy=configurationSchema.safeParse(data.draft?.configuration).data?.etsyFulfillment??configurationSchema.safeParse(data.active?.configuration).data?.etsyFulfillment;
 const requested=data.bindings.find(b=>b.listingExternalId===query.listing&&b.variantKey===query.choice);
 const binding=requested??data.bindings.find(b=>b.listingExternalId===policy?.listingId&&b.variantKey===selectionKey(policy.purchaseSelections))??data.bindings[0];
 const listingId=binding?.listingExternalId,returnTo=productsReturnHref(query.returnTo);
 const listing=listingId?await readListingDetail(db,scope,listingId):null;
 const catalog=policy?await savedSetupCatalog(db,scope,policy.listingId):undefined;
 let pdf:Awaited<ReturnType<typeof resolveDocumentDesignForProduct>>|{status:"INVALID"}={status:"SETUP_REQUIRED"};
 try{pdf=await resolveDocumentDesignForProduct(db,scope,productId);}catch(error){if(error instanceof AccessDenied||error instanceof Error&&error.message==="DOCUMENT_DESIGN_UNAVAILABLE")pdf={status:"INVALID"};else throw error;}
 let designs:Awaited<ReturnType<typeof listDocumentDesigns>>=[];
 if(canEdit)try{designs=(await listDocumentDesigns(db,scope)).filter(d=>d.status==="ACTIVE");}catch{pdf={status:"INVALID"};}
 const parsed=configurationSchema.safeParse((data.draft??data.active)?.configuration);
 const choice=listing?.item.configuration.state==="VERIFIED"&&!listing.item.operationsLimited?listing.item.configuration.choices.find(c=>c.key===binding?.variantKey&&c.productId===productId):undefined;
 const context={listingId,choice:binding?.variantKey,returnTo};
 return <ProductWorkspace readiness={readiness} productId={productId} name={data.product.name} initial={parsed.success?parsed.data:emptyConfiguration} draft={data.draft?{id:data.draft.id,revision:data.draft.revision,versionNumber:data.draft.versionNumber}:null} active={data.active?{versionNumber:data.active.versionNumber,activatedAt:data.active.activatedAt}:null} catalog={catalog} canEdit={canEdit&&parsed.success} initialTab={productTab(query.tab)} baseHref={configurationHref(productId,context)} returnHref={returnTo} listingHref={listingId?`/products/${listingId}?returnTo=${encodeURIComponent(returnTo)}`:null} listingTitle={listing?.item.title??"Listing information unavailable"} choice={choice} bindingKey={binding?.variantKey} associations={data.bindings.length} associationsLimited={data.associationsLimited} pdfLabel={pdf.status==="RESOLVED"?pdf.design.name:pdf.status==="INVALID"?"Needs attention":"Not assigned"} pdfContent={<ProductPdfAppearance productId={productId} resolution={pdf} designs={designs} canEdit={canEdit} returnHref={configurationHref(productId,{...context,tab:"pdf"})} saved={query.saved==="1"} error={typeof query.error==="string"}/>}/>;
}
