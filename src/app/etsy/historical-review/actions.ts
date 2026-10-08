"use server";
import {assertInternalOperator} from "@/modules/identity/internal-access";
import {redirect} from "next/navigation";
import {database} from "@/db/client";
import {currentStoreScope} from "@/modules/identity/session";
import {recordCandidateReview,confirmCandidateReview} from "@/modules/etsy/candidate-review";
export async function selectHistoricalCandidate(data:FormData){
 const scope=await currentStoreScope();assertInternalOperator(scope.userId);let id:string;
 try{id=await recordCandidateReview(database(),scope,{receiptId:data.get("receipt"),transactionId:data.get("transaction"),productVersionId:data.get("version")});}
 catch{redirect("/etsy/historical-review?error=review");}
 redirect("/etsy/historical-review?review="+id);
}
export async function confirmHistoricalReview(data:FormData){
 const scope=await currentStoreScope();assertInternalOperator(scope.userId);let confirmed=false;
 if(data.get("confirmation")!=="review-only")redirect("/etsy/historical-review?error=confirm");
 try{confirmed=(await confirmCandidateReview(database(),scope,String(data.get("review")))).confirmed;}
 catch{redirect("/etsy/historical-review?error=confirm");}
 redirect(confirmed?"/etsy/historical-review?review="+String(data.get("review")):"/etsy/historical-review?error=stale");
}
