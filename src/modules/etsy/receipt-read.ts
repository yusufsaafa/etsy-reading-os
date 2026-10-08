// Bounded receipt GET transport, shared by explicitly invoked acceptance/command boundaries. No polling or ingestion.
import {z} from "zod";
import {parseEtsyJson,normalizeEtsyReceipt} from "./raw-normalizer";
import {etsyId} from "./source-contract";
const identifier=z.union([etsyId,z.number().int().positive().safe().transform(String)]);
export class ReceiptPilotError extends Error {constructor(readonly stage:string,readonly httpStatus?:number){super("RECEIPT_PILOT_FAILED");}}
function receiptReader(shopId:string,token:string,config:{clientId:string;secret:string},fetcher:typeof fetch){
 etsyId.parse(shopId);
 const evidence:{stage:string;status:number;json:boolean}[]=[];
 async function get(path:string,stage:string){
  const response=await fetcher(`https://api.etsy.com/v3/application/shops/${shopId}/receipts${path}`,{method:"GET",headers:{"x-api-key":`${config.clientId}:${config.secret}`,Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
  const json=response.headers.get("content-type")?.includes("application/json")??false;evidence.push({stage,status:response.status,json});
  if(!response.ok||!json)throw new ReceiptPilotError(stage,response.status);
  const reader=response.body?.getReader();if(!reader)throw new ReceiptPilotError(stage);
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw new ReceiptPilotError("response_bound");chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks).toString("utf8");
 }
 return {get,evidence};
}
export async function readReceiptDetail(shopId:string,receiptId:string,token:string,config:{clientId:string;secret:string},fetcher:typeof fetch=fetch){
 const {get,evidence}=receiptReader(shopId,token,config,fetcher);
 const body=await get("/"+etsyId.parse(receiptId),"detail");
 if(z.object({receipt_id:identifier}).parse(parseEtsyJson(body)).receipt_id!==receiptId)throw new ReceiptPilotError("receipt_linkage");
 return {body,evidence};
}
export async function readReceiptSample(shopId:string,token:string,config:{clientId:string;secret:string},since:number,fetcher:typeof fetch=fetch){
 z.number().int().nonnegative().safe().parse(since);
 const {get,evidence}=receiptReader(shopId,token,config,fetcher);
 const list=parseEtsyJson(await get("?"+new URLSearchParams({was_paid:"true",limit:"3",min_created:String(since),sort_on:"created",sort_order:"desc"}),"list"));
 const page=z.object({count:z.number().int().nonnegative().safe(),results:z.array(z.object({receipt_id:identifier})).max(3)}).parse(list);
 if(new Set(page.results.map(r=>r.receipt_id)).size!==page.results.length)throw new ReceiptPilotError("duplicate_receipt");
 const details:{body:string;receiptId:string}[]=[];
 for(const r of page.results){const body=await get("/"+r.receipt_id,"detail"),decoded=parseEtsyJson(body);if(z.object({receipt_id:identifier}).parse(decoded).receipt_id!==r.receipt_id)throw new ReceiptPilotError("receipt_linkage");details.push({body,receiptId:r.receipt_id});}
 return {details,evidence,listShape:{countPresent:true,resultsPresent:true,returned:details.length,paginationFields:["limit","offset","next","pagination"].filter(k=>Object.hasOwn(list as object,k))}};
}
export function normalizePilotReceipt(body:string,shopId:string,observedAt:number){return normalizeEtsyReceipt(body,{verifiedShopId:shopId,observedAt});}
