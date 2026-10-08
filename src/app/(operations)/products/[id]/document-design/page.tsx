import Link from "next/link";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {productData} from "@/modules/products/service";
import {documentDesignSetup,listDocumentDesigns} from "@/modules/documents/service";
import {assignProductDocumentDesign} from "./actions";
export const dynamic="force-dynamic";
export default async function ProductDocumentDesign({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string}>}){
 const scope=await currentStoreScope(),db=database(),{id}=await params,query=await searchParams;
 const data=await productData(db,scope,id),setup=await documentDesignSetup(db,scope,id);
 let designs:Awaited<ReturnType<typeof listDocumentDesigns>>=[];let invalid=false;
 try{designs=(await listDocumentDesigns(db,scope)).filter(d=>d.status==="ACTIVE");}catch{invalid=true;}
 return <main className="page-content"><Link href="/onboarding/products/setup">← Back to products</Link><h1>PDF appearance</h1><p>{data.product.name}</p>
 <p role="status">{setup.status==="DESIGN_READY"?`Assigned: ${setup.design.name} · revision ${setup.design.revision}`:setup.status==="INVALID_CONFIGURATION"||invalid?"The document design needs attention.":"Choose an approved document design before preparing PDFs."}</p>
 {query.error&&<p role="alert">The design could not be assigned. Check that it belongs to this Store and is available.</p>}{query.saved&&<p role="status">Design assignment saved. Existing document snapshots are unchanged.</p>}
 {!designs.length?<p>No approved document designs are available. Create a Store-owned design through the existing owner design configuration before assigning one.</p>:<form action={assignProductDocumentDesign}><input type="hidden" name="product" value={id}/><label>Document design<select name="design" defaultValue={setup.status==="DESIGN_READY"&&setup.design.source==="PRODUCT"?setup.design.designId:"store-default"}><option value="store-default">Use Store default (if assigned)</option>{designs.map(d=><option key={d.id} value={d.id}>{d.name} · revision {d.revision}</option>)}</select></label><button className="button" disabled={invalid}>Save design assignment</button></form>}
 <p className="small muted">Each prepared document keeps its exact design snapshot. Assignment does not generate or deliver a PDF.</p></main>;
}
