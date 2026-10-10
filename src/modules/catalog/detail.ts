import type {DbExecutor} from "../../db/client";
import type {Scope} from "../intake/contracts";
import {readCatalog,type CatalogData} from "./read";
export type CatalogItem=CatalogData["items"][number];
/** Exact owned lookup; all association/design reads remain batched in the catalog projection. */
export async function readListingDetail(db:DbExecutor,scope:Scope,listingId:string){
 if(!/^[1-9]\d{0,19}$/.test(listingId))return null;
 const data=await readCatalog(db,scope,{listingId,pageSize:1});
 return data.items[0]?{item:data.items[0],status:data.status}:null;
}
export type ListingDetailData=NonNullable<Awaited<ReturnType<typeof readListingDetail>>>;
