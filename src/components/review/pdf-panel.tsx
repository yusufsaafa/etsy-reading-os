import {database} from "@/db/client";
import type {Scope} from "@/modules/intake/contracts";
import {readingOutputStatus} from "@/modules/production/documents";
import {localDocumentStorageReadiness} from "@/infrastructure/document-runtime";
import {ReviewPdfForm} from "./pdf-form";
export async function ReviewPdfPanel({scope,orderId,readingId}:{scope:Scope;orderId:string;readingId:string}){
 let output;
 try{output=await readingOutputStatus(database(),scope,orderId,readingId);}catch{return <p role="status" className="small muted">PDF unavailable. Return to the order to check the reading’s current status.</p>;}
 if(output.status==="Approved")return <p className="small muted">This product uses text output.</p>;
 let storage=false;try{storage=["LOCAL_READY","PERSISTENT_READY","S3_CONFIGURED"].includes(await localDocumentStorageReadiness());}catch{}
 if(!storage)return <section className="review-customer"><h2>PDF unavailable</h2><p>Document storage needs to be configured before PDFs can be prepared or opened. Contact your workspace administrator.</p></section>;
 if(output.artifactId){const href=`/api/readings/${readingId}/artifacts/${output.artifactId}`;return <section className="review-customer"><h2>PDF ready</h2><div className="review-save-actions"><a className="button" href={href+"?view=inline"} target="_blank" rel="noopener noreferrer">Preview PDF · opens new tab</a><a className="button secondary" href={href}>Download PDF</a></div><p className="small muted">The approved reading is ready to review. Nothing has been sent.</p></section>;}
 return <section className="review-customer"><h2>{output.status==="Preparing"?"Preparing PDF":output.status==="Problem"?"PDF needs attention":"PDF unavailable"}</h2>{output.status==="Preparing"?<p role="status">PDF preparation is in progress. Refresh to check its status.</p>:<ReviewPdfForm orderId={orderId} readingId={readingId}/>}</section>;
}
