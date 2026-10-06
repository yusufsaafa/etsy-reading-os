import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/client";
import * as schema from "../src/db/schema";
import { authorizeStore, createWorkspace } from "../src/modules/identity/service";
import type { Scope } from "../src/modules/intake/contracts";
import { createDocumentDesign, getDocumentDesign, updateDocumentDesign, archiveDocumentDesign, setDefaultDocumentDesign, assignDocumentDesignToProduct, resolveDocumentDesignForProduct } from "../src/modules/documents/service";
const config=()=>({contractVersion:"document-design/v1",template:"classic",brand:{name:"Studio",primaryColor:"#1f2937",accentColor:"#abcdef"},typography:{heading:"source-serif-4",body:"inter"},cover:"BRAND",display:{customerName:true,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:"Thank you"});
let pg:PGlite,db:Database,a:Scope,b:Scope,sibling:Scope,productId:string;
beforeEach(async()=>{
 pg=new PGlite();for(const file of readdirSync("drizzle").filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync("drizzle/"+file,"utf8"));db=drizzle(pg,{schema}) as unknown as Database;
 for(const id of ["a","b"])await db.insert(schema.users).values({id,name:id});
 a=await authorizeStore(db,"a",await createWorkspace(db,"a","A","fixtures"));b=await authorizeStore(db,"b",await createWorkspace(db,"b","B","fixtures"));
 const [store]=await db.insert(schema.stores).values({organizationId:a.organizationId,name:"Sibling",importSince:new Date()}).returning();sibling=await authorizeStore(db,"a",store.id);
 const [product]=await db.insert(schema.products).values({organizationId:a.organizationId,storeId:a.storeId,name:"Reading"}).returning();productId=product.id;
},20000);
afterEach(async()=>{await pg.close();});
const create=(scope=a,name="Main")=>createDocumentDesign(db,scope,{name,configuration:config()});
it("creates and updates owned bounded designs with revision conflict and detached resolution",async()=>{
 const design=await create();expect(design.revision).toBe(0);await setDefaultDocumentDesign(db,a,design.id);
 const resolved=await resolveDocumentDesignForProduct(db,a,productId);expect(resolved.status).toBe("RESOLVED");
 const current=await getDocumentDesign(db,a,design.id);await updateDocumentDesign(db,a,design.id,current.revision,{name:"New",configuration:{...config(),footerText:"New footer"}});
 await expect(updateDocumentDesign(db,a,design.id,current.revision,{name:"Stale",configuration:config()})).rejects.toThrow("CONFLICT");
 if(resolved.status==="RESOLVED") {expect(resolved.design.name).toBe("Main");expect(Object.isFrozen(resolved.design.configuration.display)).toBe(true);}
 expect((await db.select().from(schema.products))[0].name).toBe("Reading");
 for(const table of [schema.productVersions,schema.readingReviews,schema.generations])expect(await db.select().from(table)).toHaveLength(0);
});
it("explicit setup required; assignment wins over default and replacement/removal is deterministic",async()=>{
 expect(await resolveDocumentDesignForProduct(db,a,productId)).toEqual({status:"SETUP_REQUIRED"});
 const first=await create(),second=await create(a,"Second");await setDefaultDocumentDesign(db,a,first.id);await assignDocumentDesignToProduct(db,a,productId,second.id);await assignDocumentDesignToProduct(db,a,productId,second.id);
 expect(await db.select().from(schema.productDocumentDesigns)).toHaveLength(1);let result=await resolveDocumentDesignForProduct(db,a,productId);if(result.status!=="RESOLVED")throw Error();expect(result.design.designId).toBe(second.id);expect(result.design.source).toBe("PRODUCT");
 await assignDocumentDesignToProduct(db,a,productId,null);result=await resolveDocumentDesignForProduct(db,a,productId);if(result.status!=="RESOLVED")throw Error();expect(result.design.source).toBe("STORE_DEFAULT");
 await setDefaultDocumentDesign(db,a,null);expect(await resolveDocumentDesignForProduct(db,a,productId)).toEqual({status:"SETUP_REQUIRED"});
});
it("archive blocks defaults and assigned designs, is terminal and guarded in SQL",async()=>{
 const design=await create();await setDefaultDocumentDesign(db,a,design.id);await expect(archiveDocumentDesign(db,a,design.id)).rejects.toThrow("IN_USE");await setDefaultDocumentDesign(db,a,null);
 await assignDocumentDesignToProduct(db,a,productId,design.id);await expect(archiveDocumentDesign(db,a,design.id)).rejects.toThrow("IN_USE");
 const row=await getDocumentDesign(db,a,design.id);await expect(db.update(schema.documentDesigns).set({status:"ARCHIVED",revision:row.revision+1}).where(eq(schema.documentDesigns.id,design.id))).rejects.toThrow();
 await assignDocumentDesignToProduct(db,a,productId,null);await archiveDocumentDesign(db,a,design.id);await archiveDocumentDesign(db,a,design.id);
 await expect(setDefaultDocumentDesign(db,a,design.id)).rejects.toThrow("ARCHIVED");await expect(assignDocumentDesignToProduct(db,a,productId,design.id)).rejects.toThrow("ARCHIVED");await expect(updateDocumentDesign(db,a,design.id,99,{name:"New",configuration:config()})).rejects.toThrow("ARCHIVED");await expect(db.delete(schema.documentDesigns).where(eq(schema.documentDesigns.id,design.id))).rejects.toThrow();
});
it("cross-org and sibling Store reads, writes, assignments, defaults and resolution are denied",async()=>{
 const design=await create();for(const foreign of [b,sibling]) {
 await expect(getDocumentDesign(db,foreign,design.id)).rejects.toThrow();await expect(updateDocumentDesign(db,foreign,design.id,0,{name:"Foreign",configuration:config()})).rejects.toThrow();await expect(archiveDocumentDesign(db,foreign,design.id)).rejects.toThrow();await expect(setDefaultDocumentDesign(db,foreign,design.id)).rejects.toThrow();await expect(assignDocumentDesignToProduct(db,foreign,productId,design.id)).rejects.toThrow();await expect(resolveDocumentDesignForProduct(db,foreign,productId)).rejects.toThrow();
 const foreignDesign=await create(foreign);await expect(assignDocumentDesignToProduct(db,a,productId,foreignDesign.id)).rejects.toThrow();await expect(db.insert(schema.productDocumentDesigns).values({organizationId:a.organizationId,storeId:a.storeId,productId,designId:foreignDesign.id})).rejects.toThrow();
 }
 await expect(create({...a,userId:"b"})).rejects.toThrow();await expect(getDocumentDesign(db,a,"00000000-0000-4000-8000-000000000000")).rejects.toThrow();
});
it("concurrent defaults and assignment/archive preserve valid relationships",async()=>{
 const first=await create(),second=await create(a,"Second");await Promise.all([setDefaultDocumentDesign(db,a,first.id),setDefaultDocumentDesign(db,a,second.id)]);expect((await db.select().from(schema.documentDesigns)).filter(v=>v.isDefault)).toHaveLength(1);
 await setDefaultDocumentDesign(db,a,null);await Promise.allSettled([assignDocumentDesignToProduct(db,a,productId,first.id),archiveDocumentDesign(db,a,first.id)]);
 const row=await getDocumentDesign(db,a,first.id),assignments=await db.select().from(schema.productDocumentDesigns);expect(!(row.status==="ARCHIVED" && assignments.some(v=>v.designId===first.id))).toBe(true);
 await Promise.all([assignDocumentDesignToProduct(db,a,productId,second.id),assignDocumentDesignToProduct(db,a,productId,second.id)]);expect(await db.select().from(schema.productDocumentDesigns)).toHaveLength(1);
});
it("malformed durable configuration fails closed without repairing or falling back",async()=>{
 const design=await create();await setDefaultDocumentDesign(db,a,design.id);const row=await getDocumentDesign(db,a,design.id);
 await db.update(schema.documentDesigns).set({configuration:{...config(),brand:{name:"Bad",primaryColor:"url(secret)",accentColor:"#ffffff"}} as never,revision:row.revision+1}).where(eq(schema.documentDesigns.id,design.id));
 await expect(resolveDocumentDesignForProduct(db,a,productId)).rejects.toThrow("UNAVAILABLE");
});
