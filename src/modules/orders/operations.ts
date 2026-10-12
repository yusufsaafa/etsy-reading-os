import {MAX_GENERATION_ATTEMPTS} from "../generation/limits";

export type Operation={key:string;title:string;reason:string;priority:number;action?:{label:string;href:string}};
export type ReadingOperations={output:string;issues:Operation[];next:Operation;prepare:"prepare"|"retry"|null;pdf?:{href:string;historical:boolean};pdfNote:string};
export type OperationEvidence={
 id:string;orderId:string;issues:string[];canceled:boolean;paid:boolean;refund:string;revision:number;configurationState:string;
 canOperate:boolean;eligible:boolean;providerEnabled:boolean;profileReady:boolean;productHref?:string;
 queue?:string;review?:string;
 generation?:{id:string;status:string;customerRevision:number;productVersionId?:string|null};productVersionId?:string|null;
 attempt?:{ambiguous:boolean;failureCode:string|null;attemptNumber:number};
 artifact?:{id:string;generationId:string;customerRevision:number};pdfAccess:boolean;
};
const inputIssues=new Set(["missing_input","unusable_input","quantity_context"]);
const issueText:Record<string,[string,string]>={
 missing_input:["Customer information missing","Required customer answers are missing."],
 unusable_input:["Customer information needs review","An answer is unsupported or does not pass the current field checks."],
 quantity_context:["Confirm the recipient","Confirm which recipient and information belong to this reading."],
 unmapped_listing:["Product setup required","The purchase is saved, but this reading has no approved configuration. Review Product setup. Review purchased evidence and confirm its first configuration in Reading Details. Generation remains blocked until assignment and eligibility checks pass."],
 mapping_paused:["Product paused","The purchased option is paused. Review its existing Product settings."],
 source_changed:["Purchase details changed","The retained purchase differs from the current source. Input editing does not clear this hold; no source reconciliation action is available here."],
 not_digital:["Unsupported purchase","This purchase is not configured as a digital reading. No conversion action is available here."],
 source_evidence_incomplete:["Purchase evidence incomplete","Required source evidence is missing. No source repair action is available here."],
 unmapped_purchase_selection:["Purchased option not mapped","The exact purchased choices have no approved mapping. Review Product setup; historical purchases are not automatically reassigned."],
 unknown_buyer_input:["Unsupported buyer input","Some retained buyer evidence cannot be interpreted safely. No conversion action is available here."],
 unresolved_upload:["Buyer upload unresolved","Uploaded buyer content is retained as unresolved evidence. Reading OS has no upload resolution workflow here."],
 unresolved_dropdown:["Buyer selection unresolved","The purchased answer's dropdown meaning is not resolved. No answer conversion action is available here."],
 ambiguous_historical_mapping:["Historical field mapping unclear","The historical answer cannot be matched safely to a configured field. Input editing does not clear this source hold."],
};
const failures:Record<string,string>={RATE_LIMIT:"The provider temporarily limited preparation.",INVALID_RESULT:"The saved response did not pass reading validation.",TIMEOUT:"The provider response was not confirmed.",NETWORK:"The provider outcome was not confirmed.",BUDGET_LIMIT:"The preparation budget blocked this attempt.",CONFIGURATION:"Preparation configuration was unavailable.",BLOCKED:"Preparation was blocked before completion.",ADMISSION_CHANGED:"The reading changed before preparation could complete."};
export function readingOperations(e:OperationEvidence):ReadingOperations{
 const held=e.canceled||!e.paid||e.refund!=="none",active=["QUEUED","CLAIMED","EXECUTING","RETRY_WAIT"].includes(e.queue??"")||e.generation?.status==="PROCESSING";
 const current=e.generation?.customerRevision===e.revision;
 const link=(label:string,href:string,ownerOnly=false)=>held||ownerOnly&&!e.canOperate?undefined:{label,href};
 const operations:Operation[]=[];
 const add=(key:string,title:string,reason:string,priority:number,action?:Operation["action"])=>operations.push({key,title,reason,priority,action});
 if(e.canceled)add("canceled","Order canceled","No active production action is available for this canceled order.",0);
 else if(!e.paid)add("unpaid","Awaiting payment","Payment is unresolved. Reading OS has no payment-resolution command; confirm the order in Etsy.",1);
 else if(e.refund!=="none")add("refund_review","Refund review required","Refund evidence holds production. Reading OS has no refund-resolution command; review the order in Etsy.",1);
 for(const code of [...new Set(e.issues)].filter(c=>!["canceled","unpaid","refund_review"].includes(c))){
  const [title,reason]=issueText[code]??["Reading requires attention","A persisted purchase hold prevents preparation. No resolution control is currently available here."];
  add(code,title,reason,inputIssues.has(code)?3:code==="unmapped_listing"?4:2,
   inputIssues.has(code)?link("Complete customer information",`#customer-information-${e.id}`):["unmapped_listing","unmapped_purchase_selection","mapping_paused"].includes(code)&&e.productHref?link("Review product setup",e.productHref,true):undefined);
 }
 if(e.configurationState!=="versioned"&&!e.issues.includes("unmapped_listing"))add("configuration","Reading configuration unavailable","This reading has no retained published product version. Product setup does not automatically rebind historical purchases. An unconfigured reading requires explicit first assignment in Reading Details.",4,e.productHref?link("Review product setup",e.productHref,true):undefined);
 const failed=!active&&(e.queue==="ATTENTION"||e.generation?.status==="FAILED");
 const retry=failed&&e.generation?.status==="FAILED"&&current&&e.generation.productVersionId===e.productVersionId&&e.attempt&&!e.attempt.ambiguous&&!["TIMEOUT","NETWORK"].includes(e.attempt.failureCode??"")&&e.attempt.attemptNumber<MAX_GENERATION_ATTEMPTS&&e.eligible&&e.canOperate&&e.providerEnabled&&!held;
 if(failed)add("failure","Preparation needs attention",e.attempt?.ambiguous?"The previous outcome is uncertain. Contact support before another attempt.":e.attempt&&e.attempt.attemptNumber>=MAX_GENERATION_ATTEMPTS?"The preparation attempt limit was reached. Contact support before continuing.":(failures[e.attempt?.failureCode??""]??"Preparation did not complete.")+(retry?" Review the existing retry control.":" No safe retry is available for this reading here."),2,retry?link("Review retry",`#preparation-${e.id}`):undefined);
 if(e.generation&&!current)add("stale","Earlier customer information","The latest saved generation uses an earlier customer-information revision. It is not current output. A new generation command is not available here.",2,link("Review customer information",`#customer-information-${e.id}`));
 if(active)add("active",e.queue==="RETRY_WAIT"?"Waiting to retry":"Preparation in progress",e.queue==="RETRY_WAIT"?"An existing retry is waiting. No additional preparation should be started.":"Existing production is queued or running. Refresh to check persisted progress.",5);
 if(e.review&&!held&&current)add("review",e.review==="Approved"?"Reading approved":"Reading ready for review",e.review==="Approved"?"View the current approved reading.":"View the saved content and review it before approval.",6,{label:"View Reading",href:`/orders/${e.orderId}/readings/${e.id}/review`});
 else if(e.generation?.status==="SUCCEEDED"&&current&&!active&&!held)add("review_unavailable","Saved result unavailable for review","The current result does not pass the existing review checks. No content access is enabled; contact support if the reading otherwise appears ready.",2);
 const prepare=e.configurationState==="versioned"&&!e.generation&&!active&&e.eligible&&!held&&e.canOperate&&e.providerEnabled&&e.profileReady;
 if(!operations.length)add("pending",prepare?"Prepare the reading":"Preparation unavailable",prepare?"Open the existing reading preparation control.":!e.canOperate?"Only a store owner can prepare this reading.":!e.providerEnabled?"Preparation is not enabled for this store.":!e.profileReady?"Complete your profile and apply a style in Settings before using the existing preparation workflow.":"Review the retained configuration and customer information before continuing.",7,prepare?link("Open Reading Preparation",`#preparation-${e.id}`):!held&&e.canOperate&&!e.profileReady?{label:"Review profile and style",href:"/settings/profile"}:undefined);
 const historical=!!e.artifact&&(held||!e.eligible||e.review!=="Approved"||e.artifact.customerRevision!==e.revision||e.artifact.generationId!==e.generation?.id);
 const pdf=e.artifact&&e.pdfAccess?{href:`/api/readings/${e.id}/artifacts/${e.artifact.id}?view=inline`,historical}:undefined;
 return {output:active?(e.queue==="RETRY_WAIT"?"Retry wait":"Processing"):e.generation&&!current?"Stale generation":e.generation?.status==="FAILED"?"Generation failed":e.review==="Approved"?"Approved reading":e.generation?.status==="SUCCEEDED"?e.review?"Current generated reading":"Generated result unavailable for review":"No generation",issues:operations.filter(o=>o.priority<5),next:[...operations].sort((a,b)=>a.priority-b.priority)[0],prepare:retry?"retry":prepare?"prepare":null,pdf,pdfNote:e.artifact?e.pdfAccess?(historical?"Historical PDF · earlier saved output":"PDF completed · delivery is not recorded here"):"PDF recorded · preview access is not configured":"No available PDF recorded"};
}
