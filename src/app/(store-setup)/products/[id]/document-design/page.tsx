import {DOCUMENT_FONTS} from "@/modules/documents/contracts";
import Link from "next/link";
import {database} from "@/db/client";
import {currentStoreScope,currentDestination} from "@/modules/identity/session";
import {productData} from "@/modules/products/service";
import {documentDesignSetup,listDocumentDesigns} from "@/modules/documents/service";
import {createOwnerDocumentDesign,assignProductDocumentDesign} from "./actions";
export const dynamic="force-dynamic";
export default async function ProductDocumentDesign({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string;created?:string}>}){
 const scope=await currentStoreScope(),destination=await currentDestination(),db=database(),{id}=await params,query=await searchParams;
 const data=await productData(db,scope,id),setup=await documentDesignSetup(db,scope,id);
 let designs:Awaited<ReturnType<typeof listDocumentDesigns>>=[];let invalid=false;
 try{designs=(await listDocumentDesigns(db,scope)).filter(d=>d.status==="ACTIVE");}catch{invalid=true;}
 return <main className="page-content"><Link href={destination.kind==="OPERATIONS_HOME"?"/products":"/onboarding/products/setup"}>← Back to products</Link><h1>PDF appearance</h1><p>{data.product.name}</p>
 <p role="status">{setup.status==="DESIGN_READY"?`Assigned: ${setup.design.name} · revision ${setup.design.revision}`:setup.status==="INVALID_CONFIGURATION"||invalid?"The document design needs attention.":"Choose an approved document design before preparing PDFs."}</p>
 {query.error&&<p role="alert">{query.error==="creation"?"The design could not be created. Review its name, appearance and approval.":"The design could not be assigned. Check that it belongs to this Store and is available."}</p>}{query.created&&<p role="status">Approved design created. Choose it below and save its assignment separately.</p>}{query.saved&&<p role="status">Design assignment saved. Existing document snapshots are unchanged.</p>}
 {!designs.length?<p>No approved document designs are available. Create and approve a design below, then assign it to this product.</p>:<form action={assignProductDocumentDesign}><input type="hidden" name="product" value={id}/><label>Document design<select name="design" defaultValue={setup.status==="DESIGN_READY"&&setup.design.source==="PRODUCT"?setup.design.designId:"store-default"}><option value="store-default">Use Store default (if assigned)</option>{designs.map(d=><option key={d.id} value={d.id}>{d.name} · revision {d.revision}</option>)}</select></label><button className="button" disabled={invalid}>Save design assignment</button></form>}
 <section className="card stack"><h2>Create a document design</h2><p className="small muted">Review these settings, then explicitly approve creation. This does not assign a design or prepare a PDF.</p>
 <form action={createOwnerDocumentDesign} className="stack"><input type="hidden" name="product" value={id}/>
 <label>Design name<input name="name" required maxLength={100} placeholder="My reading design"/></label>
 <label>Studio name on cover<input name="brandName" required maxLength={120} placeholder="Your studio name"/></label>
 <label>Layout<select name="template" defaultValue="minimal"><option value="minimal">Minimal — clean text layout</option><option value="classic">Classic — traditional editorial layout</option></select></label>
 <label>Heading font<select name="heading" defaultValue="source-serif-4">{Object.entries(DOCUMENT_FONTS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label>Body font<select name="body" defaultValue="inter">{Object.entries(DOCUMENT_FONTS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label>Optional footer<input name="footerText" maxLength={500} defaultValue=""/></label>
 <details><summary>Review included appearance</summary><p>Product title and resolved studio attribution on the cover; approved section titles and text; automatic page breaks, consistent margins and page hierarchy. Dark neutral text and accents. No customer names, cards, portraits or external branding assets. The selected controlled fonts apply to headings and body text.</p><p>Creation makes this design active and available for assignment. Each prepared document preserves its design revision.</p></details>
 <label className="check"><input type="checkbox" name="approved" required/> I have reviewed and approve this design configuration.</label><button className="button">Create approved design</button></form></section>
 {designs.length>0&&<details><summary>Inspect available design configurations</summary>{designs.map(d=><section key={d.id}><h3>{d.name}</h3><dl><dt>Layout</dt><dd>{d.configuration.template}</dd><dt>Studio</dt><dd>{d.configuration.brand.name}</dd><dt>Fonts</dt><dd>{DOCUMENT_FONTS[d.configuration.typography.heading]} / {DOCUMENT_FONTS[d.configuration.typography.body]}</dd><dt>Cover</dt><dd>{d.configuration.cover}</dd><dt>Colors</dt><dd>{d.configuration.brand.primaryColor} / {d.configuration.brand.accentColor}</dd><dt>Display</dt><dd>{Object.entries(d.configuration.display).map(([k,v])=>`${({customerName:"Customer name",readingDate:"Reading date",sectionDividers:"Section separators",cardImagery:"Card images",footer:"Footer"} as Record<string,string>)[k]}: ${v?"on":"off"}`).join(" · ")}</dd><dt>Footer</dt><dd>{d.configuration.footerText||"None"}</dd></dl></section>)}</details>}
 <p className="small muted">Each prepared document keeps its exact design snapshot. Assignment does not generate or deliver a PDF.</p></main>;
}
