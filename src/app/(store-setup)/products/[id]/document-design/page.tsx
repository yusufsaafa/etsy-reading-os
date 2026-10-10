import {z} from "zod";
import {notFound,redirect} from "next/navigation";
import {configurationHref} from "@/modules/products/workspace-navigation";
import {DOCUMENT_FONTS} from "@/modules/documents/contracts";
import {STUDIO_TEMPLATES} from "@/modules/documents/studio-templates";
import Link from "next/link";
import {database} from "@/db/client";
import {currentStoreScope,currentDestination} from "@/modules/identity/session";
import {productData} from "@/modules/products/service";
import {documentDesignSetup,listDocumentDesigns} from "@/modules/documents/service";
import {assignProductDocumentDesign} from "./actions";
export const dynamic="force-dynamic";
export default async function ProductDocumentDesign({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string;created?:string;listing?:string;choice?:string;returnTo?:string}>}){
 const scope=await currentStoreScope(),destination=await currentDestination(),db=database(),{id}=await params,query=await searchParams;
 if(!z.uuid().safeParse(id).success)notFound();
 if(destination.kind==="OPERATIONS_HOME"){const target=configurationHref(id,{tab:"pdf",listingId:query.listing,choice:query.choice,returnTo:query.returnTo});const feedback=new URLSearchParams();if(query.saved==="1")feedback.set("saved","1");if(query.error)feedback.set("error","assignment");redirect(target+(feedback.size?"&"+feedback.toString():""));}
 const data=await productData(db,scope,id),setup=await documentDesignSetup(db,scope,id);
 let designs:Awaited<ReturnType<typeof listDocumentDesigns>>=[];let invalid=false;
 try{designs=(await listDocumentDesigns(db,scope)).filter(d=>d.status==="ACTIVE");}catch{invalid=true;}
 const ready=setup.status==="DESIGN_READY",selected=ready&&setup.design.source==="PRODUCT"?setup.design.designId:"store-default";
 return <div className="page-content pdf-appearance">
 <nav className="studio-breadcrumb" aria-label="Breadcrumb"><Link href={"/onboarding/products/setup"}>← Back to products</Link><span aria-hidden="true">/</span><span>PDF appearance</span></nav>
 <header className="studio-header"><div><h1>PDF appearance</h1><p className="muted">{data.product.name}</p></div><Link className="button secondary" href="/pdf-studio" target="_blank" rel="noopener noreferrer">Open PDF Design Studio ↗</Link></header>
 <section className="studio-card assignment-current" aria-label="Current PDF appearance"><div><span className="small muted">Current design</span><p role="status">{ready?`Assigned: ${setup.design.name} · revision ${setup.design.revision}`:setup.status==="INVALID_CONFIGURATION"||invalid?"The document design needs attention.":"Choose an approved document design before preparing PDFs."}</p></div><span className={ready?"setup-badge ready":"setup-badge needs"}>{ready?"Assigned":"Setup required"}</span>{ready&&<Link href={`/pdf-studio?design=${setup.design.designId}`} target="_blank" rel="noopener noreferrer">Edit assigned design ↗</Link>}</section>
 {query.error&&<p className="error-message" role="alert">The design could not be assigned. Check that it belongs to this Store and is available.</p>}{query.created&&<p className="notice" role="status">Approved design created. Choose it below and save its assignment separately.</p>}{query.saved&&<p className="notice" role="status">Design assignment saved. Existing document snapshots are unchanged.</p>}
 <section className="studio-card"><h2>Choose a design</h2><p className="small muted">Save designs in the Studio, then assign one to this product. Assignment affects future prepared documents.</p>
 {!designs.length?<p>No approved document designs are available. Create and approve a design in the Studio, then return here.</p>:<form action={assignProductDocumentDesign} className="assignment-form"><input type="hidden" name="product" value={id}/><fieldset><legend className="sr-only">Document design</legend><div className="assignment-designs">
 <label className="assignment-choice"><input type="radio" name="design" value="store-default" defaultChecked={selected==="store-default"}/><span><strong>Use Store default</strong><small>Uses the approved Store design, if assigned.</small></span></label>
 {designs.map(d=><label className="assignment-choice" key={d.id}><input type="radio" name="design" value={d.id} defaultChecked={selected===d.id}/><span className={`assignment-swatch ${d.configuration.template}`} style={{color:d.configuration.brand.primaryColor,borderColor:d.configuration.brand.accentColor}} aria-hidden="true">Aa<span>────</span></span><span><strong>{d.name}</strong><small>{STUDIO_TEMPLATES.find(t=>t.key===d.configuration.template)?.name} · Revision {d.revision}</small><small>{DOCUMENT_FONTS[d.configuration.typography.heading]} / {DOCUMENT_FONTS[d.configuration.typography.body]}</small></span></label>)}
 </div></fieldset><button className="button" disabled={invalid}>Save design assignment</button></form>}
 </section><p className="small muted">Existing prepared documents keep their exact appearance. Saving an assignment does not generate or deliver a PDF.</p></div>;
}
