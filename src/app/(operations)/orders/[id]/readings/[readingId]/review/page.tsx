import Link from "next/link";
import {notFound} from "next/navigation";
import {database} from "@/db/client";
import {currentScope} from "@/modules/identity/session";
import {openReadingReview,ReviewUnavailable} from "@/modules/review/service";
import {ReviewReading} from "@/components/review-reading";
import {ReviewDraftForm} from "@/components/review/draft-form";
import {ReviewApprovalForm} from "@/components/review/approval-form";
export default async function ReviewPage({params,searchParams}:{params:Promise<{id:string;readingId:string}>;searchParams:Promise<{edit?:string;saved?:string}>}) {
 const {id,readingId}=await params,scope=await currentScope(),query=await searchParams,editing=query.edit==="1";
 let reading;
 try{reading=await openReadingReview(database(),scope,id,readingId,editing);}catch(error){if(error instanceof ReviewUnavailable)notFound();throw error;}
 return <>{!editing&&<Link className="back-link" href={`/orders/${id}`}>← Order</Link>}{!editing&&!reading.approved&&<div className="review-save-actions"><Link className="button secondary" href={`/orders/${id}/readings/${readingId}/review?edit=1`} prefetch={false}>Edit reading</Link>{query.saved==="1"&&reading.draft&&<p role="status" className="small muted">Changes saved</p>}</div>}{!editing&&!reading.approved&&<ReviewApprovalForm orderId={id} readingId={readingId} revision={reading.draft?.revision??null}/>} {reading.approved&&<p role="status" className="small muted">This reading is approved and ready for the next step.</p>}<ReviewReading reading={reading}>{editing&&reading.draft?<ReviewDraftForm orderId={id} readingId={readingId} draft={reading.draft}/>:undefined}</ReviewReading></>;
}
