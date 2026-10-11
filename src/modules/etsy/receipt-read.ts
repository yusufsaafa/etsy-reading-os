// Bounded receipt GET transport, shared by explicitly invoked acceptance/command boundaries. No polling or ingestion.
import {z} from "zod";
import {parseEtsyJson,normalizeEtsyReceipt} from "./raw-normalizer";
import {etsyId} from "./source-contract";
const identifier=z.union([etsyId,z.number().int().positive().safe().transform(String)]);
export class ReceiptPilotError extends Error {constructor(readonly stage:string,readonly httpStatus?:number,readonly retryAfterSeconds?:number){super("RECEIPT_PILOT_FAILED");}}
function receiptReader(shopId:string,token:string,config:{clientId:string;secret:string},fetcher:typeof fetch){
 etsyId.parse(shopId);
 const evidence:{stage:string;status:number;json:boolean}[]=[];
 async function get(path:string,stage:string){
  const response=await fetcher(`https://api.etsy.com/v3/application/shops/${shopId}/receipts${path}`,{method:"GET",headers:{"x-api-key":`${config.clientId}:${config.secret}`,Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
  const json=response.headers.get("content-type")?.includes("application/json")??false;evidence.push({stage,status:response.status,json});
  if(!response.ok||!json){const rawRetry=response.headers.get("retry-after");const retry=rawRetry&&/^\d{1,9}$/.test(rawRetry)?Math.max(1,Number(rawRetry)):undefined;throw new ReceiptPilotError(stage,response.status,retry);}
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
export const receiptWindow=z.object({cutoff:z.number().int().min(946684800).safe(),from:z.number().int().min(946684800).safe(),through:z.number().int().min(946684800).safe(),offset:z.number().int().min(0).max(10000)}).refine(w=>w.through>=w.from);
/** Official getShopReceipts, ten results per page. No customer content leaves this reader. */
export async function readReceiptPage(shopId:string,token:string,config:{clientId:string;secret:string},raw:unknown,fetcher:typeof fetch=fetch){
 const w=receiptWindow.parse(raw),{get}=receiptReader(shopId,token,config,fetcher);
 const params=new URLSearchParams({min_created:String(w.cutoff),min_last_modified:String(w.from),max_last_modified:String(w.through),limit:"10",offset:String(w.offset),sort_on:"receipt_id",sort_order:"asc"});
 const parsed=z.object({count:z.number().int().nonnegative().safe(),results:z.array(z.object({receipt_id:identifier,shop_id:identifier.optional(),create_timestamp:z.number().int().safe().optional(),created_timestamp:z.number().int().safe().optional(),update_timestamp:z.number().int().safe().optional(),updated_timestamp:z.number().int().safe().optional()}).passthrough()).max(10)}).parse(parseEtsyJson(await get("?"+params,"discovery")));
 const receipts=parsed.results.map(r=>{const created=r.created_timestamp??r.create_timestamp,modified=r.updated_timestamp??r.update_timestamp;if(created==null||modified==null||created<w.cutoff||modified<w.from||modified>w.through||(r.shop_id&&r.shop_id!==shopId))throw new ReceiptPilotError("discovery_linkage");return {receiptId:r.receipt_id,modified};});
 if(new Set(receipts.map(r=>r.receiptId)).size!==receipts.length||(!receipts.length&&w.offset<parsed.count))throw new ReceiptPilotError("discovery_incomplete");
 return {receipts,complete:w.offset+receipts.length>=parsed.count};
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
