import {readingOperations} from "./operations";
import type {DetailReading} from "../../components/order-detail";
import type {OrdersData} from "./service";
import type {DashboardOrder} from "../dashboard/service";
import {ORDER_PAGE_SIZE,type OrdersQuery} from "./query";

/** Bounded presentation evidence only. No database, provider or queue dependencies. */
export function sampleOrdersData(query:OrdersQuery):OrdersData {
 if(process.env.NODE_ENV!=="development")throw new Error("Sample Orders preview is unavailable");
 const states=[
  {status:"Pending",priority:4,filter:"pending"},
  {status:"In production",priority:4,filter:"production"},
  {status:"Generated",priority:4,filter:"generated"},
  {status:"Information or setup needed",priority:3,filter:"attention"},
  {status:"Canceled",priority:4,filter:"canceled"},
 ] as const;
 const titles=["Sample Love Reading · Relationship Direction","Sample Career Reading · Your Next Opportunity","Sample Psychic Reading · Extended reflection on direction and personal priorities","Sample Pet Reading · Sample Career Reading",""];
 const source=Array.from({length:50},(_,i)=>{
  const title=i%5===4&&i!==4?"Sample Life Path Reading":titles[i%titles.length];
  const state=states[i%states.length],externalId=`DEMO-${1001+i}`;
  return {id:externalId,externalId,customer:["Emily Carter","Olivia Brown","Sophia Miller","James Wilson","Emma Thompson","Alex Morgan"][i%6],products:title+(i%4===0&&i%7+1>1&&title?" · Sample Career Reading":""),count:titles[i%titles.length].startsWith("Sample Pet Reading")?Math.max(2,i%7+1):i%7+1,status:state.status,priority:state.priority,
   date:new Date(Date.UTC(2026,9,9-Math.floor(i/3),12-i%3)).toISOString(),filter:state.filter};
 });
 const needle=query.q.toLowerCase();
 const matches=source.filter(row=>(query.filter==="all"||row.filter===query.filter)&&
  `${row.id} ${row.products}`.toLowerCase().includes(needle)).sort((a,b)=>{
   const date=a.date.localeCompare(b.date),id=a.id.localeCompare(b.id);
   return query.sort==="oldest"?date||id:-(date||id);
  });
 const pages=Math.max(1,Math.ceil(matches.length/ORDER_PAGE_SIZE)),page=Math.min(query.page,pages);
 const rows:DashboardOrder[]=matches.slice((page-1)*ORDER_PAGE_SIZE,page*ORDER_PAGE_SIZE).map(({filter,...row})=>row);
 return {rows,total:source.length,matched:matches.length,page,pages,connectionAttention:false};
}

export function sampleOrderDetail(id:string){
 if(process.env.NODE_ENV!=="development")throw new Error("Sample Orders preview is unavailable");
 if(!/^DEMO-10\d\d$/.test(id))return null;
 const row=[1,2,3].flatMap(page=>sampleOrdersData({q:"",filter:"all",sort:"newest",page}).rows).find(r=>r.id===id);
 if(!row)return null;
 const generated=row.status==="Generated",active=row.status==="In production",attention=row.priority<4,canceled=row.status==="Canceled";
 const sequence=Number(id.slice(5))-1001;
 const questions=["What should I focus on next?","How can I rebuild trust in this relationship?","I am considering a move and a career change at the same time. My current work is stable, but I feel disconnected from it. What patterns should I consider before deciding which opportunity fits my priorities and commitments?","What helps my rescue cat feel secure at home?","How can I approach an important conversation with confidence?","What is keeping me from asking for the promotion I want?","I recently adopted a dog who is hesitant around new visitors. How can I better understand his needs?","What should I learn from the relationship I just left?","I have two very different opportunities: one gives me stability and another would let me start something creative. I would like guidance on the emotional patterns behind my hesitation, my strengths, and the practical questions I should reflect on before deciding.","Where can I find more balance this month?","What can support my confidence before a first date?","How can I make space for a new chapter without ignoring my current responsibilities?"];
 const answers=attention?[]:[{label:"Question",value:questions[sequence%questions.length],kind:"text" as const},...(sequence%3===0?[{label:"First name",value:row.customer.split(" ")[0],kind:"text" as const},{label:"Context",value:"Fictional sample: exploring a fresh start after a period of uncertainty.",kind:"text" as const}]:[])];
 const readings:DetailReading[]=Array.from({length:row.count},(_,i)=>({id:`${id}-reading-${i+1}`,index:i+1,status:canceled?"Canceled":generated?"Generated":active?"Queued":attention?"Customer information needed":"Pending",revision:0,answers:answers.map(a=>({...a})),queue:active?"Queued":undefined,generation:generated?{status:"SUCCEEDED",revision:0,date:row.date}:undefined}));
 const scenario=Math.floor((Number(id.slice(5))-1001)/5)%5;
 for(const reading of readings){
  const issues=attention?(scenario===0?["missing_input"]:scenario===1?["unmapped_listing"]:scenario===4?["source_changed","missing_input"]:[]):[];
  if(attention&&scenario===0&&reading.index>1){
   issues.length=0;reading.answers=[{label:"Question",kind:"text",value:"Sample question about a new direction."}];
   reading.generation={status:"SUCCEEDED",revision:0,date:row.date};reading.status="Generated";
  }
  const setup=attention&&scenario===1;
  if(attention&&scenario===2){reading.generation={status:"FAILED",revision:0,date:row.date};reading.status="Preparation needs attention";}
  if(attention&&scenario===3){reading.generation={status:"SUCCEEDED",revision:0,date:row.date};reading.revision=1;reading.status="Review updated information";}
  const waiting=active&&scenario%2===1;if(waiting)reading.queue="Retry wait";
  const generation=reading.generation?{id:`${reading.id}-generation`,status:reading.generation.status,customerRevision:reading.generation.revision,productVersionId:"sample-version"}:undefined;
  reading.operations=readingOperations({id:reading.id,orderId:id,issues,canceled,paid:true,refund:"none",revision:reading.revision,configurationState:setup?"unconfigured":"versioned",canOperate:true,eligible:!issues.length,providerEnabled:true,profileReady:true,productHref:"/products",queue:active?waiting?"RETRY_WAIT":"QUEUED":undefined,review:generated||attention&&scenario===0&&reading.index>1?"Ready for review":undefined,generation,productVersionId:"sample-version",attempt:generation?.status==="FAILED"?{ambiguous:false,failureCode:"INVALID_RESULT",attemptNumber:1}:undefined,pdfAccess:false});
 }
 const split=row.products.startsWith("Sample Pet Reading")||sequence%4===0&&readings.length>1&&row.products?Math.max(1,Math.floor(readings.length/2)):readings.length;
 const items=[{id:`${id}-item-1`,title:row.products.startsWith("Sample Pet Reading")?"Sample Pet Reading":split<readings.length?row.products.replace(/ · Sample Career Reading$/,""):row.products,quantity:split,variations:sequence%2===0?["Detail: Standard"]:["Detail: Extended"],answers,readings:readings.slice(0,split)}];
 if(split<readings.length)items.push({id:`${id}-item-2`,title:"Sample Career Reading",quantity:readings.length-split,variations:[],answers,readings:readings.slice(split)});
 return {reference:row.externalId,customer:row.customer,date:row.date,status:row.status,payment:canceled?"Canceled purchase":"Paid",sample:true,items};
}
