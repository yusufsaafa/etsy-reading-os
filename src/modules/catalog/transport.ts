import {z} from "zod";
import {etsyId} from "../etsy/source-contract";
import {parseEtsyJson} from "../etsy/raw-normalizer";
import {safeListingThumbnail} from "../etsy/listing-thumbnail";
import {fetchSetupCatalog,SetupCatalogError,type SetupCatalog} from "../etsy/setup-catalog";
const id=z.union([etsyId,z.number().int().positive().safe().transform(String)]).refine(v=>BigInt(v)<=9223372036854775807n);
const integer=z.number().int().nonnegative().max(2147483647);
export const listingStates=["active","inactive","sold_out","draft","expired"] as const;
export const catalogListingSchema=z.object({listing_id:id,shop_id:id,title:z.string().min(1).max(1000),state:z.enum(listingStates),updated_timestamp:integer,
 creation_timestamp:integer.optional(),shop_section_id:z.union([id,z.literal(0),z.literal("0")]).nullable().optional(),url:z.string().max(2048).nullable().optional(),
 images:z.array(z.object({rank:integer,url_75x75:z.string().max(2048).nullish()})).max(30).nullish()});
const section=z.object({shop_section_id:id,title:z.string().min(1).max(500),rank:integer,active_listing_count:integer});
export type CatalogListing=z.infer<typeof catalogListingSchema>;
export type CatalogSection=z.infer<typeof section>;
export interface CatalogReader {
 shopId:string;epoch:number;
 sections():Promise<CatalogSection[]>;
 listings(state:typeof listingStates[number],offset:number):Promise<{count:number;results:CatalogListing[]}>;
 choices(listingId:string):Promise<SetupCatalog>;
}
export class CatalogError extends Error {
 constructor(readonly code:"AUTHORIZATION"|"RATE_LIMIT"|"TEMPORARY_FAILURE"|"INVALID_RESPONSE"|"CONNECTION_CHANGED"|"BUSY",readonly retryAfterSeconds?:number){super(code);}
}
export function safeListingUrl(value:string|null|undefined,listingId:string){
 if(!value)return null;
 try{const u=new URL(value);return u.protocol==="https:"&&["etsy.com","www.etsy.com"].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&u.pathname.split("/").slice(1,3).join("/")===`listing/${listingId}`?u.origin+u.pathname:null;}catch{return null;}
}
export function primaryThumbnail(row:CatalogListing){return safeListingThumbnail([...(row.images??[])].sort((a,b)=>a.rank-b.rank)[0]?.url_75x75);}
// Same authenticated v3 GET conventions as receipt/discovery. Never downloads images.
export function catalogReader(shopId:string,epoch:number,token:string,config:{clientId:string;secret:string},fetcher:typeof fetch=fetch):CatalogReader{
 etsyId.parse(shopId);
 async function get(path:string){
  let response:Response;
  try{response=await fetcher(`https://api.etsy.com/v3/application/shops/${shopId}${path}`,{method:"GET",headers:{"x-api-key":`${config.clientId}:${config.secret}`,Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});}catch{throw new CatalogError("TEMPORARY_FAILURE");}
  if(!response.ok){const raw=response.headers.get("retry-after"),retry=raw&&/^\d{1,9}$/.test(raw)?Math.max(1,Number(raw)):undefined;throw new CatalogError(response.status===429?"RATE_LIMIT":[401,403].includes(response.status)?"AUTHORIZATION":"TEMPORARY_FAILURE",retry);}
  if(!response.headers.get("content-type")?.includes("application/json"))throw new CatalogError("INVALID_RESPONSE");
  const reader=response.body?.getReader();if(!reader)throw new CatalogError("INVALID_RESPONSE");const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw new CatalogError("INVALID_RESPONSE");chunks.push(value);}return parseEtsyJson(Buffer.concat(chunks).toString("utf8"));}
  catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError("INVALID_RESPONSE");}finally{await reader.cancel();}
 }
 return {shopId,epoch,async sections(){try{const data=z.object({count:integer.max(1000),results:z.array(section).max(1000)}).parse(await get("/sections"));if(data.count!==data.results.length||new Set(data.results.map(s=>s.shop_section_id)).size!==data.results.length)throw new Error();return data.results;}catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError("INVALID_RESPONSE");}},
 async listings(state,offset){try{const data=z.object({count:integer.max(10000),results:z.array(catalogListingSchema).max(100)}).parse(await get("/listings?"+new URLSearchParams({state,limit:"100",offset:String(offset),sort_on:"created",sort_order:"asc",includes:"Images"})));
 if(data.results.some(r=>r.shop_id!==shopId||r.state!==state)||new Set(data.results.map(r=>r.listing_id)).size!==data.results.length||offset+data.results.length>data.count||(!data.results.length&&offset<data.count))throw new Error();return data;}catch(error){if(error instanceof CatalogError)throw error;throw new CatalogError("INVALID_RESPONSE");}},
 async choices(listingId){try{return await fetchSetupCatalog(shopId,listingId,token,config,fetcher);}catch(error){if(error instanceof SetupCatalogError)throw new CatalogError(error.httpStatus===429?"RATE_LIMIT":[401,403].includes(error.httpStatus??0)?"AUTHORIZATION":"TEMPORARY_FAILURE",error.retryAfterSeconds);throw error;}}};
}
