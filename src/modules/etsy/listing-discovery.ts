import {z} from "zod";
import {safeListingThumbnail} from "./listing-thumbnail";
import {parseEtsyJson} from "./raw-normalizer";
const id=z.union([z.string().regex(/^[1-9]\d{0,19}$/),z.number().int().positive().refine(Number.isSafeInteger)]).transform(String);
const image=z.object({rank:z.number().int().nonnegative(),url_75x75:z.string().max(2048).nullish()});
const listing=z.object({listing_id:id,shop_id:id,title:z.string().min(1).max(1000),state:z.enum(["active","inactive","sold_out","draft","expired"]),updated_timestamp:z.number().int().nonnegative(),images:z.array(image).max(30).nullish()});
const page=z.object({count:z.number().int().nonnegative().max(10000),results:z.array(listing).max(100)});
export class ListingDiscoveryError extends Error {constructor(readonly kind:"connection"|"unavailable"){super("LISTING_DISCOVERY_FAILED");}}
async function boundedJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new ListingDiscoveryError("unavailable");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw new ListingDiscoveryError("unavailable");chunks.push(value);}}finally{await reader.cancel();}
 return parseEtsyJson(Buffer.concat(chunks).toString("utf8"));
}
// Listing-only GET boundary. No receipt reads, fixture fallback or product resolution.
export async function fetchShopListings(shopId:string,accessToken:string,config:{clientId:string;secret:string},fetcher:typeof fetch=fetch){
 id.parse(shopId);const found=new Map<string,z.infer<typeof listing>>();
 try{
 for(const state of ["active","inactive","sold_out","draft","expired"] as const){
  let offset=0;
  for(;;){
   const url=new URL(`https://api.etsy.com/v3/application/shops/${shopId}/listings`);url.search=new URLSearchParams({state,limit:"100",offset:String(offset),sort_on:"created",sort_order:"asc",includes:"Images"}).toString();
   const response=await fetcher(url,{method:"GET",headers:{"x-api-key":`${config.clientId}:${config.secret}`,Authorization:`Bearer ${accessToken}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new ListingDiscoveryError([401,403].includes(response.status)?"connection":"unavailable");
   if(!response.headers.get("content-type")?.includes("application/json"))throw new ListingDiscoveryError("unavailable");
   const data=page.parse(await boundedJson(response));
   for(const row of data.results){if(row.shop_id!==shopId||row.state!==state||found.has(row.listing_id))throw new ListingDiscoveryError("unavailable");found.set(row.listing_id,row);}
   if(found.size>10000)throw new ListingDiscoveryError("unavailable");
   offset+=data.results.length;if(offset>=data.count)break;
   if(!data.results.length||offset>12000)throw new ListingDiscoveryError("unavailable");
  }
 }
 return [...found.values()].map(row=>({...row,thumbnailUrl:safeListingThumbnail([...(row.images??[])].sort((a,b)=>a.rank-b.rank)[0]?.url_75x75)}));
 }catch(error){if(error instanceof ListingDiscoveryError)throw error;throw new ListingDiscoveryError("unavailable");}
}
