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
 const titles=["Sample Love Reading","Sample Career Reading","Sample Psychic Reading · Extended reflection on direction and personal priorities","Sample Pet Reading · Sample Career Reading",""];
 const source=Array.from({length:50},(_,i)=>{
  const state=states[i%states.length],externalId=`DEMO-${1001+i}`;
  return {id:externalId,externalId,customer:"",products:titles[i%titles.length],count:i%7+1,status:state.status,priority:state.priority,
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
