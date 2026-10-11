import type {Database} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {ordersData} from "./service";
import type {OrdersQuery} from "./query";
import {orderReadingReviewStatuses} from "../review/service";
import {readingOutputStatus} from "../production/documents";
import {orderDetailData} from "./detail";
import {buildGenerationContext} from "../generation/context";
import {AdmissionError} from "../generation/contracts";
import {ReviewUnavailable} from "../review/service";
import {ReviewDraftError} from "../review/draft-contract";
/** Bounded page; no lazy Review initialization and no operational mutation. */
export async function ordersWorkQueue(db:Database,scope:Scope,query:OrdersQuery){
 const original=await ordersData(db,scope,query);
 const data={...original,rows:original.rows.map(row=>({...row}))};
 for(const row of data.rows){
  if(row.priority<4||row.status==="Canceled"||row.status==="In production")continue;
  const detail=await orderDetailData(db,scope,row.id);if(!detail?.units.length)continue;
  if(row.status==="Pending"){
   let ready=true;
   for(const unit of detail.units){try{await db.transaction(tx=>buildGenerationContext(tx,scope,unit.id,false),{isolationLevel:"repeatable read"});}catch(error){if(!(error instanceof AdmissionError))throw error;ready=false;}}
   if(ready)row.status="Ready for Preparation";
   continue;
  }
  const reviews=await orderReadingReviewStatuses(db,scope,row.id);
  if(reviews.size!==detail.units.length){row.status="Reading needs attention";row.priority=3;continue;}
  if([...reviews.values()].every(s=>s==="Approved")){
   const outputs=[];
   try{for(const unit of detail.units)outputs.push(await readingOutputStatus(db,scope,row.id,unit.id));}
   catch(error){if(!(error instanceof ReviewUnavailable||error instanceof ReviewDraftError||error instanceof Error&&["REVIEW_UNAVAILABLE","ARTIFACT_UNAVAILABLE"].includes(error.message)))throw error;row.status="Reading needs attention";row.priority=3;continue;}
   if(outputs.some(o=>o.status==="Problem")){row.status="PDF needs attention";row.priority=3;}
   else if(outputs.some(o=>!o.deliveryReady))row.status="PDF Pending";
   else row.status=outputs.some(o=>o.artifactId)?"PDF Ready":"Approved";
  }else row.status=detail.reviews.length?"Awaiting Review":"Generated";
 }
 return data;
}
