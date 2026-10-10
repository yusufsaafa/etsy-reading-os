import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import {readFileSync,readdirSync} from "node:fs";
import {eq} from "drizzle-orm";
import type {Database} from "../src/db/client";
import * as s from "../src/db/schema";
import {authorizeStore,createWorkspace} from "../src/modules/identity/service";
import type {Scope} from "../src/modules/intake/contracts";
import {syncCatalog} from "../src/modules/catalog/sync";
import {readListingDetail} from "../src/modules/catalog/detail";
import {readCatalog,savedSetupCatalog} from "../src/modules/catalog/read";
import {ingestOrder} from "../src/modules/intake/service";
import {fixtureOrders} from "../src/modules/etsy/fixtures";
import {CatalogError,type CatalogReader,type CatalogListing,type CatalogSection} from "../src/modules/catalog/transport";
import {deriveSetupCatalog} from "../src/modules/etsy/setup-catalog";
import {setupListing,setupInventory,setupQuestions} from "./fixtures/etsy-setup";
import {beginEtsyProductDraft,activateProduct,editProduct,catalogPageData} from "../src/modules/products/service";
import {createDocumentDesign,setDefaultDocumentDesign,assignDocumentDesignToProduct} from "../src/modules/documents/service";
import {studioPreset} from "../src/modules/documents/studio-templates";
let pg:PGlite,db:Database,a:Scope,b:Scope,rows:CatalogListing[],sections:CatalogSection[];
const baseCatalog=deriveSetupCatalog(setupListing,setupInventory,setupQuestions,{shopId:"123",listingId:"101"});
const listing=(id="101",patch:Partial<CatalogListing>={}):CatalogListing=>({listing_id:id,shop_id:"123",title:"Fictional Reading "+id,state:"active",updated_timestamp:100,creation_timestamp:50,shop_section_id:"7",url:`https://www.etsy.com/listing/${id}/fictional`,images:[{rank:1,url_75x75:"https://i.etsystatic.com/test.jpg"}],...patch});
const reader=():CatalogReader=>({shopId:"123",epoch:0,sections:vi.fn(async()=>sections),listings:vi.fn(async(state,offset)=>{const match=rows.filter(r=>r.state===state);return {count:match.length,results:match.slice(offset,offset+100)};}),choices:vi.fn(async(id)=>({...baseCatalog,listing:{...baseCatalog.listing,id,state:rows.find(r=>r.listing_id===id)!.state,updatedAt:100}}))});
const sync=(r=reader(),options:unknown={pages:5,choices:20})=>syncCatalog(db,a,options,async()=>r);
beforeEach(async()=>{
 pg=new PGlite();for(const f of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+f,"utf8"));db=drizzle(pg,{schema:s}) as unknown as Database;
 for(const id of ["a","b","member"])await db.insert(s.users).values({id,name:id});a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","etsy"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","etsy"));
 for(const scope of [a,b]){await db.update(s.stores).set({externalShopId:scope===a?"123":"456"}).where(eq(s.stores.id,scope.storeId));await db.update(s.connections).set({status:"connected",scopes:["listings_r"]}).where(eq(s.connections.storeId,scope.storeId));}
 rows=[listing()];sections=[{shop_section_id:"7",title:"Fictional section",rank:1,active_listing_count:1}];
},20000);
afterEach(async()=>{await pg.close();});
it("first/repeated sync, rename/reorder/removal/empty sections and metadata remain tenant-scoped and idempotent",async()=>{
 expect((await readCatalog(db,a)).status.state).toBe("NOT_SYNCED");expect((await sync()).status).toBe("SUCCEEDED");expect((await sync()).status).toBe("SUCCEEDED");expect(await db.select().from(s.listings)).toHaveLength(1);expect(await db.select().from(s.listingCatalog)).toHaveLength(1);
 let view=await readCatalog(db,a);expect(view.items[0]).toMatchObject({thumbnail:"https://i.etsystatic.com/test.jpg",section:{state:"KNOWN",title:"Fictional section"},configuration:{state:"VERIFIED",configured:0,total:2}});expect((await readCatalog(db,b)).items).toEqual([]);
 sections=[{...sections[0],title:"Renamed",rank:3}];rows=[listing("101",{title:"Changed",state:"inactive",images:[],updated_timestamp:101})];const r=reader();r.choices=async()=>({...baseCatalog,listing:{...baseCatalog.listing,state:"inactive",updatedAt:101}});await sync(r);view=await readCatalog(db,a);expect(view.items[0]).toMatchObject({title:"Changed",state:"inactive",thumbnail:null,section:{title:"Renamed"}});expect(view.sections[0].rank).toBe(3);
 sections=[];await sync(r);expect((await readCatalog(db,a)).items[0].section.state).toBe("MISSING");expect((await readCatalog(db,a)).sections[0].present).toBe(false);
 rows=[listing("101",{shop_section_id:null,updated_timestamp:102})];const noSection=reader();noSection.choices=async()=>({...baseCatalog,listing:{...baseCatalog.listing,updatedAt:102}});await sync(noSection);expect((await readCatalog(db,a,{section:"uncategorized"})).items).toHaveLength(1);expect((await readCatalog(db,a,{section:"unknown"})).items).toHaveLength(0);
});
it("unknown, verified no section, unavailable section and failed section refresh are distinct",async()=>{
 rows=[listing("101",{shop_section_id:undefined}),listing("102",{shop_section_id:0}),listing("103",{shop_section_id:"99"})];await sync();const view=await readCatalog(db,a);expect(view.items.map(i=>i.section.state)).toEqual(["UNKNOWN","UNCATEGORIZED","MISSING"]);expect(view.sections.find(s=>s.id==="99")).toMatchObject({title:null,rank:null,activeListingCount:null,verifiedAt:null});
 const r=reader();r.sections=async()=>{throw new Error("secret provider body");};rows=[listing("102",{shop_section_id:"7"})];expect((await sync(r)).status).toBe("PARTIAL");expect((await readCatalog(db,a)).items.find(i=>i.listingId==="102")!.section.state).toBe("UNCATEGORIZED");expect((await readCatalog(db,a)).status.issues).not.toContain("secret provider body");
});
it("partial pages resume, preserve previous data, retain draft/inactive and never scan order history",async()=>{
 rows=Array.from({length:101},(_,i)=>listing(String(1000+i)));rows.push(listing("2000",{state:"draft"}),listing("2001",{state:"inactive"}));
 expect(await sync(reader(),{pages:1,choices:1})).toMatchObject({status:"PARTIAL",hasMore:true,processed:100});expect((await readCatalog(db,a)).pagination.total).toBe(100);
 expect(await sync(reader(),{pages:5,choices:1})).toMatchObject({status:"PARTIAL",hasMore:true,processed:103});const first=await readCatalog(db,a,{pageSize:10}),second=await readCatalog(db,a,{page:2,pageSize:10});expect(first.items).toHaveLength(10);expect(second.items).toHaveLength(10);expect(new Set([...first.items,...second.items].map(i=>i.listingId)).size).toBe(20);
 expect((await readCatalog(db,a,{state:"draft"})).items[0].listingId).toBe("2000");expect((await readCatalog(db,a,{search:"2001"})).pagination.total).toBe(1);
});
it("rate limit, page failure and retry preserve previous catalog and do not auto-request on reads",async()=>{
 await sync();const r=reader();r.listings=async()=>{throw new CatalogError("RATE_LIMIT",30);};expect(await sync(r)).toMatchObject({status:"PARTIAL",retryAfterSeconds:30});expect((await readCatalog(db,a)).items).toHaveLength(1);expect((await sync()).status).toBe("SUCCEEDED");
 const get=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw new Error("NO_NETWORK");});await readCatalog(db,a);await savedSetupCatalog(db,a,"101");expect(get).not.toHaveBeenCalled();get.mockRestore();
 const failed=reader();failed.sections=async()=>{throw new CatalogError("AUTHORIZATION");};expect((await sync(failed)).status).toBe("FAILED");expect((await readCatalog(db,a)).items).toHaveLength(1);
});
it("prevents concurrent sync and fences disconnect before publishing received data",async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;}),r=reader();r.sections=async()=>{await gate;return sections;};const first=sync(r);await vi.waitFor(async()=>expect((await db.select().from(s.catalogSync))[0]?.claim).toBeTruthy());await expect(sync()).rejects.toThrow("BUSY");release();await first;
 const changed=reader();changed.listings=async()=>{await db.update(s.connections).set({epoch:1}).where(eq(s.connections.storeId,a.storeId));return {count:1,results:[listing("102")]};};await sync(changed);expect((await readCatalog(db,a)).items.map(i=>i.listingId)).toEqual(["101"]);
});
it("denies forged scope, cross-store reader and operator writes before external work; operators can read",async()=>{
 const factory=vi.fn(async()=>reader());for(const scope of [b,{...a,userId:"b"},{...a,organizationId:b.organizationId}]){if(scope===b){await expect(syncCatalog(db,scope,{},factory)).resolves.toMatchObject({status:"FAILED"});}else await expect(syncCatalog(db,scope,{},factory)).rejects.toThrow();}
 await db.insert(s.memberships).values({organizationId:a.organizationId,userId:"member",role:"operator"});const member={...a,userId:"member"};expect((await readCatalog(db,member)).items).toEqual([]);const noCall=vi.fn();await expect(syncCatalog(db,member,{},noCall)).rejects.toThrow();expect(noCall).not.toHaveBeenCalled();await expect(readCatalog(db,{...a,storeId:b.storeId})).rejects.toThrow();
});
async function configured(index=0){
 const choice=baseCatalog.configurations[index],policy={contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:choice.purchaseSelections,inputMappings:[]};
 const productId=await beginEtsyProductDraft(db,a,policy),[draft]=await db.select().from(s.productVersions).where(eq(s.productVersions.productId,productId));
 const configuration={...draft.configuration,sections:[{id:"scope",title:"Reading",instruction:"Fictional instructions",sortOrder:0}],output:"PDF",workflow:"MANUAL"};
 await activateProduct(db,a,productId,draft.id,0,{name:"Fictional product",configuration});return productId;
}
it("exact published configuration counts, draft-only and missing mappings; PDF store default and override",async()=>{
 await sync();const p=await configured();let view=await readCatalog(db,a);expect(view.items[0].configuration).toMatchObject({total:2,configured:1});expect(view.items[0].configuration.missingChoices).toHaveLength(1);expect(view.items[0].pdfAppearance.state).toBe("UNKNOWN");
 const secondChoice=baseCatalog.configurations[1],q=await beginEtsyProductDraft(db,a,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:secondChoice.purchaseSelections,inputMappings:[]});view=await readCatalog(db,a);expect(view.items[0].configuration.choices[1].state).toBe("DRAFT");expect(view.items[0].configuration.configured).toBe(1);
 const d=await createDocumentDesign(db,a,{name:"Shared Classic",configuration:studioPreset("classic")});await setDefaultDocumentDesign(db,a,d.id);view=await readCatalog(db,a);expect(view.items[0].pdfAppearance).toMatchObject({state:"RESOLVED",usesStoreDefault:true,multipleDesigns:false});
 const override=await createDocumentDesign(db,a,{name:"Override",configuration:studioPreset("minimal")});await assignDocumentDesignToProduct(db,a,p,override.id);view=await readCatalog(db,a);expect(view.items[0].pdfAppearance).toMatchObject({state:"MULTIPLE",multipleDesigns:true});await assignDocumentDesignToProduct(db,a,q,override.id);expect((await readCatalog(db,a)).items[0].pdfAppearance.multipleDesigns).toBe(false);
});
it("sync never changes configuration, versions, mappings, reading identity or operational snapshots",async()=>{
 await sync();const p=await configured();await editProduct(db,a,p);await ingestOrder(db,a,fixtureOrders[0],{suppressProductionAdmission:true});expect(await db.select().from(s.units)).not.toHaveLength(0);
 const keys=["products","productVersions","mappings","units","orders","lineItems","generations","productionQueue","documentSnapshots","documentArtifacts","productDocumentDesigns"] as const;
 const before=await Promise.all(keys.map(k=>db.select().from(s[k])));rows=[listing("101",{title:"New current title",updated_timestamp:101})];const r=reader();r.choices=async()=>({...baseCatalog,listing:{...baseCatalog.listing,updatedAt:101}});await sync(r);expect(await Promise.all(keys.map(k=>db.select().from(s[k])))).toEqual(before);
});
it("inventory failure, unsupported inventory and stale observations expose unknown/partial counts instead of 0/0",async()=>{
 await sync();const r=reader();r.choices=async()=>{throw new Error();};await sync(r);let view=await readCatalog(db,a);expect(view.items[0].configuration).toMatchObject({state:"UNKNOWN",total:null,configured:null});expect((await db.select().from(s.listingCatalog))[0].setupCatalog).not.toBeNull();
 r.choices=async()=>({...baseCatalog,state:"BLOCKED",configurations:[],reasons:["UNSUPPORTED_SCALE"]});await sync(r);view=await readCatalog(db,a);expect(view.items[0].configuration).toMatchObject({state:"PARTIAL",total:null});
});
it("single default and multi-property choices retain existing exact identity, never historical variants",async()=>{
 const defaultChoice={key:"etsy-selection/1:",purchaseSelections:[],displaySelections:[]};const r=reader();r.choices=async()=>({...baseCatalog,configurations:[defaultChoice]});await sync(r);expect((await readCatalog(db,a)).items[0].configuration).toMatchObject({total:1,configured:0});
 await db.insert(s.mappings).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",variantKey:"historical-only",label:"Historical",required:[],paused:false});
 const choice={key:"etsy-selection/1:100=200;300=400",purchaseSelections:[{propertyId:"100",valueIds:["200"]},{propertyId:"300",valueIds:["400"]}],displaySelections:[{propertyId:"100",label:"Scope",values:[{valueId:"200",label:"Detailed"}]},{propertyId:"300",label:"Target",values:[{valueId:"400",label:"Same day"}]}]};r.choices=async()=>({...baseCatalog,configurations:[choice]});await sync(r);const view=await readCatalog(db,a);expect(view.items[0].configuration.total).toBe(1);expect(view.items[0].configuration.choices[0].label).toBe("Detailed / Same day");expect(view.items[0].configuration.choices.some(c=>c.key==="historical-only")).toBe(false);
});
it("shared Product mappings deduplicate PDF summary without treating an inexact policy as configured",async()=>{
 await sync();const p=await configured();await db.insert(s.mappings).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",variantKey:baseCatalog.configurations[1].key,label:"Second choice",required:[],paused:false,productId:p});
 let view=await readCatalog(db,a);expect(view.items[0].configuration).toMatchObject({total:2,configured:1});expect(view.items[0].pdfAppearance).toMatchObject({state:"UNAVAILABLE"});expect(view.items[0].pdfAppearance.products).toHaveLength(1);expect(view.items[0].configuration.choices.every(c=>c.productId===p&&c.setupHref.startsWith(`/products/${p}/configuration?tab=setup`)&&new URL(c.setupHref,"https://test").searchParams.get("choice")===c.key)).toBe(true);
 const d=await createDocumentDesign(db,a,{name:"Classic",configuration:studioPreset("classic")});await setDefaultDocumentDesign(db,a,d.id);view=await readCatalog(db,a);expect(view.items[0].pdfAppearance).toMatchObject({state:"RESOLVED",usesStoreDefault:true});
});
it("database ownership constraints reject cross-store sections and catalog references",async()=>{
 await sync();const [meta]=await db.select().from(s.listingCatalog);await expect(db.insert(s.listingCatalog).values({...meta,storeId:b.storeId})).rejects.toThrow();await expect(db.update(s.listingCatalog).set({sectionId:"999",sectionState:"KNOWN"}).where(eq(s.listingCatalog.storeId,a.storeId))).rejects.toThrow();
});
it("bounded query scales to 1,000 listings, keeps deterministic pagination and does not select history",async()=>{
 await db.insert(s.listings).values(Array.from({length:1000},(_,i)=>({organizationId:a.organizationId,storeId:a.storeId,externalId:String(10000+i),title:"Equal title",state:i%2?"draft":"active",sourceUpdatedAt:1,snapshot:{externalId:String(10000+i),title:"Equal title",state:i%2?"draft":"active",updatedAt:1,personalization:[]}})));
 const queries:string[]=[];const observed=drizzle(pg,{schema:s,logger:{logQuery(q){queries.push(q);}}}) as unknown as Database;
 const first=await readCatalog(observed,a,{pageSize:50}),second=await readCatalog(observed,a,{pageSize:50,page:2});expect(first.pagination.total).toBe(1000);expect(first.items).toHaveLength(50);expect(new Set([...first.items,...second.items].map(i=>i.listingId)).size).toBe(100);expect(first.items.every(i=>i.configuration.total===null)).toBe(true);expect(queries.some(q=>/order_line_items|fulfillment_units|orders"|generations"/.test(q))).toBe(false);expect(queries.length).toBeLessThan(30);const legacy=await catalogPageData(observed,a,{page:2});expect(legacy.listings).toHaveLength(50);expect(legacy.pagination.total).toBe(1000);expect(queries.filter(q=>q.includes('"order_line_items"')).every(q=>/limit/.test(q)&&/listing_external_id/.test(q))).toBe(true);
});
it("inventory rate limit retains last-good evidence but exposes failed current coverage and resumes same choice",async()=>{
 await sync();const r=reader();r.choices=async()=>{throw new CatalogError("RATE_LIMIT",45);};expect(await sync(r)).toMatchObject({status:"PARTIAL",hasMore:true,retryAfterSeconds:45});const view=await readCatalog(db,a);expect(view.items[0].configuration).toMatchObject({state:"UNKNOWN",total:null,configured:null});expect(view.items[0].configuration.lastAttemptAt).toBeInstanceOf(Date);expect((await sync()).status).toBe("SUCCEEDED");expect((await readCatalog(db,a)).items[0].configuration.state).toBe("VERIFIED");
});
it("expired claims stop before further external reads, not only before publishing",async()=>{
 const r=reader();const result=await syncCatalog(db,a,{},async()=>{await db.update(s.catalogSync).set({claimUntil:new Date(Date.now()-1)}).where(eq(s.catalogSync.storeId,a.storeId));return r;});expect(result.status).toBe("FAILED");expect(r.sections).not.toHaveBeenCalled();expect(r.listings).not.toHaveBeenCalled();expect(r.choices).not.toHaveBeenCalled();
});
it("global coverage filtering precedes pagination/counts and preserves paused, draft-only and exact policy semantics",async()=>{
 await sync();let view=await readCatalog(db,a,{setup:"none",pageSize:1});expect(view.pagination.total).toBe(1);expect(view.items[0].configuration.configured).toBe(0);
 const p=await configured();expect((await readCatalog(db,a,{setup:"partial"})).pagination.total).toBe(1);expect((await readCatalog(db,a,{setup:"full"})).pagination.total).toBe(0);
 await db.update(s.mappings).set({paused:true}).where(eq(s.mappings.productId,p));expect((await readCatalog(db,a,{setup:"partial"})).items[0].configuration.choices[0].paused).toBe(true);
 const choice=baseCatalog.configurations[1];await beginEtsyProductDraft(db,a,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:choice.purchaseSelections,inputMappings:[]});expect((await readCatalog(db,a,{setup:"partial"})).items[0].configuration.choices[1].state).toBe("DRAFT");
 await configured(1);view=await readCatalog(db,a,{setup:"full",section:"7",state:"active",search:"Fictional",sort:"updated_desc",pageSize:1});expect(view.pagination.total).toBe(1);expect(view.items[0].configuration).toMatchObject({configured:2,total:2});
 expect((await readCatalog(db,b,{setup:"full"})).pagination.total).toBe(0);
 await db.update(s.listingCatalog).set({choicesError:"RATE_LIMIT"}).where(eq(s.listingCatalog.storeId,a.storeId));expect((await readCatalog(db,a,{setup:"review"})).pagination.total).toBe(1);expect((await readCatalog(db,a,{setup:"full"})).pagination.total).toBe(0);
});
it("coverage filters count all matching listings rather than filtering the current page; navigation counts describe saved catalog",async()=>{
 rows=[listing("101"),listing("102",{shop_section_id:null}),listing("103",{shop_section_id:undefined}),listing("104",{shop_section_id:"99"}),listing("105")];await sync();
 const view=await readCatalog(db,a,{setup:"none",pageSize:2,page:2});expect(view.items).toHaveLength(2);expect(view.pagination.total).toBe(5);expect(view.sectionCounts).toEqual({all:5,uncategorized:1,unknown:1,missing:1});expect(view.sections.find(s=>s.id==="7")!.catalogCount).toBe(2);
 await db.update(s.listingCatalog).set({choicesSourceUpdatedAt:99}).where(eq(s.listingCatalog.listingExternalId,"101"));expect((await readCatalog(db,a,{setup:"review",pageSize:1})).pagination.total).toBe(1);expect((await readCatalog(db,a,{setup:"none",pageSize:1,page:2})).pagination.total).toBe(4);
 expect((await readCatalog(db,a,{setup:"none",section:"uncategorized",state:"active"})).pagination.total).toBe(1);
});
it("canonical SQL coverage matches unsorted multi-property published identity; legacy defaults never count",async()=>{
 const choice={key:"etsy-selection/1:100=200,201;300=400",purchaseSelections:[{propertyId:"300",valueIds:["400"]},{propertyId:"100",valueIds:["201","200"]}],displaySelections:[]};
 const r=reader();r.choices=async()=>({...baseCatalog,configurations:[choice]});await sync(r);
 const p=await beginEtsyProductDraft(db,a,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:choice.purchaseSelections,inputMappings:[]}),[draft]=await db.select().from(s.productVersions).where(eq(s.productVersions.productId,p));
 await activateProduct(db,a,p,draft.id,0,{name:"Exact",configuration:{...draft.configuration,sections:[{id:"one",title:"Reading",instruction:"Synthetic",sortOrder:0}],output:"TEXT",workflow:"MANUAL"}});
 expect((await readCatalog(db,a,{setup:"full"})).items[0].configuration).toMatchObject({configured:1,total:1});
 await db.insert(s.mappings).values({organizationId:a.organizationId,storeId:a.storeId,listingExternalId:"101",variantKey:"default",label:"Historical",required:[],productId:p});
 await db.update(s.mappings).set({productId:null}).where(eq(s.mappings.variantKey,choice.key));expect((await readCatalog(db,a,{setup:"none"})).pagination.total).toBe(1);
 r.choices=async()=>({...baseCatalog,configurations:[{key:"etsy-selection/1:",purchaseSelections:[],displaySelections:[]}]});await sync(r);
 const defaultProduct=await beginEtsyProductDraft(db,a,{contractVersion:"etsy-product-policy/v1",fulfillment:"READING",listingId:"101",purchaseSelections:[],inputMappings:[]}),[defaultDraft]=await db.select().from(s.productVersions).where(eq(s.productVersions.productId,defaultProduct));
 await activateProduct(db,a,defaultProduct,defaultDraft.id,0,{name:"Default reading",configuration:{...defaultDraft.configuration,sections:[{id:"one",title:"Reading",instruction:"Synthetic",sortOrder:0}],output:"TEXT",workflow:"MANUAL"}});
 expect((await readCatalog(db,a,{setup:"full"})).items[0].configuration).toMatchObject({configured:1,total:1});
});

it("Listing Detail resolves owned inactive/draft listings and rejects missing or cross-store identities",async()=>{
 await sync();expect((await readListingDetail(db,a,"101"))?.item.listingId).toBe("101");expect(await readListingDetail(db,a,"999")).toBeNull();expect(await readListingDetail(db,b,"101")).toBeNull();expect(await readListingDetail(db,a,"../101")).toBeNull();await expect(readListingDetail(db,{...a,userId:"b"},"101")).rejects.toThrow();
 for(const state of ["inactive","draft"] as const){await db.update(s.listings).set({state}).where(eq(s.listings.externalId,"101"));expect((await readListingDetail(db,a,"101"))?.item.state).toBe(state);}
});
it("Listing Detail preserves exact multidimensional/default/Unicode identities, owned product names and per-product PDF",async()=>{
 await sync();const p=await configured();const d=await createDocumentDesign(db,a,{name:"Classic",configuration:studioPreset("classic")});await setDefaultDocumentDesign(db,a,d.id);let detail=await readListingDetail(db,a,"101");expect(detail?.item.configuration.choices[0]).toMatchObject({productId:p,productName:"Fictional product",association:"OWNED",state:"CONFIGURED",hasPublished:true});expect(detail?.item.pdfAppearance.products[0]).toMatchObject({name:"Classic",source:"STORE_DEFAULT"});
 const choice={key:"etsy-selection/1:100=200;300=400",purchaseSelections:[{propertyId:"100",valueIds:["200"]},{propertyId:"300",valueIds:["400"]}],displaySelections:[{propertyId:"100",label:"詳細",values:[{valueId:"200",label:"同じ名前"}]},{propertyId:"300",label:"Delivery",values:[{valueId:"400",label:"Same Hour"}]}]};const r=reader();r.choices=async()=>({...baseCatalog,configurations:[choice,{...choice,key:"etsy-selection/1:100=201;300=400",purchaseSelections:[{propertyId:"100",valueIds:["201"]},{propertyId:"300",valueIds:["400"]}]}]});await sync(r);detail=await readListingDetail(db,a,"101");expect(detail?.item.configuration.choices).toHaveLength(2);expect(detail?.item.configuration.choices[0].displaySelections).toEqual(choice.displaySelections);expect(detail?.item.configuration.choices[0].key).not.toBe(detail?.item.configuration.choices[1].key);
});
it("Listing Detail readers cannot cause mutations/network calls and lookup queries are bounded and batched",async()=>{
 await sync();await configured();await db.insert(s.memberships).values({organizationId:a.organizationId,userId:"member",role:"operator"});const before=await Promise.all([db.select().from(s.products),db.select().from(s.productVersions),db.select().from(s.mappings),db.select().from(s.catalogSync)]);const queries:string[]=[];const observed=drizzle(pg,{schema:s,logger:{logQuery(q){queries.push(q);}}}) as unknown as Database;const network=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw Error("NO_NETWORK");});try{const detail=await readListingDetail(observed,{...a,userId:"member"},"101");expect(detail?.item.configuration.total).toBe(2);expect(network).not.toHaveBeenCalled();expect(queries.some(q=>/orders|order_line_items|fulfillment_units/.test(q))).toBe(false);expect(queries.some(q=>q.includes('"listings"')&&q.includes('limit')&&q.includes('"external_id"'))).toBe(true);expect(queries.length).toBeLessThan(18);expect(await Promise.all([db.select().from(s.products),db.select().from(s.productVersions),db.select().from(s.mappings),db.select().from(s.catalogSync)])).toEqual(before);}finally{network.mockRestore();}
});
it("Listing Detail cannot render mismatched cached listing evidence or unsafe external URLs",async()=>{
 await sync();await db.update(s.listingCatalog).set({listingUrl:"https://evil.test/listing/101",thumbnailUrl:"https://evil.test/image.jpg",setupCatalog:{...baseCatalog,listing:{...baseCatalog.listing,id:"999"}}}).where(eq(s.listingCatalog.storeId,a.storeId));const detail=await readListingDetail(db,a,"101");expect(detail?.item.configuration.state).toBe("UNKNOWN");expect(detail?.item.configuration.choices).toEqual([]);expect(detail?.item.etsyUrl).toBeNull();expect(detail?.item.thumbnail).toBeNull();
});
it("Listing Detail stays within a constant query budget for 100 exact current choices",async()=>{
 await sync();await configured();const queries:string[]=[];const observed=drizzle(pg,{schema:s,logger:{logQuery(q){queries.push(q);}}}) as unknown as Database;
 await readListingDetail(observed,a,"101");const small=queries.length;queries.length=0;
 const configurations=[baseCatalog.configurations[0],...Array.from({length:99},(_,i)=>({key:`etsy-selection/1:100=${200+i}`,purchaseSelections:[{propertyId:"100",valueIds:[String(200+i)]}],displaySelections:[{propertyId:"100",label:"Detail",values:[{valueId:String(200+i),label:`Choice ${i}`}]}]}))];
 await db.update(s.listingCatalog).set({setupCatalog:{...baseCatalog,configurations}}).where(eq(s.listingCatalog.storeId,a.storeId));queries.length=0;
 const detail=await readListingDetail(observed,a,"101");expect(detail?.item.configuration).toMatchObject({state:"VERIFIED",total:100,configured:1});expect(detail?.item.configuration.choices).toHaveLength(100);expect(queries.length).toBe(small);
});
it("Listing Detail preserves an invalid explicit PDF assignment instead of inheriting the valid store default",async()=>{
 await sync();const p=await configured();const fallback=await createDocumentDesign(db,a,{name:"Store Classic",configuration:studioPreset("classic")});await setDefaultDocumentDesign(db,a,fallback.id);const override=await createDocumentDesign(db,a,{name:"Invalid Override",configuration:studioPreset("minimal")});await assignDocumentDesignToProduct(db,a,p,override.id);await db.update(s.documentDesigns).set({revision:1,configuration:{contractVersion:"document-design/v1"} as typeof override.configuration}).where(eq(s.documentDesigns.id,override.id));const detail=await readListingDetail(db,a,"101");expect(detail?.item.pdfAppearance.products[0]).toMatchObject({productId:p,state:"INVALID",source:"PRODUCT",name:null,designId:null});
});

it("explicit operational choice creation preserves exact identity, is idempotent and denies members/foreign/stale evidence",async()=>{
 const {beginCatalogChoiceDraft}=await import('../src/modules/products/catalog-setup');
 await db.update(s.stores).set({onboardingStage:'complete'}).where(eq(s.stores.id,a.storeId));await sync();
 const before=await db.select().from(s.products);await readListingDetail(db,a,'101');expect(await db.select().from(s.products)).toEqual(before);
 const choice=baseCatalog.configurations[0];const id=await beginCatalogChoiceDraft(db,a,{listingId:'101',choice:choice.key});
 expect(await beginCatalogChoiceDraft(db,a,{listingId:'101',choice:choice.key})).toBe(id);expect(await db.select().from(s.products)).toHaveLength(1);
 const version=(await db.select().from(s.productVersions))[0];expect(version.status).toBe('DRAFT');expect(version.configuration.etsyFulfillment?.purchaseSelections).toEqual(choice.purchaseSelections);
 const bindings=await db.select().from(s.mappings);expect(bindings).toHaveLength(1);expect(bindings[0].variantKey).toBe(choice.key);
 await db.insert(s.memberships).values({organizationId:a.organizationId,userId:'member',role:'operator'});
 await expect(beginCatalogChoiceDraft(db,{...a,userId:'member'},{listingId:'101',choice:baseCatalog.configurations[1].key})).rejects.toThrow();
 await expect(beginCatalogChoiceDraft(db,b,{listingId:'101',choice:choice.key})).rejects.toThrow();
 await expect(beginCatalogChoiceDraft(db,a,{listingId:'101',choice:'etsy-selection/1:999=999'})).rejects.toThrow('CHOICE_NOT_VERIFIED');
 await db.update(s.listingCatalog).set({choicesError:'REFRESH_FAILED'});await expect(beginCatalogChoiceDraft(db,a,{listingId:'101',choice:choice.key})).rejects.toThrow('CHOICE_NOT_VERIFIED');
 expect(await db.select().from(s.products)).toHaveLength(1);for(const table of [s.orders,s.units,s.generations])expect(await db.select().from(table)).toHaveLength(0);
});
it('identically labelled current choices create distinct exact associations and existing drafts are reused',async()=>{
 const {beginCatalogChoiceDraft}=await import('../src/modules/products/catalog-setup');const {saveProductDraft,productData}=await import('../src/modules/products/service');
 await db.update(s.stores).set({onboardingStage:'complete'}).where(eq(s.stores.id,a.storeId));const r=reader();r.choices=async()=>({...baseCatalog,configurations:baseCatalog.configurations.map(c=>({...c,displaySelections:c.displaySelections.map(d=>({...d,values:d.values.map(v=>({...v,label:'Same label'}))}))}))});await sync(r);
 const ids=[];for(const c of baseCatalog.configurations)ids.push(await beginCatalogChoiceDraft(db,a,{listingId:'101',choice:c.key}));expect(new Set(ids).size).toBe(2);
 const d=await productData(db,a,ids[0]);await saveProductDraft(db,a,ids[0],d.draft!.id,0,{name:'Saved draft',configuration:d.draft!.configuration});expect(await beginCatalogChoiceDraft(db,a,{listingId:'101',choice:baseCatalog.configurations[0].key})).toBe(ids[0]);expect((await productData(db,a,ids[0])).draft?.revision).toBe(1);expect(await db.select().from(s.products)).toHaveLength(2);
});
